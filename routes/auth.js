const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

const router = express.Router();

// POST /api/auth/register — DÉSACTIVÉ : les comptes sont créés uniquement par le superadmin
router.post('/register', (req, res) => {
  return res.status(403).json({
    error: 'Les inscriptions publiques sont fermées. Contactez l\'administrateur PFS pour obtenir un accès.'
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis' });

    const result = await pool.query(
      'SELECT id, nom, email, password, rizerie, telephone, ville, role, suspended, suspended_reason FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (!result.rows.length)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    if (user.suspended)
      return res.status(403).json({ error: `Compte suspendu${user.suspended_reason ? ' : ' + user.suspended_reason : ''}` });

    const token = jwt.sign(
      { userId: user.id, nom: user.nom, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '14d' }
    );

    res.json({ token, user: { id: user.id, nom: user.nom, email: user.email, rizerie: user.rizerie, telephone: user.telephone, ville: user.ville, role: user.role } });
  } catch (err) {
    console.error('login:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
const auth = require('../middleware/auth');
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, email, rizerie, telephone, ville, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/auth/me
router.put('/me', auth, async (req, res) => {
  try {
    const { nom, rizerie, telephone, ville } = req.body;
    const result = await pool.query(
      `UPDATE users SET nom=$1, rizerie=$2, telephone=$3, ville=$4
       WHERE id=$5
       RETURNING id, nom, email, rizerie, telephone, ville`,
      [nom, rizerie || null, telephone || null, ville || null, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
