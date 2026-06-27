const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');
const { isNonNegativeNumber } = require('../middleware/validate');

const router = express.Router();
router.use(auth);

// GET /api/forecast?annee=2025
router.get('/', async (req, res) => {
  try {
    const annee = Number(req.query.annee) || new Date().getFullYear();
    const ids = await getScopeIds(req.userId, req.userRole);
    const monthsElapsed = annee === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;

    const [forecastR, realisR, vendeursR, ventesVendeurR, objVendeurR] = await Promise.all([
      pool.query(
        `SELECT id, mois, produit, objectif_montant, user_id
         FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee = $2
         ORDER BY mois`,
        [ids, annee]
      ),
      pool.query(
        `SELECT EXTRACT(MONTH FROM date_vente)::int AS mois,
                COALESCE(SUM(montant), 0) AS realise
         FROM ventes
         WHERE user_id = ANY($1::uuid[])
           AND EXTRACT(YEAR FROM date_vente) = $2
         GROUP BY mois`,
        [ids, annee]
      ),
      pool.query(`SELECT id, nom FROM users WHERE id = ANY($1::uuid[]) AND role='vendeur'`, [ids]),
      pool.query(
        `SELECT user_id, COALESCE(SUM(montant),0) AS ca
         FROM ventes WHERE user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM date_vente)=$2
         GROUP BY user_id`,
        [ids, annee]
      ),
      pool.query(
        `SELECT user_id, COALESCE(SUM(objectif_montant),0) AS obj
         FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2
         GROUP BY user_id`,
        [ids, annee]
      ),
    ]);

    const realisMap = {};
    realisR.rows.forEach(r => { realisMap[r.mois] = +r.realise; });

    const forecastMap = {};
    forecastR.rows.forEach(r => {
      if (!forecastMap[r.mois]) forecastMap[r.mois] = { objectif: 0, id: r.id };
      forecastMap[r.mois].objectif += +r.objectif_montant;
      forecastMap[r.mois].id = r.id;
    });

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return {
        mois: m,
        objectif: forecastMap[m]?.objectif || 0,
        realise: realisMap[m] || 0,
        id: forecastMap[m]?.id || null,
      };
    });

    const caVendeurMap = {}; ventesVendeurR.rows.forEach(r => { caVendeurMap[r.user_id] = +r.ca; });
    const objVendeurMap = {}; objVendeurR.rows.forEach(r => { objVendeurMap[r.user_id] = +r.obj; });
    const par_vendeur = vendeursR.rows.map(v => {
      const ca = caVendeurMap[v.id] || 0;
      const objectif = objVendeurMap[v.id] || 0;
      const forecast = Math.round(ca / monthsElapsed * 12);
      return {
        id: v.id, nom: v.nom, ca_ytd: ca, objectif, forecast,
        ecart: forecast - objectif,
        taux_atteinte_prevue: objectif > 0 ? forecast / objectif * 100 : 0,
      };
    });

    const quarterly = [1, 2, 3, 4].map(q => {
      const moisQ = [3 * q - 2, 3 * q - 1, 3 * q];
      const val = months.filter(mm => moisQ.includes(mm.mois)).reduce((s, mm) => s + mm.realise, 0);
      return { trimestre: `T${q} ${annee}`, valeur: val };
    });

    res.json({ annee, months, par_vendeur, quarterly });
  } catch (err) {
    logger.error('GET forecast', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/forecast — upsert objectif mensuel
router.post('/', async (req, res) => {
  try {
    const { annee, mois, objectif_montant } = req.body;
    if (!annee || !mois || objectif_montant == null)
      return res.status(400).json({ error: 'annee, mois, objectif_montant requis' });
    const anneeN = Number(annee);
    const moisN  = Number(mois);
    if (!Number.isInteger(moisN) || moisN < 1 || moisN > 12)
      return res.status(400).json({ error: 'mois doit etre un entier entre 1 et 12' });
    if (!Number.isInteger(anneeN) || anneeN < 2015 || anneeN > 2040)
      return res.status(400).json({ error: 'annee doit etre un entier entre 2015 et 2040' });
    if (!isNonNegativeNumber(objectif_montant))
      return res.status(400).json({ error: 'objectif_montant doit etre un nombre positif ou nul' });

    const result = await pool.query(
      `INSERT INTO forecast (user_id, annee, mois, produit, objectif_montant)
       VALUES ($1,$2,$3,'Général',$4)
       ON CONFLICT (user_id, annee, mois, produit)
       DO UPDATE SET objectif_montant = EXCLUDED.objectif_montant, updated_at = NOW()
       RETURNING *`,
      [req.userId, +annee, +mois, +objectif_montant]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST forecast', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/forecast/:id — supprimer un objectif mensuel
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM forecast WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Objectif non trouvé' });
    res.json({ message: 'Objectif supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
