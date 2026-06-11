const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool } = require('../db/pool');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function canManage(req, res, next) {
  if (!['rizier', 'superadmin'].includes(req.userRole))
    return res.status(403).json({ error: 'Accès réservé au responsable de rizerie' });
  next();
}

// GET /api/equipe
router.get('/', canManage, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.email, u.telephone, u.suspended, u.created_at,
             COUNT(DISTINCT v.id)        AS nb_ventes,
             COALESCE(SUM(v.montant), 0) AS ca_total,
             MAX(v.date_vente)           AS derniere_vente
      FROM users u
      LEFT JOIN ventes v ON v.user_id = u.id
      WHERE u.parent_id = $1 AND u.role = 'vendeur'
      GROUP BY u.id
      ORDER BY u.nom
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/equipe — créer un vendeur
router.post('/', canManage, async (req, res) => {
  try {
    const { nom, email, password, telephone } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, telephone, role, parent_id)
       VALUES ($1,$2,$3,$4,'vendeur',$5)
       RETURNING id, nom, email, telephone, role, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash, telephone || null, req.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/equipe/:id
router.put('/:id', canManage, async (req, res) => {
  try {
    const { nom, email, telephone } = req.body;
    const result = await pool.query(
      `UPDATE users SET nom=$1, email=$2, telephone=$3
       WHERE id=$4 AND parent_id=$5 AND role='vendeur'
       RETURNING id, nom, email, telephone, role`,
      [nom, email?.toLowerCase(), telephone || null, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/equipe/:id/password
router.patch('/:id/password', canManage, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password=$1
       WHERE id=$2 AND parent_id=$3 AND role='vendeur'
       RETURNING id, nom, email`,
      [hash, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/equipe/:id
router.delete('/:id', canManage, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id=$1 AND parent_id=$2 AND role='vendeur' RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json({ message: 'Vendeur supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
