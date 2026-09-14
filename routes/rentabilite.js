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

// Un dépôt-vente n'a pas de cout_unitaire propre (pas de suivi de coût dédié) : son coût est
// toujours estimé au taux de repli, sur les quantités effectivement vendues déclarées.
const COUT_LIGNE_DEPOT = `(dm.quantite * d.prix_unitaire) * $3::numeric / 100`;

// Fusionne une ventilation "ventes" (SQL) et son équivalent "dépôt-vente" sur la même clé
// composite (ex: nom de client), en sommant ca/cout/nb_ventes — le CA dépôt-vente n'est
// reconnu qu'aux quantités vendues déclarées (voir routes/depots.js), jamais au dépôt initial.
function mergeVentesDepot(rowsVentes, rowsDepot, keyFn) {
  const map = new Map();
  rowsVentes.forEach((r) => map.set(keyFn(r), { ...r, ca: +r.ca, cout: +r.cout, nb_ventes: r.nb_ventes != null ? +r.nb_ventes : undefined }));
  rowsDepot.forEach((r) => {
    const key = keyFn(r);
    const existing = map.get(key);
    if (existing) {
      existing.ca += +r.ca;
      existing.cout += +r.cout;
      if (r.nb_ventes != null) existing.nb_ventes = (existing.nb_ventes || 0) + +r.nb_ventes;
    } else {
      map.set(key, { ...r, ca: +r.ca, cout: +r.cout, nb_ventes: r.nb_ventes != null ? +r.nb_ventes : undefined });
    }
  });
  return [...map.values()];
}

