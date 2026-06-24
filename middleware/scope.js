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

  // directeur et rizier : toute la hiérarchie commerciale en dessous (récursif)
  // directeur → managers + vendeurs sous ces managers + vendeurs directs
  // rizier → directeurs + tout ce qui est dessous (managers, vendeurs)
  const r = await pool.query(`
    WITH RECURSIVE team AS (
      SELECT id, role FROM users
      WHERE parent_id = $1 AND role IN ('directeur','manager','vendeur')
      UNION ALL
      SELECT u.id, u.role FROM users u
        INNER JOIN team t ON u.parent_id = t.id
        WHERE u.role IN ('manager','vendeur') AND t.role IN ('directeur','manager')
    )
    SELECT id FROM team
  `, [userId]);
  return [userId, ...r.rows.map(x => x.id)];
}

async function attachScopeIds(req, res, next) {
  try {
    req.scopeIds = await getScopeIds(req.userId, req.userRole);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { getScopeIds, attachScopeIds };
