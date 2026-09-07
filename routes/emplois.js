const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const logger  = require('../utils/logger');
const auth = require('../middleware/auth');
const { isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');
const { peutCreerRole, createComptePlateforme, ROLES_PLATEFORME } = require('../utils/comptes');

const router = express.Router();
router.use(auth);

const TYPES = ['CDI','CDD','Temps partiel','Stage','Journalier'];
const SEXES = ['Homme','Femme'];
const PIECES_IDENTITE = ['CNI','Passeport','Permis de conduire','Autre'];

// Champs état civil communs à la création et la modification d'une fiche employé.
function etatCivilFields(body) {
  const { date_naissance, lieu_naissance, sexe, nationalite, piece_identite_type, piece_identite_numero, adresse } = body;
  return { date_naissance, lieu_naissance, sexe, nationalite, piece_identite_type, piece_identite_numero, adresse };
}

function validateEtatCivil({ date_naissance, sexe, piece_identite_type }) {
  if (date_naissance && !isValidDate(date_naissance)) return 'date_naissance invalide (format YYYY-MM-DD attendu)';
  if (sexe && !SEXES.includes(sexe)) return 'sexe invalide';
  if (piece_identite_type && !PIECES_IDENTITE.includes(piece_identite_type)) return 'piece_identite_type invalide';
  return null;
}

// GET /api/emplois
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, u.email AS compte_email, u.suspended AS compte_suspendu
       FROM emplois e
       LEFT JOIN users u ON u.id = e.user_account_id
       WHERE e.user_id = $1 ORDER BY e.nom`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET emplois', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/emplois/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, u.email AS compte_email, u.suspended AS compte_suspendu
       FROM emplois e
       LEFT JOIN users u ON u.id = e.user_account_id
       WHERE e.id=$1 AND e.user_id=$2`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/emplois
// Si role_plateforme est fourni (vendeur|manager|directeur), crée automatiquement
// un compte plateforme lié à la rizerie du créateur.
router.post('/', async (req, res) => {
  try {
    const { nom, poste, type_contrat, date_embauche, salaire, telephone, note,
            role_plateforme, email, password, periode_rizao } = req.body;
    const etatCivil = etatCivilFields(req.body);
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    if (salaire !== undefined && salaire !== null && !isNonNegativeNumber(salaire))
      return res.status(400).json({ error: 'salaire doit etre un nombre positif ou nul' });
    if (date_embauche && !isValidDate(date_embauche))
      return res.status(400).json({ error: 'date_embauche invalide (format YYYY-MM-DD attendu)' });
    if (type_contrat && !TYPES.includes(type_contrat))
      return res.status(400).json({ error: 'type_contrat invalide' });
    if (!maxLen(nom, 200))   return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const etatCivilErr = validateEtatCivil(etatCivil);
    if (etatCivilErr) return res.status(400).json({ error: etatCivilErr });

    // Même matrice de permissions que routes/equipe.js (utils/comptes.js) : un directeur ne
    // peut pas créer un autre directeur, réservé au rizier.
    if (role_plateforme && !peutCreerRole(req.userRole, role_plateforme)) {
      return res.status(403).json({ error: 'Vous n\'avez pas le droit de créer ce type de compte' });
    }

    const periodeVal = ['Avant RIZAO', 'Avec RIZAO'].includes(periode_rizao) ? periode_rizao : 'Avec RIZAO';

    // Création atomique : compte plateforme + fiche employé dans la même transaction.
    // Le compte est créé via le même point d'entrée que routes/equipe.js (createComptePlateforme)
    // pour ne pas faire diverger la logique de création de compte entre les deux modules.
    const emploi = await withTransaction(async (client) => {
      let accountId = null;
      if (role_plateforme) {
        const user = await createComptePlateforme(client, {
          nom, email, password, role: role_plateforme, telephone,
          parentId: role_plateforme === 'comptable' ? null : req.userId, creatorId: req.userId,
        });
        accountId = user.id;
      }
      const r = await client.query(
        `INSERT INTO emplois
           (user_id, nom, poste, type_contrat, date_embauche, salaire, telephone, note,
            user_account_id, role_plateforme, periode_rizao,
            date_naissance, lieu_naissance, sexe, nationalite, piece_identite_type, piece_identite_numero, adresse)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [req.userId, nom.trim(), poste || null, type_contrat || 'CDI',
         date_embauche || null, salaire || null, telephone || null, note || null,
         accountId, role_plateforme || null, periodeVal,
         etatCivil.date_naissance || null, etatCivil.lieu_naissance || null, etatCivil.sexe || null,
         etatCivil.nationalite || null, etatCivil.piece_identite_type || null,
         etatCivil.piece_identite_numero || null, etatCivil.adresse || null]
      );
      return r.rows[0];
    });
    res.status(201).json(emploi);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('POST emplois', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/emplois/:id
router.put('/:id', async (req, res) => {
  try {
    const { nom, poste, type_contrat, date_embauche, salaire, telephone, note, periode_rizao } = req.body;
    const etatCivil = etatCivilFields(req.body);
    if (salaire !== undefined && salaire !== null && !isNonNegativeNumber(salaire))
      return res.status(400).json({ error: 'salaire doit etre un nombre positif ou nul' });
    if (date_embauche && !isValidDate(date_embauche))
      return res.status(400).json({ error: 'date_embauche invalide (format YYYY-MM-DD attendu)' });
    if (type_contrat && !TYPES.includes(type_contrat))
      return res.status(400).json({ error: 'type_contrat invalide' });
    if (!maxLen(nom, 200))   return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const etatCivilErr = validateEtatCivil(etatCivil);
    if (etatCivilErr) return res.status(400).json({ error: etatCivilErr });
    const periodeVal = ['Avant RIZAO', 'Avec RIZAO'].includes(periode_rizao) ? periode_rizao : 'Avec RIZAO';
    const result = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE emplois SET nom=$1, poste=$2, type_contrat=$3, date_embauche=$4,
           salaire=$5, telephone=$6, note=$7, periode_rizao=$8,
           date_naissance=$11, lieu_naissance=$12, sexe=$13, nationalite=$14,
           piece_identite_type=$15, piece_identite_numero=$16, adresse=$17
         WHERE id=$9 AND user_id=$10 RETURNING *`,
        [nom, poste || null, type_contrat || 'CDI', date_embauche || null,
         salaire || null, telephone || null, note || null, periodeVal,
         req.params.id, req.userId,
         etatCivil.date_naissance || null, etatCivil.lieu_naissance || null, etatCivil.sexe || null,
         etatCivil.nationalite || null, etatCivil.piece_identite_type || null,
         etatCivil.piece_identite_numero || null, etatCivil.adresse || null]
      );
      // Le nom et le téléphone du compte plateforme lié (s'il existe) suivent la fiche
      // emploi, pour ne pas laisser diverger les deux enregistrements créés ensemble.
      if (r.rows.length && r.rows[0].user_account_id) {
        await client.query(
          `UPDATE users SET nom=$1, telephone=$2 WHERE id=$3`,
          [nom, telephone || null, r.rows[0].user_account_id]
        );
      }
      return r.rows[0];
    });
    if (!result) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result);
  } catch (err) {
    logger.error('PUT emplois', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/emplois/:id/affecter
// Affecte un rôle plateforme (et donc un compte utilisateur) à un employé après sa création —
// la fiche RH (personne + emploi) peut exister seule un moment avant qu'on décide si cette
// personne doit avoir accès à l'application, et avec quel rôle (y compris comptable).
// Ne gère que la première affectation (pas de compte encore lié) : changer le rôle d'un
// compte déjà créé (promotion, réassignation manager...) reste géré depuis la page Équipe,
// qui porte déjà cette logique de hiérarchie plus fine.
router.patch('/:id/affecter', async (req, res) => {
  try {
    const { role_plateforme, email, password, objectif_annuel } = req.body;
    if (!ROLES_PLATEFORME.includes(role_plateforme)) {
      return res.status(400).json({ error: 'Rôle plateforme invalide (vendeur, manager, directeur, comptable)' });
    }
    if (!peutCreerRole(req.userRole, role_plateforme)) {
      return res.status(403).json({ error: 'Vous n\'avez pas le droit d\'affecter ce rôle' });
    }
    if (objectif_annuel !== undefined && objectif_annuel !== null && !isNonNegativeNumber(objectif_annuel)) {
      return res.status(400).json({ error: 'objectif_annuel doit etre un nombre positif ou nul' });
    }

    const emploi = await withTransaction(async (client) => {
      const emploiR = await client.query(
        'SELECT * FROM emplois WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [req.params.id, req.userId]
      );
      if (!emploiR.rows.length) { const e = new Error('Employé non trouvé'); e.status = 404; throw e; }
      const existing = emploiR.rows[0];
      if (existing.user_account_id) {
        const e = new Error('Cette fiche a déjà un compte lié — gérez son rôle depuis la page Équipe');
        e.status = 400; throw e;
      }

      const user = await createComptePlateforme(client, {
        nom: existing.nom, email, password, role: role_plateforme, telephone: existing.telephone,
        parentId: role_plateforme === 'comptable' ? null : req.userId, creatorId: req.userId,
      });

      const r = await client.query(
        `UPDATE emplois SET user_account_id=$1, role_plateforme=$2 WHERE id=$3 RETURNING *`,
        [user.id, role_plateforme, req.params.id]
      );

      // Objectif annuel optionnel pour un rôle commercial : réparti également sur les 12 mois
      // de l'année en cours (table forecast, même source de vérité que la page Prévisions —
      // ajustable ensuite mois par mois depuis cette page si besoin).
      if (objectif_annuel && ['vendeur', 'manager', 'directeur'].includes(role_plateforme)) {
        const annee = new Date().getFullYear();
        const mensuel = Math.round(+objectif_annuel / 12);
        for (let mois = 1; mois <= 12; mois++) {
          await client.query(
            `INSERT INTO forecast (user_id, annee, mois, produit, objectif_montant)
             VALUES ($1,$2,$3,'Général',$4)
             ON CONFLICT (user_id, annee, mois, produit) DO UPDATE SET objectif_montant = EXCLUDED.objectif_montant, updated_at = NOW()`,
            [user.id, annee, mois, mensuel]
          );
        }
      }

      return r.rows[0];
    });
    res.json(emploi);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('PATCH emplois affecter', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/emplois/:id
// Suspend le compte plateforme lié (s'il existe) dans la même transaction que la suppression.
router.delete('/:id', async (req, res) => {
  try {
    const found = await withTransaction(async (client) => {
      const result = await client.query(
        'DELETE FROM emplois WHERE id=$1 AND user_id=$2 RETURNING id, user_account_id',
        [req.params.id, req.userId]
      );
      if (!result.rows.length) return false;

      if (result.rows[0].user_account_id) {
        await client.query(
          `UPDATE users SET suspended=TRUE, suspended_at=NOW(), suspended_reason='Employé retiré'
           WHERE id=$1`,
          [result.rows[0].user_account_id]
        );
      }
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
