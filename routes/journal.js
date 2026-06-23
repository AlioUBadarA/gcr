const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

// GET /api/journal?from=YYYY-MM-DD&to=YYYY-MM-DD — journal de caisse du jour/période
router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to   = req.query.to   || today;
    const ids  = req.scopeIds;

    const [ventesR, versementsR] = await Promise.all([
      pool.query(
        `SELECT v.*, u.nom AS vendeur_nom
         FROM ventes v
         LEFT JOIN users u ON u.id = v.user_id
         WHERE v.user_id = ANY($1::uuid[]) AND v.date_vente BETWEEN $2 AND $3
         ORDER BY v.date_vente DESC, v.created_at DESC`,
        [ids, from, to]
      ),
      pool.query(
        `SELECT ve.*, v.client_nom, v.user_id
         FROM versements ve
         JOIN ventes v ON v.id = ve.vente_id
         WHERE v.user_id = ANY($1::uuid[]) AND ve.date BETWEEN $2 AND $3
         ORDER BY ve.date DESC, ve.created_at DESC`,
        [ids, from, to]
      ),
    ]);

    res.json({ from, to, ventes: ventesR.rows, versements: versementsR.rows });
  } catch (err) {
    console.error('GET journal:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
