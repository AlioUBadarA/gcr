const { pool } = require('../db/pool');
const logger = require('./logger');

// Écrit une entrée dans audit_logs. Ne fait jamais échouer l'action métier appelante si
// l'écriture du log échoue (erreur avalée et journalisée séparément).
async function log(actorId, actorNom, action, target, detail, ip) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_nom, action, target_id, target_nom, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actorId, actorNom, action, target?.id || null, target?.nom || null,
       detail ? JSON.stringify(detail) : null, ip || null]
    );
  } catch (e) {
    logger.error('audit log error', { err: e.message, stack: e.stack });
  }
}

module.exports = { log };
