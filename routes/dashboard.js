const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const ids = await getScopeIds(req.userId, req.userRole);

    const [kpis, mensuel, topClients, creances, alertes] = await Promise.all([

      pool.query(`
        SELECT
          COALESCE(SUM(montant) FILTER (WHERE EXTRACT(MONTH FROM date_vente)=$2 AND EXTRACT(YEAR FROM date_vente)=$3), 0) AS ca_mois,
          COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM date_vente)=$2 AND EXTRACT(YEAR FROM date_vente)=$3) AS nb_ventes_mois,
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
        GROUP BY client_nom ORDER BY ca_total DESC LIMIT 5`,
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
    ]);

    const k = kpis.rows[0];
    const cr = creances.rows[0];
    const clientsStatut = {};
    alertes.rows.forEach(r => { clientsStatut[r.statut] = +r.nb; });

    res.json({
      kpis: {
        ca_mois: +k.ca_mois,
        nb_ventes_mois: +k.nb_ventes_mois,
        total_creances: +k.total_creances,
        nb_creances: +k.nb_creances,
        taux_recouvrement: +k.total_facture > 0
          ? Math.round(+k.total_paye / +k.total_facture * 100)
          : null,
        clients_actifs: clientsStatut['Actif'] || 0,
        clients_prospects: clientsStatut['Prospect'] || 0,
        clients_dormants: clientsStatut['Dormant'] || 0,
      },
      creances: {
        montant_retard: +cr.montant_retard,
        nb_retard: +cr.nb_retard,
        montant_encours: +cr.montant_encours,
        nb_encours: +cr.nb_encours,
      },
      ca_mensuel: mensuel.rows.map(r => ({
        annee: r.annee, mois: r.mois, ca: +r.ca
      })),
      top_clients: topClients.rows.map(r => ({
        nom: r.client_nom, ca_total: +r.ca_total, nb_ventes: +r.nb_ventes
      })),
    });
  } catch (err) {
    console.error('GET dashboard:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
