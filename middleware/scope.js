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

  // Rizier : toute la rizerie. Une rizerie peut avoir plusieurs riziers (co-responsables) ;
  // chacun voit l'activité de tous les comptes de la rizerie, y compris les équipes créées
  // par les autres riziers. Les membres sans rizerie_id sont rattrapés via la hiérarchie
  // parent_id partant de chacun des riziers de la rizerie.
  if (role === 'rizier') {
    const r = await pool.query(`
      WITH RECURSIVE me AS (
        SELECT rizerie_id FROM users WHERE id = $1
      ),
      roots AS (
        SELECT $1::uuid AS id
        UNION
        SELECT u.id FROM users u, me
        WHERE u.role = 'rizier' AND me.rizerie_id IS NOT NULL AND u.rizerie_id = me.rizerie_id
      ),
      team AS (
        SELECT u.id, u.role FROM users u
          INNER JOIN roots ro ON u.parent_id = ro.id
          WHERE u.role IN ('directeur','manager','vendeur')
        UNION ALL
        SELECT u.id, u.role FROM users u
          INNER JOIN team t ON u.parent_id = t.id
          WHERE u.role IN ('directeur','manager','vendeur') AND t.role IN ('directeur','manager')
      )
      SELECT id FROM roots
      UNION
      SELECT id FROM team
      UNION
      SELECT u.id FROM users u, me
      WHERE me.rizerie_id IS NOT NULL AND u.rizerie_id = me.rizerie_id
        AND u.role IN ('rizier','directeur','manager','vendeur')
    `, [userId]);
    const ids = r.rows.map(x => x.id).filter(id => id !== userId);
    return [userId, ...ids];
  }

  // directeur : toute la hiérarchie commerciale en dessous (récursif)
  // directeur → managers + vendeurs sous ces managers + vendeurs directs
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
