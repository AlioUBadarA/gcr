const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

const TYPES_VALIDES = ['Grossiste','Detaillant marche','Boutique','Restauration','Cantine/Institution'];
const STATUTS_VALIDES = ['Actif','Prospect','Dormant'];

// GET /api/clients
router.get('/', async (req, res) => {
  try {
    const { statut, type, search } = req.query;
    const ids = await getScopeIds(req.userId, req.userRole);
    let q = `SELECT c.*, u.nom AS vendeur_nom
             FROM clients c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS_VALIDES.includes(statut)) {
      q += ` AND c.statut = $${params.length + 1}`; params.push(statut);
    }
    if (type && TYPES_VALIDES.includes(type)) {
      q += ` AND c.type = $${params.length + 1}`; params.push(type);
    }
    if (search) {
      q += ` AND (c.nom ILIKE $${params.length + 1} OR c.zone ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    q += ' ORDER BY c.statut, c.nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/clients
router.post('/', async (req, res) => {
  try {
    const { nom, type, statut, zone, telephone, volume_estime, frequence, valorise, horaire, note } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'Nom et type requis' });
    if (!TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide' });

    const result = await pool.query(
      `INSERT INTO clients (user_id, nom, type, statut, zone, telephone, volume_estime, frequence, valorise, horaire, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.userId, nom.trim(), type, statut || 'Prospect', zone || null, telephone || null,
       volume_estime || 0, frequence || null, valorise || null, horaire || null, note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND user_id = ANY($2::uuid[])',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  try {
    const { nom, type, statut, zone, telephone, volume_estime, frequence, valorise, horaire, note } = req.body;
    if (type && !TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
    if (statut && !STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });

    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `UPDATE clients SET
         nom=$1, type=$2, statut=$3, zone=$4, telephone=$5,
         volume_estime=$6, frequence=$7, valorise=$8, horaire=$9, note=$10
       WHERE id=$11 AND user_id = ANY($12::uuid[]) RETURNING *`,
      [nom, type, statut, zone || null, telephone || null,
       volume_estime || 0, frequence || null, valorise || null, horaire || null, note || null,
       req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/clients/:id/statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'UPDATE clients SET statut=$1 WHERE id=$2 AND user_id = ANY($3::uuid[]) RETURNING *',
      [statut, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM clients WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json({ message: 'Client supprime' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
