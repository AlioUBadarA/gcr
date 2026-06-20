const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

const STATUTS = ['Paye','En cours','En retard'];

// GET /api/ventes  (avec filtres)
router.get('/', async (req, res) => {
  try {
    const { mois, annee, statut, client_id, limit = 200, offset = 0 } = req.query;
    const ids = req.scopeIds;
    let q = `SELECT v.*, c.type as client_type, u.nom as vendeur_nom
             FROM ventes v
             LEFT JOIN clients c ON v.client_id = c.id
             LEFT JOIN users u ON u.id = v.user_id
             WHERE v.user_id = ANY($1::uuid[])`;
    const params = [ids];

    if (mois && annee) {
      q += ` AND EXTRACT(MONTH FROM date_vente) = $${params.length+1}
             AND EXTRACT(YEAR  FROM date_vente) = $${params.length+2}`;
      params.push(+mois, +annee);
    } else if (annee) {
      q += ` AND EXTRACT(YEAR FROM date_vente) = $${params.length+1}`;
      params.push(+annee);
    }
    if (statut && STATUTS.includes(statut)) {
      q += ` AND statut_paiement = $${params.length+1}`; params.push(statut);
    }
    if (client_id) {
      q += ` AND v.client_id = $${params.length+1}`; params.push(client_id);
    }
    q += ` ORDER BY date_vente DESC, v.created_at DESC
           LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(+limit, +offset);

    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET ventes:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes
router.post('/', async (req, res) => {
  try {
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, note } = req.body;
    if (!client_nom || !date_vente || !produit || !quantite || !prix_unitaire)
      return res.status(400).json({ error: 'Champs requis : client_nom, date_vente, produit, quantite, prix_unitaire' });
    if (quantite <= 0 || prix_unitaire <= 0)
      return res.status(400).json({ error: 'Quantite et prix doivent etre positifs' });

    const result = await pool.query(
      `INSERT INTO ventes (user_id, client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.userId, client_id || null, client_nom.trim(), date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement || 'En cours',
       date_echeance || null, note || null]
    );

    // Si client_id fourni, passer statut a Actif
    if (client_id) {
      await pool.query(
        "UPDATE clients SET statut='Actif' WHERE id=$1 AND user_id=$2 AND statut='Prospect'",
        [client_id, req.userId]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST ventes:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/ventes/:id
router.get('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'SELECT * FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/ventes/:id
router.put('/:id', async (req, res) => {
  try {
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, note } = req.body;
    if (statut_paiement && !STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'Statut invalide' });

    const ids = req.scopeIds;
    const result = await pool.query(
      `UPDATE ventes SET
         client_id=$1, client_nom=$2, date_vente=$3, produit=$4,
         quantite=$5, prix_unitaire=$6, statut_paiement=$7,
         date_echeance=$8, note=$9
       WHERE id=$10 AND user_id = ANY($11::uuid[]) RETURNING *`,
      [client_id || null, client_nom, date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement,
       date_echeance || null, note || null,
       req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/ventes/:id/statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut_paiement } = req.body;
    if (!STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'Statut invalide' });
    const ids = req.scopeIds;
    const result = await pool.query(
      'UPDATE ventes SET statut_paiement=$1 WHERE id=$2 AND user_id = ANY($3::uuid[]) RETURNING *',
      [statut_paiement, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/ventes/:id
router.delete('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'DELETE FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json({ message: 'Vente supprimee' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
