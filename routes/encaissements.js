const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { isPositiveNumber, isValidDate } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds);

const MODES = ['Espèces', 'Virement', 'Chèque', 'Mobile Money'];

// GET /api/encaissements/search?q=...  — recherche unifiée par numéro de transaction ou nom client
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const ids = req.scopeIds;
    const like = `%${q}%`;

    const ventesR = await pool.query(
      `SELECT v.id, v.numero, v.client_nom, v.date_vente AS date, v.montant AS montant_total,
              v.produit, v.quantite, v.prix_unitaire, v.date_echeance, v.mode, v.note,
              v.statut_paiement AS statut, COALESCE(ve.total_verse, 0) AS total_verse,
              u.nom AS vendeur_nom
       FROM ventes v
       LEFT JOIN (SELECT vente_id, SUM(montant) AS total_verse FROM versements GROUP BY vente_id) ve ON ve.vente_id = v.id
       LEFT JOIN users u ON u.id = v.user_id
       WHERE v.user_id = ANY($1::uuid[]) AND (v.numero ILIKE $2 OR v.client_nom ILIKE $2)
       ORDER BY v.created_at DESC LIMIT 30`,
      [ids, like]
    );
    const contratsR = await pool.query(
      `SELECT cc.id, cc.numero, cc.client_nom, cc.date_debut AS date,
              (cc.quantite_mensuelle * cc.prix_unitaire) AS montant_total,
              cc.statut AS statut, COALESCE(ve.total_verse, 0) AS total_verse
       FROM contrats_clients cc
       LEFT JOIN (SELECT contrat_client_id, SUM(montant) AS total_verse FROM versements GROUP BY contrat_client_id) ve ON ve.contrat_client_id = cc.id
       WHERE cc.user_id = ANY($1::uuid[]) AND (cc.numero ILIKE $2 OR cc.client_nom ILIKE $2)
       ORDER BY cc.created_at DESC LIMIT 30`,
      [ids, like]
    );

    const results = [
      ...ventesR.rows.map((r) => ({ ...r, type: 'vente' })),
      ...contratsR.rows.map((r) => ({ ...r, type: 'contrat' })),
    ];
    res.json(results);
  } catch (err) {
    console.error('GET encaissements/search:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/encaissements/mois — somme de tous les versements encaissés ce mois (scope)
router.get('/mois', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      `SELECT COALESCE(SUM(v.montant), 0) AS total
       FROM versements v
       LEFT JOIN ventes        vt ON vt.id = v.vente_id
       LEFT JOIN contrats_clients cc ON cc.id = v.contrat_client_id
       WHERE DATE_TRUNC('month', v.date::date) = DATE_TRUNC('month', CURRENT_DATE)
         AND (vt.user_id = ANY($1::uuid[]) OR cc.user_id = ANY($1::uuid[]))`,
      [ids]
    );
    res.json({ total: Number(result.rows[0].total) });
  } catch (err) {
    console.error('GET encaissements/mois:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function targetTable(type) {
  if (type === 'vente') return { table: 'ventes', column: 'vente_id' };
  if (type === 'contrat') return { table: 'contrats_clients', column: 'contrat_client_id' };
  return null;
}

// GET /api/encaissements/:type/:id/versements — historique des tranches
router.get('/:type/:id/versements', async (req, res) => {
  try {
    const target = targetTable(req.params.type);
    if (!target) return res.status(400).json({ error: 'Type invalide' });
    const ids = req.scopeIds;

    const owns = await pool.query(
      `SELECT id FROM ${target.table} WHERE id=$1 AND user_id = ANY($2::uuid[])`,
      [req.params.id, ids]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Transaction non trouvee' });

    const result = await pool.query(
      `SELECT * FROM versements WHERE ${target.column}=$1 ORDER BY date DESC, created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET encaissements versements:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/encaissements/:type/:id/versements — enregistrer une tranche
router.post('/:type/:id/versements', requirePerm('encaissements:versement'), async (req, res) => {
  try {
    const target = targetTable(req.params.type);
    if (!target) return res.status(400).json({ error: 'Type invalide' });
    const { montant, mode, date } = req.body;
    if (!isPositiveNumber(montant)) return res.status(400).json({ error: 'montant doit etre un nombre positif' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'date invalide (format YYYY-MM-DD attendu)' });

    const ids = req.scopeIds;
    const ownsR = await pool.query(
      `SELECT * FROM ${target.table} WHERE id=$1 AND user_id = ANY($2::uuid[])`,
      [req.params.id, ids]
    );
    if (!ownsR.rows.length) return res.status(404).json({ error: 'Transaction non trouvee' });

    // Cap sur-versement : le versement ne peut pas dépasser le solde restant dû
    if (req.params.type === 'vente') {
      const totalDejaR = await pool.query(
        'SELECT COALESCE(SUM(montant),0) AS total FROM versements WHERE vente_id=$1', [req.params.id]
      );
      const totalDeja = +totalDejaR.rows[0].total;
      const restant   = +ownsR.rows[0].montant - totalDeja;
      if (restant <= 0) return res.status(400).json({ error: 'Vente deja entierement payee' });
      if (+montant > restant)
        return res.status(400).json({ error: `Versement excessif : montant maximum autorise est ${restant}` });
    }

    const result = await pool.query(
      `INSERT INTO versements (${target.column}, montant, mode, date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, +montant, mode || null, date || new Date().toISOString().slice(0, 10)]
    );

    if (req.params.type === 'vente') {
      const totalR = await pool.query('SELECT COALESCE(SUM(montant),0) AS total FROM versements WHERE vente_id=$1', [req.params.id]);
      if (+totalR.rows[0].total >= +ownsR.rows[0].montant) {
        await pool.query("UPDATE ventes SET statut_paiement='Paye' WHERE id=$1", [req.params.id]);
      }
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST encaissements versements:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
