const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

const TENDANCES = ['hausse', 'stable', 'déclin'];

// Seuls manager, directeur, rizier et superadmin peuvent modifier le catalogue
function canWrite(req, res, next) {
  if (!['manager', 'directeur', 'rizier', 'superadmin'].includes(req.userRole))
    return res.status(403).json({ error: 'Modification du catalogue réservée aux managers et directeurs' });
  next();
}

async function getUserRizerieId(userId) {
  const r = await pool.query('SELECT rizerie_id FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.rizerie_id || null;
}

// GET /api/produits — tous les produits de la rizerie (lecture pour tous)
router.get('/', async (req, res) => {
  try {
    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId) return res.json([]);
    const result = await pool.query(
      'SELECT * FROM produits WHERE rizerie_id = $1 ORDER BY nom',
      [rizerieId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/produits — manager/directeur/rizier uniquement
router.post('/', canWrite, async (req, res) => {
  try {
    const { ref, nom, prix_kg, cout_kg, tendance } = req.body;
    if (!ref || !nom) return res.status(400).json({ error: 'Référence et nom requis' });
    if (tendance && !TENDANCES.includes(tendance)) return res.status(400).json({ error: 'Tendance invalide' });

    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId) return res.status(400).json({ error: 'Compte non rattaché à une rizerie' });

    const result = await pool.query(
      `INSERT INTO produits (user_id, rizerie_id, ref, nom, prix_kg, cout_kg, tendance)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.userId, rizerieId, ref.trim(), nom.trim(), prix_kg || 0, cout_kg || 0, tendance || 'stable']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Référence déjà utilisée dans cette rizerie' });
    logger.error('POST produits', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/produits/:id — manager/directeur/rizier uniquement
router.put('/:id', canWrite, async (req, res) => {
  try {
    const { ref, nom, prix_kg, cout_kg, tendance } = req.body;
    if (tendance && !TENDANCES.includes(tendance)) return res.status(400).json({ error: 'Tendance invalide' });

    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId) return res.status(400).json({ error: 'Compte non rattaché à une rizerie' });

    const result = await pool.query(
      `UPDATE produits SET ref=$1, nom=$2, prix_kg=$3, cout_kg=$4, tendance=$5, updated_at=NOW()
       WHERE id=$6 AND rizerie_id=$7 RETURNING *`,
      [ref, nom, prix_kg || 0, cout_kg || 0, tendance || 'stable', req.params.id, rizerieId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Référence déjà utilisée dans cette rizerie' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/produits/:id — manager/directeur/rizier uniquement
router.delete('/:id', canWrite, async (req, res) => {
  try {
    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId) return res.status(400).json({ error: 'Compte non rattaché à une rizerie' });

    const result = await pool.query(
      'DELETE FROM produits WHERE id=$1 AND rizerie_id=$2 RETURNING id',
      [req.params.id, rizerieId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json({ message: 'Produit supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
