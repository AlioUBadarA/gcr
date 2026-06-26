const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { VALID_ROLES } = require('./permissions');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Fail closed : role absent ou invalide = accès refusé, jamais de rôle par défaut.
    if (!payload.userId || !VALID_ROLES.has(payload.role)) {
      return res.status(401).json({ error: 'Token invalide ou expire' });
    }

    // Vérification serveur : compte suspendu ou token révoqué = rejet immédiat.
    // token_revoked_at est positionné à NOW() lors d'une suspension.
    // Tout token émis avant cette date est invalide, même s'il n'a pas encore expiré.
    const userR = await pool.query(
      'SELECT suspended, token_revoked_at FROM users WHERE id=$1',
      [payload.userId]
    );
    if (!userR.rows.length) {
      return res.status(401).json({ error: 'Token invalide ou expire' });
    }
    const u = userR.rows[0];
    if (u.suspended) {
      return res.status(401).json({ error: 'Compte suspendu' });
    }
    if (u.token_revoked_at) {
      const revokedMs = new Date(u.token_revoked_at).getTime();
      if (payload.iat * 1000 < revokedMs) {
        return res.status(401).json({ error: 'Token invalide ou expire' });
      }
    }

    req.userId   = payload.userId;
    req.userNom  = payload.nom;
    req.userRole = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expire' });
  }
}

module.exports = authMiddleware;
