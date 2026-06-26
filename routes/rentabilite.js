const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// GET /api/rentabilite?annee=2025&taux_cout=70
router.get('/', async (req, res) => {
  try {
    const annee     = Number(req.query.annee)     || new Date().getFullYear();
    const taux_cout = Number(req.query.taux_cout) || 0; // % du CA (0-100)
    const ids = await getScopeIds(req.userId, req.userRole);

    const [parClientR, parTypeR, globalR, parRegionR, parSegmentR, parProduitR, parVendeurR] = await Promise.all([

      pool.query(`
        SELECT
          v.client_nom,
          COALESCE(c.type, 'Non classé')         AS type_client,
          u.nom                                  AS vendeur_nom,
          COALESCE(SUM(v.montant), 0)            AS ca,
          COUNT(*)                               AS nb_ventes,
          COALESCE(SUM(v.quantite * COALESCE(NULLIF(v.cout_unitaire,0), 0)), 0) AS cout_reel
        FROM ventes v
        LEFT JOIN clients c ON c.id = v.client_id
        LEFT JOIN users   u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[])
          AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY v.client_nom, c.type, u.nom
        ORDER BY ca DESC
        LIMIT 60
      `, [ids, annee]),

      pool.query(`
        SELECT
          COALESCE(c.type, 'Non classé')         AS type_client,
          COALESCE(SUM(v.montant), 0)            AS ca,
          COUNT(*)                               AS nb_ventes
        FROM ventes v
        LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[])
          AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.type
        ORDER BY ca DESC
      `, [ids, annee]),

      pool.query(`
        SELECT COALESCE(SUM(montant),0) AS ca_total, COUNT(*) AS nb_ventes
        FROM ventes
        WHERE user_id = ANY($1::uuid[])
          AND EXTRACT(YEAR FROM date_vente) = $2
      `, [ids, annee]),

      pool.query(`
        SELECT COALESCE(c.region, 'Non classé') AS region,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(v.quantite*COALESCE(NULLIF(v.cout_unitaire,0),0)),0) AS cout_reel
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.region ORDER BY ca DESC
      `, [ids, annee]),

      pool.query(`
        SELECT COALESCE(c.segment, 'Non classé') AS segment,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(v.quantite*COALESCE(NULLIF(v.cout_unitaire,0),0)),0) AS cout_reel
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.segment ORDER BY ca DESC
      `, [ids, annee]),

      pool.query(`
        SELECT v.produit,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(v.quantite*COALESCE(NULLIF(v.cout_unitaire,0),0)),0) AS cout_reel,
               MAX(p.tendance) AS tendance
        FROM ventes v
        LEFT JOIN produits p ON p.rizerie_id = (SELECT rizerie_id FROM users WHERE id=$3 LIMIT 1)
                             AND p.nom = v.produit
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY v.produit ORDER BY ca DESC
      `, [ids, annee, req.userId]),

      pool.query(`
        SELECT u.nom AS vendeur_nom,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(v.quantite*COALESCE(NULLIF(v.cout_unitaire,0),0)),0) AS cout_reel
        FROM ventes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY u.nom ORDER BY ca DESC
      `, [ids, annee]),
    ]);

    const enrich = (rows) => rows.map(r => {
      const ca       = +r.ca;
      const cout_reel = +r.cout_reel;
      const cout_est  = taux_cout > 0 ? ca * taux_cout / 100 : 0;
      const cout      = cout_reel > 0 ? cout_reel : cout_est;
      const marge     = ca - cout;
      return {
        ...r,
        ca,
        nb_ventes: r.nb_ventes != null ? +r.nb_ventes : undefined,
        cout,
        marge,
        taux_marge: ca > 0 ? Math.round(marge / ca * 100) : 0,
      };
    });

    res.json({
      annee,
      taux_cout,
      ca_total:  +globalR.rows[0].ca_total,
      nb_ventes: +globalR.rows[0].nb_ventes,
      par_client:  enrich(parClientR.rows),
      par_type:    enrich(parTypeR.rows),
      par_region:  enrich(parRegionR.rows),
      par_segment: enrich(parSegmentR.rows),
      par_produit: enrich(parProduitR.rows),
      par_vendeur: enrich(parVendeurR.rows),
    });
  } catch (err) {
    console.error('GET rentabilite:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
