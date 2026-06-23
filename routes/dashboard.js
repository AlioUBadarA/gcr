const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// GET /api/dashboard — vue Direction, à l'identique du HTML de référence
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const monthsElapsed = m;
    const ids = await getScopeIds(req.userId, req.userRole);

    const [
      kpis, mensuel, topClients, creances, alertes,
      objAnnuelR, segmentR, regionR, produitR, vendeursR, ventesVendeurR, forecastVendeurR,
      mouvementsR,
    ] = await Promise.all([

      pool.query(`
        SELECT
          COALESCE(SUM(montant) FILTER (WHERE EXTRACT(MONTH FROM date_vente)=$2 AND EXTRACT(YEAR FROM date_vente)=$3), 0) AS ca_mois,
          COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date_vente)=$2 AND EXTRACT(YEAR FROM date_vente)=$3) AS nb_ventes_mois,
          COALESCE(SUM(montant) FILTER (WHERE EXTRACT(YEAR FROM date_vente)=$3), 0) AS ca_ytd,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM date_vente)=$3) AS nb_ventes_ytd,
          COALESCE(SUM(quantite*COALESCE(NULLIF(cout_unitaire,0),0)) FILTER (WHERE EXTRACT(YEAR FROM date_vente)=$3), 0) AS cout_ytd,
          COALESCE(SUM(montant) FILTER (WHERE statut_paiement != 'Paye'), 0) AS total_creances,
          COUNT(*) FILTER (WHERE statut_paiement != 'Paye') AS nb_creances,
          COALESCE(SUM(montant) FILTER (WHERE statut_paiement = 'Paye'), 0) AS total_paye,
          COALESCE(SUM(montant), 0) AS total_facture
        FROM ventes WHERE user_id = ANY($1::uuid[])`,
        [ids, m, y]
      ),

      pool.query(`
        SELECT
          EXTRACT(YEAR  FROM date_vente)::int AS annee,
          EXTRACT(MONTH FROM date_vente)::int AS mois,
          COALESCE(SUM(montant), 0) AS ca
        FROM ventes
        WHERE user_id = ANY($1::uuid[])
          AND date_vente >= (NOW() - INTERVAL '6 months')
        GROUP BY annee, mois
        ORDER BY annee, mois`,
        [ids]
      ),

      pool.query(`
        SELECT client_nom, COALESCE(SUM(montant),0) AS ca_total, COUNT(*) AS nb_ventes
        FROM ventes WHERE user_id = ANY($1::uuid[])
        GROUP BY client_nom ORDER BY ca_total DESC LIMIT 10`,
        [ids]
      ),

      pool.query(`
        SELECT
          COALESCE(SUM(montant) FILTER (WHERE statut_paiement='En retard'), 0) AS montant_retard,
          COUNT(*) FILTER (WHERE statut_paiement='En retard') AS nb_retard,
          COALESCE(SUM(montant) FILTER (WHERE statut_paiement='En cours'), 0) AS montant_encours,
          COUNT(*) FILTER (WHERE statut_paiement='En cours') AS nb_encours
        FROM ventes WHERE user_id = ANY($1::uuid[])`,
        [ids]
      ),

      pool.query(`
        SELECT statut, COUNT(*) AS nb
        FROM clients WHERE user_id = ANY($1::uuid[])
        GROUP BY statut`,
        [ids]
      ),

      pool.query(`
        SELECT COALESCE(SUM(objectif_montant),0) AS obj
        FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2`,
        [ids, y]
      ),

      pool.query(`
        SELECT COALESCE(c.segment, 'Non classé') AS segment, COALESCE(SUM(v.montant),0) AS ca
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente)=$2
        GROUP BY c.segment ORDER BY ca DESC`,
        [ids, y]
      ),

      pool.query(`
        SELECT COALESCE(c.region, 'Non classé') AS region, COALESCE(SUM(v.montant),0) AS ca
        FROM ventes v LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM v.date_vente)=$2
        GROUP BY c.region ORDER BY ca DESC`,
        [ids, y]
      ),

      pool.query(`
        SELECT produit, COALESCE(SUM(montant),0) AS ca
        FROM ventes WHERE user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM date_vente)=$2
        GROUP BY produit ORDER BY ca DESC`,
        [ids, y]
      ),

      pool.query(`SELECT id, nom FROM users WHERE id = ANY($1::uuid[]) AND role='vendeur'`, [ids]),

      pool.query(`
        SELECT user_id, COALESCE(SUM(montant),0) AS ca
        FROM ventes WHERE user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM date_vente)=$2
        GROUP BY user_id`,
        [ids, y]
      ),

      pool.query(`
        SELECT user_id, COALESCE(SUM(objectif_montant),0) AS obj
        FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2
        GROUP BY user_id`,
        [ids, y]
      ),

      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM prospection WHERE user_id = ANY($1::uuid[]) AND statut='Gagné' AND EXTRACT(YEAR FROM updated_at)=$2::int)  AS gagnes,
          (SELECT COUNT(*) FROM prospection WHERE user_id = ANY($1::uuid[]) AND statut='Perdu' AND EXTRACT(YEAR FROM updated_at)=$2::int)  AS perdus,
          (SELECT COUNT(*) FROM contrats_clients WHERE user_id = ANY($1::uuid[]) AND date_debut >= make_date($2::int,1,1))                  AS nouveaux_contrats,
          (SELECT COUNT(*) FROM ventes WHERE user_id = ANY($1::uuid[]) AND statut_paiement='En retard')                                AS cmd_retard,
          (SELECT COALESCE(SUM(valeur_estimee),0) FROM prospection WHERE user_id = ANY($1::uuid[]) AND statut NOT IN ('Gagné','Perdu')) AS pipeline_espere,
          (SELECT COUNT(*) FROM prospection WHERE user_id = ANY($1::uuid[]) AND statut NOT IN ('Gagné','Perdu'))                        AS pipeline_nb
      `, [ids, y]),
    ]);

    const k = kpis.rows[0];
    const cr = creances.rows[0];
    const clientsStatut = {};
    alertes.rows.forEach(r => { clientsStatut[r.statut] = +r.nb; });

    const caYTD = +k.ca_ytd;
    const objAnnuel = +objAnnuelR.rows[0].obj;
    const margeNette = caYTD - (+k.cout_ytd);
    const projectionAnnuel = Math.round(caYTD / monthsElapsed * 12);
    const prorat = objAnnuel / 12 * monthsElapsed;
    const tauxAtteinte = prorat > 0 ? caYTD / prorat * 100 : 0;

    const caVendeurMap = {}; ventesVendeurR.rows.forEach(r => { caVendeurMap[r.user_id] = +r.ca; });
    const objVendeurMap = {}; forecastVendeurR.rows.forEach(r => { objVendeurMap[r.user_id] = +r.obj; });
    const atteinte_vendeurs = vendeursR.rows.map(v => {
      const ca = caVendeurMap[v.id] || 0;
      const obj = objVendeurMap[v.id] || 0;
      const p = obj / 12 * monthsElapsed;
      return { id: v.id, nom: v.nom, taux_atteinte: p > 0 ? ca / p * 100 : 0 };
    }).sort((a, b) => b.taux_atteinte - a.taux_atteinte);

    const mv = mouvementsR.rows[0];

    res.json({
      kpis: {
        ca_mois: +k.ca_mois,
        nb_ventes_mois: +k.nb_ventes_mois,
        ca_ytd: caYTD,
        nb_ventes_ytd: +k.nb_ventes_ytd,
        projection_annuel: projectionAnnuel,
        objectif_annuel: objAnnuel,
        taux_atteinte: tauxAtteinte,
        marge_nette: margeNette,
        taux_marge_nette: caYTD > 0 ? Math.round(margeNette / caYTD * 100) : 0,
        total_creances: +k.total_creances,
        nb_creances: +k.nb_creances,
        pipeline_espere: +mv.pipeline_espere,
        pipeline_nb: +mv.pipeline_nb,
        taux_recouvrement: +k.total_facture > 0
          ? Math.round(+k.total_paye / +k.total_facture * 100)
          : null,
        clients_actifs: clientsStatut['Actif'] || 0,
        clients_prospects: clientsStatut['Prospect'] || 0,
        clients_dormants: clientsStatut['Dormant'] || 0,
        clients_total: Object.values(clientsStatut).reduce((s, n) => s + n, 0),
      },
      creances: {
        montant_retard: +cr.montant_retard,
        nb_retard: +cr.nb_retard,
        montant_encours: +cr.montant_encours,
        nb_encours: +cr.nb_encours,
      },
      ca_mensuel: mensuel.rows.map(r => ({ annee: r.annee, mois: r.mois, ca: +r.ca })),
      top_clients: topClients.rows.map(r => ({ nom: r.client_nom, ca_total: +r.ca_total, nb_ventes: +r.nb_ventes })),
      ca_par_segment: segmentR.rows.map(r => ({ segment: r.segment, ca: +r.ca })),
      ca_par_region:  regionR.rows.map(r => ({ region: r.region, ca: +r.ca })),
      ca_par_produit: produitR.rows.map(r => ({ produit: r.produit, ca: +r.ca })),
      atteinte_vendeurs,
      mouvements: {
        clients_gagnes: +mv.gagnes,
        clients_perdus: +mv.perdus,
        nouveaux_contrats: +mv.nouveaux_contrats,
        cmd_retard: +mv.cmd_retard,
      },
    });
  } catch (err) {
    console.error('GET dashboard:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
