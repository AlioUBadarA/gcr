const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

const STATUTS   = ['Nouveau','Qualifié','Proposition','Négociation','Gagné','Perdu'];
const PRIORITES = ['Haute','Normale','Basse'];

// GET /api/prospection
router.get('/', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const { statut } = req.query;
    let q = `SELECT p.*, u.nom AS vendeur_nom
             FROM prospection p
             LEFT JOIN users u ON u.id = p.user_id
             WHERE p.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND p.statut = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY CASE p.priorite WHEN \'Haute\' THEN 1 WHEN \'Normale\' THEN 2 ELSE 3 END, p.created_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET prospection:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/prospection
router.post('/', async (req, res) => {
  try {
    const { nom, type_client, zone, region, source, telephone, statut, priorite, date_contact, note, valeur_estimee } = req.body;
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    const result = await pool.query(
      `INSERT INTO prospection (user_id, nom, type_client, zone, region, source, telephone, statut, priorite, date_contact, note, valeur_estimee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.userId, nom.trim(), type_client || null, zone || null, region || null, source || null, telephone || null,
       statut || 'Nouveau', priorite || 'Normale', date_contact || null, note || null, +valeur_estimee || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST prospection:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/prospection/:id
router.put('/:id', async (req, res) => {
  try {
    const { nom, type_client, zone, region, source, telephone, statut, priorite, date_contact, note, valeur_estimee } = req.body;
    if (statut && !STATUTS.includes(statut))
      return res.status(400).json({ error: 'Statut invalide' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `UPDATE prospection SET nom=$1, type_client=$2, zone=$3, region=$4, source=$5, telephone=$6,
         statut=$7, priorite=$8, date_contact=$9, note=$10, valeur_estimee=$11
       WHERE id=$12 AND user_id = ANY($13::uuid[]) RETURNING *`,
      [nom, type_client || null, zone || null, region || null, source || null, telephone || null,
       statut, priorite || 'Normale', date_contact || null, note || null, +valeur_estimee || 0,
       req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prospect non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/prospection/:id/statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'UPDATE prospection SET statut=$1 WHERE id=$2 AND user_id = ANY($3::uuid[]) RETURNING *',
      [statut, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prospect non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/prospection/:id
router.delete('/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM prospection WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prospect non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
