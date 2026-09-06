const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const logger  = require('../utils/logger');
const auth = require('../middleware/auth');
const { isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');
const { peutCreerRole, createComptePlateforme } = require('../utils/comptes');

const router = express.Router();
router.use(auth);

const TYPES = ['CDI','CDD','Temps partiel','Stage','Journalier'];

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
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    if (salaire !== undefined && salaire !== null && !isNonNegativeNumber(salaire))
      return res.status(400).json({ error: 'salaire doit etre un nombre positif ou nul' });
    if (date_embauche && !isValidDate(date_embauche))
      return res.status(400).json({ error: 'date_embauche invalide (format YYYY-MM-DD attendu)' });
    if (type_contrat && !TYPES.includes(type_contrat))
      return res.status(400).json({ error: 'type_contrat invalide' });
    if (!maxLen(nom, 200))   return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

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
          parentId: req.userId, creatorId: req.userId,
        });
        accountId = user.id;
      }
      const r = await client.query(
        `INSERT INTO emplois
           (user_id, nom, poste, type_contrat, date_embauche, salaire, telephone, note,
            user_account_id, role_plateforme, periode_rizao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.userId, nom.trim(), poste || null, type_contrat || 'CDI',
         date_embauche || null, salaire || null, telephone || null, note || null,
         accountId, role_plateforme || null, periodeVal]
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
    if (salaire !== undefined && salaire !== null && !isNonNegativeNumber(salaire))
      return res.status(400).json({ error: 'salaire doit etre un nombre positif ou nul' });
    if (date_embauche && !isValidDate(date_embauche))
      return res.status(400).json({ error: 'date_embauche invalide (format YYYY-MM-DD attendu)' });
    if (type_contrat && !TYPES.includes(type_contrat))
      return res.status(400).json({ error: 'type_contrat invalide' });
    if (!maxLen(nom, 200))   return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const periodeVal = ['Avant RIZAO', 'Avec RIZAO'].includes(periode_rizao) ? periode_rizao : 'Avec RIZAO';
    const result = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE emplois SET nom=$1, poste=$2, type_contrat=$3, date_embauche=$4,
           salaire=$5, telephone=$6, note=$7, periode_rizao=$8
         WHERE id=$9 AND user_id=$10 RETURNING *`,
        [nom, poste || null, type_contrat || 'CDI', date_embauche || null,
         salaire || null, telephone || null, note || null, periodeVal,
         req.params.id, req.userId]
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
