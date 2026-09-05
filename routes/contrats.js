const express = require('express');
const { pool, withTransaction, nextNumero } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');
const { findOrCreateClient } = require('./clients');
const { isPositiveNumber, isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');
const { requirePerm } = require('../middleware/permissions');

const router = express.Router();
router.use(auth);

const STATUTS = ['Actif','Suspendu','Terminé'];

// Génère (ou complète, de façon idempotente) l'échéancier mensuel d'un contrat récurrent :
// une ligne par mois entre date_debut et date_fin inclus, initialisée avec les valeurs par
// défaut du contrat (quantité/prix modifiables ensuite mois par mois). La date de paiement
// par défaut reprend le jour du mois de date_debut, ajustée au dernier jour du mois si besoin
// (ex: contrat démarrant un 31 -> échéance de février au 28/29).
// ON CONFLICT DO NOTHING : n'écrase jamais une échéance déjà éditée/payée si on regénère
// après une extension de date_fin.
// Pure arithmétique année/mois (pas de new Date(dateString) ni de composants locaux d'un Date
// construit depuis une string) : new Date("YYYY-MM-DD") est interprété en UTC par JS, et
// relire l'année/mois/jour via des getters locaux décale d'un jour sur un serveur dont le
// fuseau est en décalage négatif par rapport à UTC. Date.UTC n'est utilisé que pour calculer
// le nombre de jours d'un mois, ce qui reste correct quel que soit le fuseau du serveur.
async function generateEcheances(client, contratId, dateDebut, dateFin, quantiteMensuelle, prixUnitaire) {
  const [anneeDebut, moisDebut, jourPaiement] = dateDebut.split('-').map(Number);
  const [anneeFin, moisFin] = dateFin.split('-').map(Number);
  let annee = anneeDebut;
  let mois = moisDebut;
  const finIndex = anneeFin * 12 + moisFin;
  while (annee * 12 + mois <= finIndex) {
    const lastDay = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
    const jour = Math.min(jourPaiement, lastDay);
    const datePaiement = `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
    await client.query(
      `INSERT INTO contrat_echeances (contrat_client_id, annee, mois, quantite, prix_unitaire, date_paiement_prevue)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (contrat_client_id, annee, mois) DO NOTHING`,
      [contratId, annee, mois, quantiteMensuelle || 0, prixUnitaire || 0, datePaiement]
    );
    mois += 1;
    if (mois > 12) { mois = 1; annee += 1; }
  }
}

// ══════════════════════════════════════════════
// CONTRATS CLIENTS (aval)
// ══════════════════════════════════════════════

// GET /api/contrats/clients
router.get('/clients', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    // Mise à jour automatique : tout contrat dont date_fin est dépassée passe à 'Terminé',
    // et toute échéance dont la date de paiement prévue est dépassée sans être soldée passe
    // en 'En retard' (même logique que les ventes, à l'échelle d'un mois de contrat).
    await pool.query(
      `UPDATE contrats_clients SET statut='Terminé'
       WHERE user_id = ANY($1::uuid[]) AND date_fin < CURRENT_DATE AND statut != 'Terminé'`,
      [ids]
    );
    await pool.query(
      `UPDATE contrat_echeances e SET statut_paiement='En retard'
       FROM contrats_clients cc
       WHERE e.contrat_client_id = cc.id AND cc.user_id = ANY($1::uuid[])
         AND e.date_paiement_prevue < CURRENT_DATE AND e.statut_paiement = 'En cours'`,
      [ids]
    );
    const { statut } = req.query;
    // total_verse cumule les versements historiques rattachés directement au contrat (ancien
    // modèle) et ceux rattachés à une échéance mensuelle précise (nouveau modèle).
    // ca_contractualise = somme de l'échéancier généré, montant réellement engagé sur la
    // durée du contrat (remplace l'ancienne estimation quantite_mensuelle*prix_unitaire*12
    // qui ne tenait pas compte des variations mensuelles ni de la durée réelle).
    let q = `SELECT cc.*, u.nom AS vendeur_nom,
               COALESCE(ve.total_verse, 0) + COALESCE(vee.total_verse, 0) AS total_verse,
               COALESCE(ech.ca_contractualise, 0) AS ca_contractualise,
               COALESCE(ech.nb_echeances, 0) AS nb_echeances,
               COALESCE(ech.echeances_impayees, 0) AS echeances_impayees
             FROM contrats_clients cc
             LEFT JOIN users u ON u.id = cc.user_id
             LEFT JOIN (SELECT contrat_client_id, SUM(montant) AS total_verse
                        FROM versements GROUP BY contrat_client_id) ve ON ve.contrat_client_id = cc.id
             LEFT JOIN (
               SELECT e.contrat_client_id, SUM(v.montant) AS total_verse
               FROM contrat_echeances e JOIN versements v ON v.contrat_echeance_id = e.id
               GROUP BY e.contrat_client_id
             ) vee ON vee.contrat_client_id = cc.id
             LEFT JOIN (
               SELECT contrat_client_id, SUM(montant) AS ca_contractualise, COUNT(*) AS nb_echeances,
                      COUNT(*) FILTER (WHERE statut_paiement != 'Paye') AS echeances_impayees
               FROM contrat_echeances GROUP BY contrat_client_id
             ) ech ON ech.contrat_client_id = cc.id
             WHERE cc.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND cc.statut = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY cc.statut, cc.client_nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('GET contrats/clients', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/contrats/clients
router.post('/clients', async (req, res) => {
  try {
    const { client_id, client_nom, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note } = req.body;
    const produitsArr = Array.isArray(produits) && produits.length > 0 ? produits : [];
    if (!client_nom || !produitsArr.length) return res.status(400).json({ error: 'Client et au moins un produit requis' });
    // Un contrat récurrent formalise un engagement sur une durée déterminée : les deux bornes
    // sont requises pour générer l'échéancier mensuel (quantité/prix/paiement par mois).
    if (!date_debut || !date_fin) return res.status(400).json({ error: 'Date de début et date de fin requises (durée du contrat)' });
    if (quantite_mensuelle !== undefined && quantite_mensuelle !== null && !isNonNegativeNumber(quantite_mensuelle))
      return res.status(400).json({ error: 'quantite_mensuelle doit etre un nombre positif ou nul' });
    if (prix_unitaire !== undefined && prix_unitaire !== null && !isNonNegativeNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif ou nul' });
    if (!isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (!isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    let resolvedClientId = client_id || null;
    if (!resolvedClientId) {
      const client = await findOrCreateClient(req.userId, client_nom, null);
      resolvedClientId = client.id;
    }

    const numero = await nextNumero('contrats_clients', 'CC', req.userId);
    const contrat = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO contrats_clients (user_id, client_id, client_nom, produit, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note, numero)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.userId, resolvedClientId, client_nom.trim(), produitsArr[0],
         produitsArr, quantite_mensuelle || 0, prix_unitaire || 0,
         date_debut, date_fin, statut || 'Actif', note || null, numero]
      );
      const c = result.rows[0];
      await generateEcheances(client, c.id, date_debut, date_fin, quantite_mensuelle, prix_unitaire);
      return c;
    });
    res.status(201).json(contrat);
  } catch (err) {
    logger.error('POST contrats/clients', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/contrats/clients/:id — manager+ seulement (vendeur ne peut pas modifier le contrat d'un collègue)
router.put('/clients/:id', requirePerm('ventes:statut'), async (req, res) => {
  try {
    const { client_nom, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note } = req.body;
    const produitsArr = Array.isArray(produits) && produits.length > 0 ? produits : [];
    if (!produitsArr.length) return res.status(400).json({ error: 'Au moins un produit requis' });
    if (!date_debut || !date_fin) return res.status(400).json({ error: 'Date de début et date de fin requises (durée du contrat)' });
    if (quantite_mensuelle !== undefined && quantite_mensuelle !== null && !isNonNegativeNumber(quantite_mensuelle))
      return res.status(400).json({ error: 'quantite_mensuelle doit etre un nombre positif ou nul' });
    if (prix_unitaire !== undefined && prix_unitaire !== null && !isNonNegativeNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif ou nul' });
    if (!isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (!isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const ids = await getScopeIds(req.userId, req.userRole);
    // Ne régénère jamais une échéance déjà existante (quantité/prix/date déjà édités ou
    // payés) — ne fait qu'ajouter les mois nouvellement couverts si date_fin est prolongée.
    const contrat = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE contrats_clients SET client_nom=$1, produit=$2, produits=$3, quantite_mensuelle=$4,
           prix_unitaire=$5, date_debut=$6, date_fin=$7, statut=$8, note=$9
         WHERE id=$10 AND user_id = ANY($11::uuid[]) RETURNING *`,
        [client_nom, produitsArr[0], produitsArr, quantite_mensuelle || 0, prix_unitaire || 0,
         date_debut, date_fin, statut || 'Actif', note || null,
         req.params.id, ids]
      );
      if (!result.rows.length) return null;
      const c = result.rows[0];
      await generateEcheances(client, c.id, date_debut, date_fin, quantite_mensuelle, prix_unitaire);
      return c;
    });
    if (!contrat) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(contrat);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/contrats/echeances?statut=En retard — échéances impayées tous contrats confondus
// (pour la page Créances). Enregistrée avant /clients/:id pour ne pas être capturée par lui.
router.get('/echeances', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    await pool.query(
      `UPDATE contrat_echeances e SET statut_paiement='En retard'
       FROM contrats_clients cc
       WHERE e.contrat_client_id = cc.id AND cc.user_id = ANY($1::uuid[])
         AND e.date_paiement_prevue < CURRENT_DATE AND e.statut_paiement = 'En cours'`,
      [ids]
    );
    const { statut } = req.query;
    let q = `SELECT e.*, COALESCE(v.total_verse, 0) AS total_verse,
                    cc.client_nom, cc.numero AS contrat_numero, u.nom AS vendeur_nom
             FROM contrat_echeances e
             JOIN contrats_clients cc ON cc.id = e.contrat_client_id
             LEFT JOIN users u ON u.id = cc.user_id
             LEFT JOIN (SELECT contrat_echeance_id, SUM(montant) AS total_verse
                        FROM versements GROUP BY contrat_echeance_id) v ON v.contrat_echeance_id = e.id
             WHERE cc.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && ['En cours', 'En retard', 'Paye'].includes(statut)) {
      q += ` AND e.statut_paiement = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY e.date_paiement_prevue ASC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('GET contrats/echeances', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/contrats/clients/:id
router.get('/clients/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `SELECT cc.*, u.nom AS vendeur_nom,
               COALESCE(ve.total_verse, 0) + COALESCE(vee.total_verse, 0) AS total_verse,
               COALESCE(ech.ca_contractualise, 0) AS ca_contractualise
       FROM contrats_clients cc
       LEFT JOIN users u ON u.id = cc.user_id
       LEFT JOIN (SELECT contrat_client_id, SUM(montant) AS total_verse
                  FROM versements GROUP BY contrat_client_id) ve ON ve.contrat_client_id = cc.id
       LEFT JOIN (
         SELECT e.contrat_client_id, SUM(v.montant) AS total_verse
         FROM contrat_echeances e JOIN versements v ON v.contrat_echeance_id = e.id
         GROUP BY e.contrat_client_id
       ) vee ON vee.contrat_client_id = cc.id
       LEFT JOIN (
         SELECT contrat_client_id, SUM(montant) AS ca_contractualise
         FROM contrat_echeances GROUP BY contrat_client_id
       ) ech ON ech.contrat_client_id = cc.id
       WHERE cc.id=$1 AND cc.user_id = ANY($2::uuid[])`,
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('GET contrats/clients/:id', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/contrats/clients/:id/echeances — échéancier mensuel détaillé (quantité/prix/paiement par mois)
router.get('/clients/:id/echeances', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const owns = await pool.query(
      'SELECT id FROM contrats_clients WHERE id=$1 AND user_id = ANY($2::uuid[])',
      [req.params.id, ids]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });

    const result = await pool.query(
      `SELECT e.*, COALESCE(v.total_verse, 0) AS total_verse
       FROM contrat_echeances e
       LEFT JOIN (SELECT contrat_echeance_id, SUM(montant) AS total_verse
                  FROM versements GROUP BY contrat_echeance_id) v ON v.contrat_echeance_id = e.id
       WHERE e.contrat_client_id = $1
       ORDER BY e.annee, e.mois`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET contrats/clients/:id/echeances', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/contrats/clients/:id/echeances/:echeanceId — éditer la quantité/prix/date d'un mois précis
// Manager+ seulement, comme la modification du contrat lui-même.
router.put('/clients/:id/echeances/:echeanceId', requirePerm('ventes:statut'), async (req, res) => {
  try {
    const { quantite, prix_unitaire, date_paiement_prevue, note } = req.body;
    if (quantite !== undefined && quantite !== null && !isNonNegativeNumber(quantite))
      return res.status(400).json({ error: 'quantite doit etre un nombre positif ou nul' });
    if (prix_unitaire !== undefined && prix_unitaire !== null && !isNonNegativeNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif ou nul' });
    if (date_paiement_prevue && !isValidDate(date_paiement_prevue))
      return res.status(400).json({ error: 'date_paiement_prevue invalide (format YYYY-MM-DD attendu)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    const ids = await getScopeIds(req.userId, req.userRole);
    const owns = await pool.query(
      'SELECT id FROM contrats_clients WHERE id=$1 AND user_id = ANY($2::uuid[])',
      [req.params.id, ids]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });

    const result = await pool.query(
      `UPDATE contrat_echeances SET
         quantite = COALESCE($1, quantite),
         prix_unitaire = COALESCE($2, prix_unitaire),
         date_paiement_prevue = COALESCE($3, date_paiement_prevue),
         note = $4,
         updated_at = NOW()
       WHERE id=$5 AND contrat_client_id=$6 RETURNING *`,
      [quantite ?? null, prix_unitaire ?? null, date_paiement_prevue || null, note || null,
       req.params.echeanceId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Échéance non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('PUT contrats/clients/:id/echeances/:echeanceId', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/contrats/clients/:id — manager+ seulement
router.delete('/clients/:id', requirePerm('ventes:delete'), async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM contrats_clients WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════
// CONTRATS PADDY (amont)
// ══════════════════════════════════════════════

// GET /api/contrats/paddy
router.get('/paddy', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    await pool.query(
      `UPDATE contrats_paddy SET statut='Terminé'
       WHERE user_id = ANY($1::uuid[]) AND date_fin < CURRENT_DATE AND statut != 'Terminé'`,
      [ids]
    );
    const { statut } = req.query;
    let q = `SELECT cp.*, u.nom AS vendeur_nom
             FROM contrats_paddy cp
             LEFT JOIN users u ON u.id = cp.user_id
             WHERE cp.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND cp.statut = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY cp.statut, cp.producteur_nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('GET contrats/paddy', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/contrats/paddy
router.post('/paddy', async (req, res) => {
  try {
    const { producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note } = req.body;
    if (!producteur_nom) return res.status(400).json({ error: 'Nom du producteur requis' });
    if (quantite_kg !== undefined && quantite_kg !== null && !isNonNegativeNumber(quantite_kg))
      return res.status(400).json({ error: 'quantite_kg doit etre un nombre positif ou nul' });
    if (prix_kg !== undefined && prix_kg !== null && !isNonNegativeNumber(prix_kg))
      return res.status(400).json({ error: 'prix_kg doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(producteur_nom, 200)) return res.status(400).json({ error: 'producteur_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))          return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const numero = await nextNumero('contrats_paddy', 'CP', req.userId);
    const result = await pool.query(
      `INSERT INTO contrats_paddy (user_id, producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.userId, producteur_nom.trim(), zone || null, telephone || null,
       variete || null, quantite_kg || 0, prix_kg || 0,
       date_debut || null, date_fin || null, statut || 'Actif', note || null, numero]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST contrats/paddy', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/contrats/paddy/:id — manager+ seulement
router.put('/paddy/:id', requirePerm('ventes:statut'), async (req, res) => {
  try {
    const { producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note } = req.body;
    if (quantite_kg !== undefined && quantite_kg !== null && !isNonNegativeNumber(quantite_kg))
      return res.status(400).json({ error: 'quantite_kg doit etre un nombre positif ou nul' });
    if (prix_kg !== undefined && prix_kg !== null && !isNonNegativeNumber(prix_kg))
      return res.status(400).json({ error: 'prix_kg doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(producteur_nom, 200)) return res.status(400).json({ error: 'producteur_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))          return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `UPDATE contrats_paddy SET producteur_nom=$1, zone=$2, telephone=$3, variete=$4,
         quantite_kg=$5, prix_kg=$6, date_debut=$7, date_fin=$8, statut=$9, note=$10
       WHERE id=$11 AND user_id = ANY($12::uuid[]) RETURNING *`,
      [producteur_nom, zone || null, telephone || null, variete || null,
       quantite_kg || 0, prix_kg || 0, date_debut || null, date_fin || null,
       statut || 'Actif', note || null, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/contrats/paddy/:id — manager+ seulement
router.delete('/paddy/:id', requirePerm('ventes:delete'), async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM contrats_paddy WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
