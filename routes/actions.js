const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

// La clé utilise l'ID de l'entité (pas le message) pour rester stable d'un jour à l'autre.
function alertKey(a) {
  return `${a.cat || ''}|${a.owner || ''}|${a.entity_id || ''}`;
}

// GET /api/actions — moteur d'alertes unifié (client inactif >60j, créance >30j, objectif atteinte<80%)
// trié rouge avant orange, par valeur décroissante — à l'identique du HTML de référence.
router.get('/', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const annee = new Date().getFullYear();
    const monthsElapsed = new Date().getMonth() + 1;

    const [inactifsR, creancesR, vendeursR, ventesR, forecastR, traiteesR] = await Promise.all([
      pool.query(`
        SELECT c.id, c.nom, u.id AS vendeur_id, u.nom AS vendeur_nom, MAX(v.date_vente) AS derniere_vente,
               (NOW()::date - MAX(v.date_vente)::date) AS jours_inactif,
               COALESCE(SUM(v.montant),0) AS ca_total
        FROM clients c
        LEFT JOIN ventes v ON v.client_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ANY($1::uuid[]) AND c.statut != 'Dormant'
        GROUP BY c.id, u.id, u.nom
        HAVING (NOW()::date - MAX(v.date_vente)::date) > 60 AND (NOW()::date - MAX(v.date_vente)::date) < 900
      `, [ids]),

      pool.query(`
        SELECT v.id, v.client_nom, v.montant, v.user_id, u.nom AS vendeur_nom,
               (NOW()::date - COALESCE(v.date_echeance, v.date_vente + 30)::date) AS jours_retard
        FROM ventes v
        LEFT JOIN users u ON u.id = v.user_id
        WHERE v.user_id = ANY($1::uuid[]) AND v.statut_paiement != 'Paye'
      `, [ids]),

      pool.query(`SELECT id, nom FROM users WHERE id = ANY($1::uuid[]) AND role='vendeur'`, [ids]),

      pool.query(`
        SELECT user_id, COALESCE(SUM(montant),0) AS ca
        FROM ventes WHERE user_id = ANY($1::uuid[]) AND EXTRACT(YEAR FROM date_vente)=$2
        GROUP BY user_id
      `, [ids, annee]),

      pool.query(`
        SELECT user_id, COALESCE(SUM(objectif_montant),0) AS obj
        FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2
        GROUP BY user_id
      `, [ids, annee]),

      pool.query(`SELECT alerte_key FROM alertes_traitees WHERE user_id=$1`, [req.userId]),
    ]);

    const caMap = {}; ventesR.rows.forEach(r => { caMap[r.user_id] = +r.ca; });
    const objMap = {}; forecastR.rows.forEach(r => { objMap[r.user_id] = +r.obj; });
    const traitees = new Set(traiteesR.rows.map(r => r.alerte_key));

    const alertes = [];

    inactifsR.rows.forEach(c => {
      const jours = c.jours_inactif != null ? +c.jours_inactif : null;
      if (jours == null) return;
      alertes.push({
        cat: 'Client inactif',
        niveau: jours > 90 ? 'rouge' : 'orange',
        msg: `${c.nom} — aucun achat depuis ${jours} j`,
        valeur: +c.ca_total,
        owner: c.vendeur_id,
        owner_nom: c.vendeur_nom,
        entity_id: c.id,
      });
    });

    creancesR.rows.forEach(v => {
      const jours = v.jours_retard != null ? +v.jours_retard : null;
      if (jours == null || jours <= 30) return;
      alertes.push({
        cat: 'Créance en retard',
        niveau: jours > 90 ? 'rouge' : 'orange',
        msg: `${v.client_nom} — ${jours} j de retard`,
        valeur: +v.montant,
        owner: v.user_id,
        owner_nom: v.vendeur_nom,
        entity_id: v.id,
      });
    });

    vendeursR.rows.forEach(vd => {
      const objAnnuel = objMap[vd.id] || 0;
      if (!objAnnuel) return;
      const ca = caMap[vd.id] || 0;
      const prorat = objAnnuel / 12 * monthsElapsed;
      const tauxAtteinte = prorat > 0 ? ca / prorat * 100 : 0;
      if (tauxAtteinte >= 80) return;
      alertes.push({
        cat: 'Objectif sous cible',
        niveau: tauxAtteinte < 60 ? 'rouge' : 'orange',
        msg: `${vd.nom} — atteinte ${Math.round(tauxAtteinte)} %`,
        valeur: Math.max(0, objAnnuel - ca),
        owner: vd.id,
        owner_nom: vd.nom,
        entity_id: `${vd.id}|${annee}`,
      });
    });

    const ordre = { rouge: 0, orange: 1 };
    alertes.sort((a, b) => ordre[a.niveau] - ordre[b.niveau] || b.valeur - a.valeur);
    alertes.forEach(a => { a.key = alertKey(a); a.traitee = traitees.has(a.key); });

    res.json({
      alertes,
      stats: {
        total: alertes.length,
        a_traiter: alertes.filter(a => !a.traitee).length,
        rouges_actives: alertes.filter(a => a.niveau === 'rouge' && !a.traitee).length,
        traitees: alertes.filter(a => a.traitee).length,
      },
    });
  } catch (err) {
    console.error('GET actions:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/actions/traiter — bascule l'état traité/à traiter d'une alerte
router.patch('/traiter', async (req, res) => {
  try {
    const { key, traitee } = req.body;
    if (!key) return res.status(400).json({ error: 'Clé d\'alerte requise' });
    // Format attendu : "categorie|owner_id|entity_id" — rejeter les clés malformées
    if (typeof key !== 'string' || key.length > 500 || !/^[^|]+\|[^|]*\|[^|]*$/.test(key))
      return res.status(400).json({ error: 'Format de clé invalide' });
    if (traitee) {
      await pool.query(
        `INSERT INTO alertes_traitees (user_id, alerte_key) VALUES ($1,$2)
         ON CONFLICT (user_id, alerte_key) DO NOTHING`,
        [req.userId, key]
      );
    } else {
      await pool.query(`DELETE FROM alertes_traitees WHERE user_id=$1 AND alerte_key=$2`, [req.userId, key]);
    }
    res.json({ message: 'OK' });
  } catch (err) {
    console.error('PATCH actions/traiter:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
