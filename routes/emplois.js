const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool, withTransaction } = require('../db/pool');
const logger  = require('../utils/logger');
const auth = require('../middleware/auth');
const { isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth);

const TYPES = ['CDI','CDD','Temps partiel','Stage','Journalier'];
const ROLES_PLATEFORME = ['vendeur','manager','directeur'];

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

    let userAccountId = null;

    if (role_plateforme) {
      if (!ROLES_PLATEFORME.includes(role_plateforme))
        return res.status(400).json({ error: 'Rôle plateforme invalide (vendeur, manager, directeur)' });

      // Seul directeur/rizier peut créer des comptes ; manager peut créer vendeur uniquement
      const peutCreer = ['rizier', 'directeur'].includes(req.userRole)
        || (req.userRole === 'manager' && role_plateforme === 'vendeur');
      if (!peutCreer)
        return res.status(403).json({ error: 'Vous n\'avez pas le droit de créer ce type de compte' });

      if (!email)
        return res.status(400).json({ error: 'Email requis pour créer un compte plateforme' });
      if (!password || password.length < 12)
        return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

      const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
      if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const periodeVal = ['Avant RIZAO', 'Avec RIZAO'].includes(periode_rizao) ? periode_rizao : 'Avec RIZAO';

    // Création atomique : compte plateforme + fiche employé dans la même transaction
    const emploi = await withTransaction(async (client) => {
      let accountId = null;
      if (role_plateforme) {
        const creatorR = await client.query(
          'SELECT rizerie_id, rizerie FROM users WHERE id=$1', [req.userId]
        );
        const creator = creatorR.rows[0] || {};
        const hash = await bcrypt.hash(password, 12);
        const userR = await client.query(
          `INSERT INTO users (nom, email, password, role, parent_id, rizerie_id, rizerie)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [nom.trim(), email.toLowerCase().trim(), hash, role_plateforme,
           req.userId, creator.rizerie_id || null, creator.rizerie || null]
        );
        accountId = userR.rows[0].id;
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
    const result = await pool.query(
      `UPDATE emplois SET nom=$1, poste=$2, type_contrat=$3, date_embauche=$4,
         salaire=$5, telephone=$6, note=$7, periode_rizao=$8
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [nom, poste || null, type_contrat || 'CDI', date_embauche || null,
       salaire || null, telephone || null, note || null, periodeVal,
       req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
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
