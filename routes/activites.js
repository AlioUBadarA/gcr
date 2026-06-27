const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

const TYPES = ['Visite client', 'Appel', 'Réunion', 'Démonstration', 'Négociation', 'Relance', 'Contrat signé'];
const RESULTATS = ['Positif', 'Négatif', 'Neutre'];

// GET /api/activites
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.nom AS vendeur_nom
       FROM activites a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ANY($1::uuid[])
       ORDER BY a.date DESC, a.created_at DESC
       LIMIT 300`,
      [req.scopeIds]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/activites
router.post('/', async (req, res) => {
  try {
    const { date, type, cible, resultat, note } = req.body;
    if (!type || !TYPES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
    if (resultat && !RESULTATS.includes(resultat)) return res.status(400).json({ error: 'Résultat invalide' });

    const result = await pool.query(
      `INSERT INTO activites (user_id, date, type, cible, resultat, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, date || new Date().toISOString().slice(0, 10), type, cible || null, resultat || 'Neutre', note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST activites', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/activites/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM activites WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, req.scopeIds]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Activité non trouvée' });
    res.json({ message: 'Activité supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
