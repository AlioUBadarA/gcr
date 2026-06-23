const { pool } = require('../db/pool');

async function getScopeIds(userId, role) {
  if (role === 'vendeur') return [userId];

  if (role === 'manager') {
    const r = await pool.query(
      "SELECT id FROM users WHERE parent_id = $1 AND role = 'vendeur'",
      [userId]
    );
    return [userId, ...r.rows.map(x => x.id)];
  }

  // rizier : lui-même + ses managers + les vendeurs de chaque manager + les vendeurs
  // rattachés directement à lui (hiérarchie à 2 ou 3 niveaux selon l'équipe).
  const managers = await pool.query(
    "SELECT id FROM users WHERE parent_id = $1 AND role = 'manager'",
    [userId]
  );
  const managerIds = managers.rows.map(x => x.id);

  const directVendeurs = await pool.query(
    "SELECT id FROM users WHERE parent_id = $1 AND role = 'vendeur'",
    [userId]
  );

  let teamVendeurIds = [];
  if (managerIds.length) {
    const team = await pool.query(
      "SELECT id FROM users WHERE parent_id = ANY($1) AND role = 'vendeur'",
      [managerIds]
    );
    teamVendeurIds = team.rows.map(x => x.id);
  }

  return [userId, ...managerIds, ...directVendeurs.rows.map(x => x.id), ...teamVendeurIds];
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
