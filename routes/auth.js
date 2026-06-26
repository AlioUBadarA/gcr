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
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis' });

    const result = await pool.query(
      `SELECT u.id, u.nom, u.email, u.password, u.rizerie, u.telephone, u.ville,
              u.role, u.suspended, u.suspended_reason,
              u.login_attempts, u.locked_until, r.pays
       FROM users u
       LEFT JOIN rizeries r ON r.id = u.rizerie_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    // Réponse générique pour ne pas révéler si l'email existe
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Vérifier le lockout avant la comparaison du mot de passe
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const secondes = Math.ceil((new Date(user.locked_until) - new Date()) / 1000);
      const minutes  = Math.ceil(secondes / 60);
      return res.status(429).json({
        error: `Trop de tentatives. Compte bloqué pour encore ${minutes} minute${minutes > 1 ? 's' : ''}.`
      });
    }

    if (user.suspended)
      return res.status(403).json({ error: `Compte suspendu${user.suspended_reason ? ' : ' + user.suspended_reason : ''}` });

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      // Incrémenter le compteur d'échecs et verrouiller si seuil atteint
      const newAttempts = (user.login_attempts || 0) + 1;
      const lockUntil = newAttempts >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        : null;
      await pool.query(
        `UPDATE users SET login_attempts=$1, locked_until=$2 WHERE id=$3`,
        [newAttempts, lockUntil, user.id]
      );
      if (newAttempts >= MAX_ATTEMPTS) {
        return res.status(429).json({
          error: `Trop de tentatives. Compte bloqué pour ${LOCK_MINUTES} minutes.`
        });
      }
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Connexion réussie : réinitialiser les compteurs
    await pool.query(
      `UPDATE users SET login_attempts=0, locked_until=NULL WHERE id=$1`,
      [user.id]
    );

    const token = jwt.sign(
      { userId: user.id, nom: user.nom, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, nom: user.nom, email: user.email, rizerie: user.rizerie, telephone: user.telephone, ville: user.ville, role: user.role, pays: user.pays || null } });
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
      `SELECT u.id, u.nom, u.email, u.rizerie, u.telephone, u.ville, u.role, u.created_at, r.pays
       FROM users u
       LEFT JOIN rizeries r ON r.id = u.rizerie_id
       WHERE u.id = $1`,
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
