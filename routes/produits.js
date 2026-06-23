const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

const TENDANCES = ['hausse', 'stable', 'déclin'];

// GET /api/produits
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produits WHERE user_id = ANY($1::uuid[]) ORDER BY nom',
      [req.scopeIds]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/produits
router.post('/', async (req, res) => {
  try {
    const { ref, nom, prix_kg, cout_kg, tendance } = req.body;
    if (!ref || !nom) return res.status(400).json({ error: 'Référence et nom requis' });
    if (tendance && !TENDANCES.includes(tendance)) return res.status(400).json({ error: 'Tendance invalide' });

    const result = await pool.query(
      `INSERT INTO produits (user_id, ref, nom, prix_kg, cout_kg, tendance)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, ref.trim(), nom.trim(), prix_kg || 0, cout_kg || 0, tendance || 'stable']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Référence déjà utilisée' });
    console.error('POST produits:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/produits/:id
router.put('/:id', async (req, res) => {
  try {
    const { ref, nom, prix_kg, cout_kg, tendance } = req.body;
    if (tendance && !TENDANCES.includes(tendance)) return res.status(400).json({ error: 'Tendance invalide' });

    const result = await pool.query(
      `UPDATE produits SET ref=$1, nom=$2, prix_kg=$3, cout_kg=$4, tendance=$5, updated_at=NOW()
       WHERE id=$6 AND user_id = ANY($7::uuid[]) RETURNING *`,
      [ref, nom, prix_kg || 0, cout_kg || 0, tendance || 'stable', req.params.id, req.scopeIds]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/produits/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM produits WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, req.scopeIds]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json({ message: 'Produit supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
