const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// GET /api/actions — relances calculées automatiquement
router.get('/', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);

    const [creancesR, inactifsR, prospectsR] = await Promise.all([

      pool.query(`
        SELECT v.id, v.client_nom, v.montant, v.date_vente, v.date_echeance,
               u.nom AS vendeur_nom,
               (NOW()::date - COALESCE(v.date_echeance, v.date_vente + 30)::date) AS jours_retard
        FROM ventes v
        LEFT JOIN users u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[])
          AND v.statut_paiement = 'En retard'
        ORDER BY jours_retard DESC NULLS LAST
        LIMIT 50
      `, [ids]),

      pool.query(`
        SELECT c.id, c.nom, c.telephone, c.zone, c.type,
               u.nom AS vendeur_nom,
               MAX(v.date_vente) AS derniere_vente,
               (NOW()::date - MAX(v.date_vente)::date) AS jours_inactif
        FROM clients c
        LEFT JOIN ventes v ON v.client_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ANY($1::uuid[]) AND c.statut = 'Actif'
        GROUP BY c.id, u.nom
        HAVING MAX(v.date_vente) < NOW() - INTERVAL '30 days'
            OR MAX(v.date_vente) IS NULL
        ORDER BY jours_inactif DESC NULLS LAST
        LIMIT 30
      `, [ids]),

      pool.query(`
        SELECT p.id, p.nom, p.telephone, p.zone, p.statut, p.priorite,
               u.nom AS vendeur_nom,
               (NOW()::date - COALESCE(p.date_contact, p.created_at::date)) AS jours_sans_contact
        FROM prospection p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ANY($1::uuid[])
          AND p.statut NOT IN ('Gagné','Perdu')
          AND (p.date_contact < NOW() - INTERVAL '7 days' OR p.date_contact IS NULL)
        ORDER BY
          CASE p.priorite WHEN 'Haute' THEN 1 WHEN 'Normale' THEN 2 ELSE 3 END,
          jours_sans_contact DESC NULLS LAST
        LIMIT 30
      `, [ids]),
    ]);

    res.json({
      creances_retard: creancesR.rows.map(r => ({
        ...r, montant: +r.montant, jours_retard: r.jours_retard != null ? +r.jours_retard : null,
      })),
      clients_inactifs: inactifsR.rows.map(r => ({
        ...r, jours_inactif: r.jours_inactif != null ? +r.jours_inactif : null,
      })),
      prospects_relance: prospectsR.rows.map(r => ({
        ...r, jours_sans_contact: r.jours_sans_contact != null ? +r.jours_sans_contact : null,
      })),
    });
  } catch (err) {
    console.error('GET actions:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
