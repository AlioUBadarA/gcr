const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// Coût d'une vente : coût réel (quantite*cout_unitaire) s'il est renseigné, sinon estimation
// via taux_cout (% du CA). Calculé ligne par ligne pour ne pas mélanger réel et estimé au
// niveau d'un groupe qui contiendrait des ventes avec et sans coût réel renseigné.
const COUT_LIGNE = `CASE WHEN v.cout_unitaire > 0 THEN v.quantite * v.cout_unitaire ELSE v.montant * $3::numeric / 100 END`;

// GET /api/rentabilite?annee=2025&taux_cout=70
router.get('/', async (req, res) => {
  try {
    const annee     = Number(req.query.annee)     || new Date().getFullYear();
    const taux_cout = Number(req.query.taux_cout) || 0; // % du CA (0-100)
    const ids = await getScopeIds(req.userId, req.userRole);

    const [globalR, parClientR, parTypeR, parRegionR, parSegmentR, parProduitR, parVendeurR] = await Promise.all([

      pool.query(`
        SELECT COALESCE(SUM(montant),0) AS ca_total, COUNT(*) AS nb_ventes,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout_total
        FROM ventes v
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT
          v.client_nom,
          COALESCE(c.type, 'Non classé')         AS type_client,
          u.nom                                  AS vendeur_nom,
          COALESCE(SUM(v.montant), 0)            AS ca,
          COUNT(*)                               AS nb_ventes,
          COALESCE(SUM(${COUT_LIGNE}), 0)        AS cout
        FROM ventes v
        LEFT JOIN clients c ON c.id = v.client_id
        LEFT JOIN users   u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[])
          AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY v.client_nom, c.type, u.nom
        ORDER BY ca DESC
        LIMIT 60
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT
          COALESCE(c.type, 'Non classé')         AS type_client,
          COALESCE(SUM(v.montant), 0)            AS ca,
          COUNT(*)                               AS nb_ventes,
          COALESCE(SUM(${COUT_LIGNE}), 0)        AS cout
        FROM ventes v
        LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[])
          AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.type
        ORDER BY ca DESC
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.region, 'Non classé') AS region,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.region ORDER BY ca DESC
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.segment, 'Non classé') AS segment,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.segment ORDER BY ca DESC
      `, [ids, annee, taux_cout]),

      // Jointure sur une sous-requête dédupliquée par nom de produit : deux produits du
      // catalogue portant le même nom (refs différentes) ne doivent pas dupliquer les lignes
      // de ventes jointes (et donc ne pas gonfler le CA/marge par produit).
      pool.query(`
        SELECT v.produit,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout,
               MAX(p.tendance) AS tendance
        FROM ventes v
        LEFT JOIN (
          SELECT DISTINCT ON (nom) nom, tendance
          FROM produits
          WHERE rizerie_id = (SELECT rizerie_id FROM users WHERE id=$4 LIMIT 1)
          ORDER BY nom, updated_at DESC NULLS LAST
        ) p ON p.nom = v.produit
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY v.produit ORDER BY ca DESC
      `, [ids, annee, taux_cout, req.userId]),

      pool.query(`
        SELECT u.nom AS vendeur_nom,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY u.nom ORDER BY ca DESC
      `, [ids, annee, taux_cout]),
    ]);

    const enrich = (rows) => rows.map(r => {
      const ca   = +r.ca;
      const cout = +r.cout;
      const marge = ca - cout;
      return {
        ...r,
        ca,
        nb_ventes: r.nb_ventes != null ? +r.nb_ventes : undefined,
        cout,
        marge,
        taux_marge: ca > 0 ? Math.round(marge / ca * 100) : 0,
      };
    });

    const g = globalR.rows[0];
    const ca_total = +g.ca_total;
    const cout_total = +g.cout_total;

    res.json({
      annee,
      taux_cout,
      ca_total,
      nb_ventes: +g.nb_ventes,
      cout_total,
      marge_total: ca_total - cout_total,
      taux_marge_total: ca_total > 0 ? Math.round((ca_total - cout_total) / ca_total * 100) : 0,
      par_client:  enrich(parClientR.rows),
      par_type:    enrich(parTypeR.rows),
      par_region:  enrich(parRegionR.rows),
      par_segment: enrich(parSegmentR.rows),
      par_produit: enrich(parProduitR.rows),
      par_vendeur: enrich(parVendeurR.rows),
    });
  } catch (err) {
    logger.error('GET rentabilite', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
