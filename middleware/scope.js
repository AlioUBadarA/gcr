const { pool } = require('../db/pool');

async function getScopeIds(userId, role) {
  if (role === 'vendeur') return [userId];
  const r = await pool.query(
    "SELECT id FROM users WHERE parent_id = $1 AND role = 'vendeur'",
    [userId]
  );
  return [userId, ...r.rows.map(x => x.id)];
}

// Middleware : résout le scope une fois par requête et l'attache à req.scopeIds,
// pour qu'aucune route /:id ne puisse oublier de l'appliquer (cf. bug clients/ventes).
async function attachScopeIds(req, res, next) {
  try {
    req.scopeIds = await getScopeIds(req.userId, req.userRole);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { getScopeIds, attachScopeIds };
