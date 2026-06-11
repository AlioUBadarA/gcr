const { pool } = require('../db/pool');

async function getScopeIds(userId, role) {
  if (role === 'vendeur') return [userId];
  const r = await pool.query(
    "SELECT id FROM users WHERE parent_id = $1 AND role = 'vendeur'",
    [userId]
  );
  return [userId, ...r.rows.map(x => x.id)];
}

module.exports = { getScopeIds };
