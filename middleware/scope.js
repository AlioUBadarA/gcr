const { pool } = require('../db/pool');

async function getScopeIds(userId, role) {
  if (role === 'vendeur') return [userId];

  // Le comptable n'appartient pas à la hiérarchie commerciale (parent_id) : son périmètre
  // est toute la rizerie à laquelle il est rattaché, pour pouvoir valider les encaissements
  // déclarés par n'importe quel commercial de cette rizerie.
  if (role === 'comptable') {
    const r = await pool.query(
      `SELECT id FROM users
       WHERE rizerie_id = (SELECT rizerie_id FROM users WHERE id=$1)
         AND role IN ('rizier','directeur','manager','vendeur')`,
      [userId]
    );
    return r.rows.map(x => x.id);
  }

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
        WHERE u.role IN ('directeur','manager','vendeur') AND t.role IN ('directeur','manager')
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