// GET /api/rentabilite?annee=2025&taux_cout=70
router.get('/', async (req, res) => {
  try {
    const annee     = Number(req.query.annee)     || new Date().getFullYear();
    const taux_cout = Number(req.query.taux_cout) || 0; // % du CA (0-100)
    const ids = await getScopeIds(req.userId, req.userRole);

    const [
      globalR, parClientR, parTypeR, parRegionR, parSegmentR, parProduitR, parVendeurR,
      depotGlobalR, depotParClientR, depotParTypeR, depotParRegionR, depotParSegmentR, depotParProduitR, depotParVendeurR,
    ] = await Promise.all([

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
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.region, 'Non classé') AS region,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.region
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.segment, 'Non classé') AS segment,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY c.segment
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
        GROUP BY v.produit
      `, [ids, annee, taux_cout, req.userId]),

      pool.query(`
        SELECT u.nom AS vendeur_nom,
               COALESCE(SUM(v.montant),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE}), 0) AS cout
        FROM ventes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente) = $2
        GROUP BY u.nom
      `, [ids, annee, taux_cout]),

      // ── Dépôt-vente : CA reconnu aux quantités vendues déclarées par le distributeur
      // (rapports périodiques, voir routes/depots.js), pas au dépôt initial — mêmes
      // ventilations que les ventes classiques, fusionnées ci-dessous.
      pool.query(`
        SELECT COALESCE(SUM(dm.quantite*d.prix_unitaire),0) AS ca_total, COUNT(*) AS nb_ventes,
               COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0) AS cout_total
        FROM depot_mouvements dm JOIN depots_vente d ON d.id = dm.depot_vente_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT
          d.client_nom,
          COALESCE(c.type, 'Non classé')                  AS type_client,
          u.nom                                            AS vendeur_nom,
          COALESCE(SUM(dm.quantite*d.prix_unitaire), 0)   AS ca,
          COUNT(*)                                         AS nb_ventes,
          COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0)            AS cout
        FROM depot_mouvements dm
        JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN clients c ON c.id = d.client_id
        LEFT JOIN users   u ON u.id = d.user_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY d.client_nom, c.type, u.nom
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT
          COALESCE(c.type, 'Non classé')                AS type_client,
          COALESCE(SUM(dm.quantite*d.prix_unitaire), 0) AS ca,
          COUNT(*)                                       AS nb_ventes,
          COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0)          AS cout
        FROM depot_mouvements dm
        JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY c.type
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.region, 'Non classé') AS region,
               COALESCE(SUM(dm.quantite*d.prix_unitaire),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0) AS cout
        FROM depot_mouvements dm JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY c.region
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT COALESCE(c.segment, 'Non classé') AS segment,
               COALESCE(SUM(dm.quantite*d.prix_unitaire),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0) AS cout
        FROM depot_mouvements dm JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY c.segment
      `, [ids, annee, taux_cout]),

      pool.query(`
        SELECT d.produit,
               COALESCE(SUM(dm.quantite*d.prix_unitaire),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0) AS cout,
               MAX(p.tendance) AS tendance
        FROM depot_mouvements dm
        JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN (
          SELECT DISTINCT ON (nom) nom, tendance
          FROM produits
          WHERE rizerie_id = (SELECT rizerie_id FROM users WHERE id=$4 LIMIT 1)
          ORDER BY nom, updated_at DESC NULLS LAST
        ) p ON p.nom = d.produit
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY d.produit
      `, [ids, annee, taux_cout, req.userId]),

      pool.query(`
        SELECT u.nom AS vendeur_nom,
               COALESCE(SUM(dm.quantite*d.prix_unitaire),0) AS ca,
               COALESCE(SUM(${COUT_LIGNE_DEPOT}), 0) AS cout
        FROM depot_mouvements dm
        JOIN depots_vente d ON d.id = dm.depot_vente_id
        LEFT JOIN users u ON u.id = d.user_id
        WHERE dm.type='vente' AND d.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM dm.date) = $2
        GROUP BY u.nom
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

    // Fusionne ventes + dépôt-vente sur chaque ventilation, puis retrie par CA décroissant
    // (le tri SQL d'origine, fait avant fusion, ne tiendrait pas compte du CA dépôt-vente).
    const mergeSort = (rowsVentes, rowsDepot, keyFn) =>
      mergeVentesDepot(rowsVentes, rowsDepot, keyFn).sort((a, b) => b.ca - a.ca);

    const par_client  = mergeSort(parClientR.rows, depotParClientR.rows, (r) => `${r.client_nom}|${r.vendeur_nom || ''}`).slice(0, 60);
    const par_type    = mergeSort(parTypeR.rows, depotParTypeR.rows, (r) => r.type_client);
    const par_region  = mergeSort(parRegionR.rows, depotParRegionR.rows, (r) => r.region);
    const par_segment = mergeSort(parSegmentR.rows, depotParSegmentR.rows, (r) => r.segment);
    const par_produit = mergeSort(parProduitR.rows, depotParProduitR.rows, (r) => r.produit);
    const par_vendeur = mergeSort(parVendeurR.rows, depotParVendeurR.rows, (r) => r.vendeur_nom);

    const g  = globalR.rows[0];
    const dg = depotGlobalR.rows[0];
    // Le CA dépôt-vente n'est pas un dépôt initial mais les quantités vendues déclarées par le
    // distributeur — voir routes/depots.js et la note sur COUT_LIGNE_DEPOT plus haut.
    const ca_total   = +g.ca_total + (+dg.ca_total);
    const cout_total = +g.cout_total + (+dg.cout_total);

    res.json({
      annee,
      taux_cout,
      ca_total,
      nb_ventes: +g.nb_ventes + (+dg.nb_ventes),
      cout_total,
      marge_total: ca_total - cout_total,
      taux_marge_total: ca_total > 0 ? Math.round((ca_total - cout_total) / ca_total * 100) : 0,
      par_client:  enrich(par_client),
      par_type:    enrich(par_type),
      par_region:  enrich(par_region),
      par_segment: enrich(par_segment),
      par_produit: enrich(par_produit),
      par_vendeur: enrich(par_vendeur),
    });
  } catch (err) {
    logger.error('GET rentabilite', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
