const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// GET /api/forecast?annee=2025
router.get('/', async (req, res) => {
  try {
    const annee = Number(req.query.annee) || new Date().getFullYear();
    const ids = await getScopeIds(req.userId, req.userRole);

    const [forecastR, realisR] = await Promise.all([
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

    res.json({ annee, months });
  } catch (err) {
    console.error('GET forecast:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/forecast — upsert objectif mensuel
router.post('/', async (req, res) => {
  try {
    const { annee, mois, objectif_montant } = req.body;
    if (!annee || !mois || objectif_montant == null)
      return res.status(400).json({ error: 'annee, mois, objectif_montant requis' });

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
    console.error('POST forecast:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
