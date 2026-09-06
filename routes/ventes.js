const express = require('express');
const { pool, nextNumero, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { findOrCreateClient } = require('./clients');
const { isPositiveNumber, isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');
const { enregistrerVersement } = require('../utils/versements');
const { CONDITIONS_PAIEMENT, echeanceParDefaut, montantAttenduProchaineEcheance } = require('../utils/paiement');

const router = express.Router();
router.use(auth, attachScopeIds);

// Doit matcher exactement la contrainte CHECK sur ventes.statut_paiement (gcr/db/schema.sql)
const STATUTS = ['En cours','En retard','Paye'];
const MODES   = ['Espèces','Virement','Chèque','Mobile Money'];

// Ajoute le montant attendu à la prochaine échéance (dérivé des conditions de paiement et du
// total déjà versé) à chaque ligne — voir demande "statut de vente : prochaine échéance
// toujours visible".
function withMontantAttendu(rows) {
  return rows.map((r) => ({
    ...r,
    montant_attendu_prochaine_echeance: montantAttenduProchaineEcheance(
      r.conditions_paiement, r.montant, r.total_verse || 0
    ),
  }));
}

// GET /api/ventes  (avec filtres)
router.get('/', async (req, res) => {
  try {
    const { mois, annee, statut, client_id, vendeur_id } = req.query;
    const limit  = Math.min(Math.max(0, parseInt(req.query.limit)  || 200), 500);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const ids = req.scopeIds;
    let q = `SELECT v.*, c.type as client_type, u.nom as vendeur_nom,
                    COALESCE(ve.total_verse, 0) AS total_verse,
                    COALESCE(rl.nb_relances, 0) AS nb_relances,
                    rl.derniere_relance
             FROM ventes v
             LEFT JOIN clients c ON v.client_id = c.id
             LEFT JOIN users u ON u.id = v.user_id
             LEFT JOIN (SELECT vente_id, SUM(montant) AS total_verse FROM versements GROUP BY vente_id) ve ON ve.vente_id = v.id
             LEFT JOIN (SELECT vente_id, COUNT(*) AS nb_relances, MAX(date) AS derniere_relance FROM relances GROUP BY vente_id) rl ON rl.vente_id = v.id
             WHERE v.user_id = ANY($1::uuid[])`;
    const params = [ids];

    if (mois && annee) {
      q += ` AND EXTRACT(MONTH FROM date_vente) = $${params.length+1}
             AND EXTRACT(YEAR  FROM date_vente) = $${params.length+2}`;
      params.push(+mois, +annee);
    } else if (annee) {
      q += ` AND EXTRACT(YEAR FROM date_vente) = $${params.length+1}`;
      params.push(+annee);
    }
    if (statut && STATUTS.includes(statut)) {
      q += ` AND statut_paiement = $${params.length+1}`; params.push(statut);
    }
    if (client_id) {
      q += ` AND v.client_id = $${params.length+1}`; params.push(client_id);
    }
    if (vendeur_id && req.scopeIds.includes(vendeur_id)) {
      q += ` AND v.user_id = $${params.length+1}`; params.push(vendeur_id);
    }
    q += ` ORDER BY date_vente DESC, v.created_at DESC
           LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(+limit, +offset);

    const result = await pool.query(q, params);
    res.json(withMontantAttendu(result.rows));
  } catch (err) {
    logger.error('GET ventes', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes
router.post('/', async (req, res) => {
  try {
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note, telephone, conditions_paiement } = req.body;
    if (!client_nom || !date_vente || !produit || !quantite || !prix_unitaire)
      return res.status(400).json({ error: 'Champs requis : client_nom, date_vente, produit, quantite, prix_unitaire' });
    if (!isPositiveNumber(quantite))
      return res.status(400).json({ error: 'quantite doit etre un nombre positif' });
    if (!isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (cout_unitaire !== undefined && cout_unitaire !== null && !isNonNegativeNumber(cout_unitaire))
      return res.status(400).json({ error: 'cout_unitaire doit etre un nombre positif ou nul' });
    if (!isValidDate(date_vente))
      return res.status(400).json({ error: 'date_vente invalide (format YYYY-MM-DD attendu)' });
    if (date_echeance && !isValidDate(date_echeance))
      return res.status(400).json({ error: 'date_echeance invalide (format YYYY-MM-DD attendu)' });
    if (statut_paiement && !STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'statut_paiement invalide' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (conditions_paiement && !CONDITIONS_PAIEMENT.includes(conditions_paiement))
      return res.status(400).json({ error: 'conditions_paiement invalide' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(produit, 200))    return res.status(400).json({ error: 'produit trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    // L'échéance explicite prime toujours ; à défaut, elle se déduit des conditions de
    // paiement (ex: J+30 → date_vente + 30 jours) plutôt que de rester vide.
    const resolvedEcheance = date_echeance || (conditions_paiement ? echeanceParDefaut(conditions_paiement, date_vente) : null);

    // Rattache la vente à un client existant (ou le crée) pour garder le portefeuille à jour.
    let resolvedClientId = client_id || null;
    if (!resolvedClientId) {
      const client = await findOrCreateClient(req.userId, client_nom, telephone);
      resolvedClientId = client.id;
    } else {
      await pool.query(
        "UPDATE clients SET statut='Actif' WHERE id=$1 AND user_id=$2 AND statut='Prospect'",
        [client_id, req.userId]
      );
    }

    const numero = await nextNumero('ventes', 'V', req.userId);
    const result = await pool.query(
      `INSERT INTO ventes (user_id, client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note, numero, conditions_paiement)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.userId, resolvedClientId, client_nom.trim(), date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement || 'En cours',
       resolvedEcheance, mode || null, cout_unitaire || 0, note || null, numero, conditions_paiement || null]
    );

    res.status(201).json(withMontantAttendu(result.rows)[0]);
  } catch (err) {
    logger.error('POST ventes', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/ventes/:id
router.get('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const [venteR, verR] = await Promise.all([
      pool.query(
        `SELECT v.*,
           COALESCE(ve.total_verse, 0)  AS total_verse,
           COALESCE(rl.nb_relances, 0)  AS nb_relances,
           rl.derniere_relance
         FROM ventes v
         LEFT JOIN (SELECT vente_id, SUM(montant) AS total_verse FROM versements GROUP BY vente_id) ve ON ve.vente_id = v.id
         LEFT JOIN (SELECT vente_id, COUNT(*) AS nb_relances, MAX(date) AS derniere_relance FROM relances GROUP BY vente_id) rl ON rl.vente_id = v.id
         WHERE v.id=$1 AND v.user_id = ANY($2::uuid[])`,
        [req.params.id, ids]
      ),
      pool.query(
        'SELECT * FROM versements WHERE vente_id=$1 ORDER BY date DESC, created_at DESC',
        [req.params.id]
      ),
    ]);
    if (!venteR.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json({ ...withMontantAttendu(venteR.rows)[0], versements: verR.rows });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/ventes/:id
// Politique B5 : vendeur et manager ne modifient que leurs propres ventes.
// Directeur, rizier, support, superadmin : toute vente dans leur périmètre (scopeIds).
router.put('/:id', async (req, res) => {
  try {
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note, conditions_paiement } = req.body;
    if (!client_nom || !date_vente || !produit || !quantite || !prix_unitaire)
      return res.status(400).json({ error: 'Champs requis : client_nom, date_vente, produit, quantite, prix_unitaire' });
    if (statut_paiement && !STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'Statut invalide' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (conditions_paiement && !CONDITIONS_PAIEMENT.includes(conditions_paiement))
      return res.status(400).json({ error: 'conditions_paiement invalide' });
    if (!isPositiveNumber(quantite))
      return res.status(400).json({ error: 'quantite doit etre un nombre positif' });
    if (!isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (cout_unitaire !== undefined && cout_unitaire !== null && !isNonNegativeNumber(cout_unitaire))
      return res.status(400).json({ error: 'cout_unitaire doit etre un nombre positif ou nul' });
    if (date_vente && !isValidDate(date_vente))
      return res.status(400).json({ error: 'date_vente invalide (format YYYY-MM-DD attendu)' });
    if (date_echeance && !isValidDate(date_echeance))
      return res.status(400).json({ error: 'date_echeance invalide (format YYYY-MM-DD attendu)' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    // Vérifier que client_id, s'il est fourni, appartient bien à la rizerie de l'utilisateur
    if (client_id) {
      const { getScopeIds } = require('../middleware/scope');
      const rizerieR = await pool.query('SELECT rizerie_id FROM users WHERE id=$1', [req.userId]);
      const rizerieId = rizerieR.rows[0]?.rizerie_id;
      if (rizerieId) {
        const owns = await pool.query('SELECT id FROM clients WHERE id=$1 AND rizerie_id=$2', [client_id, rizerieId]);
        if (!owns.rows.length) return res.status(400).json({ error: 'client_id invalide' });
      }
    }

    const ownerOnly = ['vendeur', 'manager'].includes(req.userRole);
    const filterClause = ownerOnly
      ? 'user_id = $14'
      : 'user_id = ANY($14::uuid[])';
    const filterParam = ownerOnly ? req.userId : req.scopeIds;

    const result = await pool.query(
      `UPDATE ventes SET
         client_id=$1, client_nom=$2, date_vente=$3, produit=$4,
         quantite=$5, prix_unitaire=$6, statut_paiement=$7,
         date_echeance=$8, mode=$9, cout_unitaire=$10, note=$11, conditions_paiement=$12
       WHERE id=$13 AND ${filterClause} RETURNING *`,
      [client_id || null, client_nom, date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement,
       date_echeance || null, mode || null, cout_unitaire || 0, note || null, conditions_paiement || null,
       req.params.id, filterParam]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(withMontantAttendu(result.rows)[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/ventes/:id/statut
router.patch('/:id/statut', requirePerm('ventes:statut'), async (req, res) => {
  try {
    const { statut_paiement } = req.body;
    if (!STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'Statut invalide' });
    const ids = req.scopeIds;
    const result = await pool.query(
      'UPDATE ventes SET statut_paiement=$1 WHERE id=$2 AND user_id = ANY($3::uuid[]) RETURNING *',
      [statut_paiement, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/ventes/:id/versements
router.get('/:id/versements', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const owns = await pool.query('SELECT id FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, ids]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    const result = await pool.query('SELECT * FROM versements WHERE vente_id=$1 ORDER BY date DESC, created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes/:id/versements — enregistrer un encaissement (paiement échelonné)
router.post('/:id/versements', requirePerm('ventes:versement'), async (req, res) => {
  try {
    const { montant, mode, date } = req.body;
    if (!isPositiveNumber(montant)) return res.status(400).json({ error: 'montant doit etre un nombre positif' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'date invalide (format YYYY-MM-DD attendu)' });

    const ids = req.scopeIds;

    // Transaction + SELECT FOR UPDATE : empêche deux versements concurrents de dépasser le montant dû.
    const versement = await withTransaction(async (client) => {
      const venteR = await client.query(
        'SELECT * FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[]) FOR UPDATE',
        [req.params.id, ids]
      );
      if (!venteR.rows.length) { const e = new Error('Vente non trouvee'); e.status = 404; throw e; }
      const vente = venteR.rows[0];

      // Exclut les versements rejetés par le comptable : un rejet libère le montant pour
      // permettre une nouvelle déclaration correcte (voir routes/comptabilite.js).
      const totalDejaR = await client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM versements
         WHERE vente_id=$1 AND statut_validation != 'rejete'`, [req.params.id]
      );
      const totalDeja = +totalDejaR.rows[0].total;

      return enregistrerVersement(client, {
        column: 'vente_id', targetId: req.params.id, montant, mode, date,
        montantTotal: +vente.montant, totalDeja,
        statutTable: 'ventes', statutActuel: vente.statut_paiement,
        ownerUserId: vente.user_id, declaredBy: req.userId,
      });
    });

    res.status(201).json(versement);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('POST versements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes/:id/relances — enregistrer une relance de créance
router.post('/:id/relances', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const owns = await pool.query('SELECT id FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, ids]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    const result = await pool.query(
      `INSERT INTO relances (vente_id, date) VALUES ($1, $2) RETURNING *`,
      [req.params.id, req.body.date || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/ventes/:id
router.delete('/:id', requirePerm('ventes:delete'), async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'DELETE FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json({ message: 'Vente supprimee' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
