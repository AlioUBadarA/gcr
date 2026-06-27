const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

// GET /api/managers — rollup par manager : équipe, CA YTD, objectif, atteinte, projection, marge, créances
// (formule identique au HTML de référence : tauxAtteinte = caYTD / (objAnnuel/12*moisÉcoulés) * 100)
router.get('/', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const annee = new Date().getFullYear();
    const monthsElapsed = new Date().getMonth() + 1;

    const managersR = await pool.query(
      `SELECT id, nom, zone FROM users WHERE id = ANY($1::uuid[]) AND role='manager' ORDER BY nom`,
      [ids]
    );
    if (!managersR.rows.length) return res.json([]);
    const managerIds = managersR.rows.map(m => m.id);

    const vendeursR = await pool.query(
      `SELECT id, nom, parent_id FROM users WHERE parent_id = ANY($1::uuid[]) AND role='vendeur'`,
      [managerIds]
    );
    const vendeurs = vendeursR.rows;
    const vendeurIds = vendeurs.map(v => v.id);

    let ventesMap = {}, objMap = {}, creancesMap = {};
    if (vendeurIds.length) {
      const [ventesR, forecastR, creancesR] = await Promise.all([
        pool.query(
          `SELECT user_id, COALESCE(SUM(montant),0) AS ca,
                  COALESCE(SUM(quantite*COALESCE(NULLIF(cout_unitaire,0),0)),0) AS cout
           FROM ventes WHERE user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM date_vente)=$2
           GROUP BY user_id`,
          [vendeurIds, annee]
        ),
        pool.query(
          `SELECT user_id, COALESCE(SUM(objectif_montant),0) AS obj
           FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2
           GROUP BY user_id`,
          [vendeurIds, annee]
        ),
        pool.query(
          `SELECT user_id, COALESCE(SUM(montant),0) AS creances
           FROM ventes WHERE user_id = ANY($1::uuid[]) AND statut_paiement != 'Paye'
           GROUP BY user_id`,
          [vendeurIds]
        ),
      ]);
      ventesR.rows.forEach(r => { ventesMap[r.user_id] = { ca: +r.ca, cout: +r.cout }; });
      forecastR.rows.forEach(r => { objMap[r.user_id] = +r.obj; });
      creancesR.rows.forEach(r => { creancesMap[r.user_id] = +r.creances; });
    }

    const vendeurStats = vendeurs.map(v => {
      const ca = ventesMap[v.id]?.ca || 0;
      const cout = ventesMap[v.id]?.cout || 0;
      const objAnnuel = objMap[v.id] || 0;
      const marge = ca - cout;
      const creances = creancesMap[v.id] || 0;
      const prorat = objAnnuel / 12 * monthsElapsed;
      const tauxAtteinte = prorat > 0 ? ca / prorat * 100 : 0;
      const forecast = Math.round(ca / monthsElapsed * 12);
      const ecart = ca - prorat;
      return { id: v.id, nom: v.nom, manager_id: v.parent_id, ca_ytd: ca, obj_annuel: objAnnuel, marge, creances, taux_atteinte: tauxAtteinte, forecast, ecart };
    });

    const result = managersR.rows.map(mg => {
      const team = vendeurStats.filter(v => v.manager_id === mg.id);
      const ca_ytd = team.reduce((s, v) => s + v.ca_ytd, 0);
      const obj_annuel = team.reduce((s, v) => s + v.obj_annuel, 0);
      const marge = team.reduce((s, v) => s + v.marge, 0);
      const creances = team.reduce((s, v) => s + v.creances, 0);
      const forecast = team.reduce((s, v) => s + v.forecast, 0);
      const prorat = obj_annuel / 12 * monthsElapsed;
      const taux_atteinte = prorat > 0 ? ca_ytd / prorat * 100 : 0;
      return { id: mg.id, nom: mg.nom, zone: mg.zone, nb_com: team.length, ca_ytd, obj_annuel, forecast, marge, creances, taux_atteinte, team };
    });

    res.json(result);
  } catch (err) {
    logger.error('GET managers', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
