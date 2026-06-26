const jwt = require('jsonwebtoken');
const { VALID_ROLES } = require('./permissions');

function authMiddleware(req, res, next) {
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
    req.userId   = payload.userId;
    req.userNom  = payload.nom;
    req.userRole = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expire' });
  }
}

module.exports = authMiddleware;
