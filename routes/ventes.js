const express = require('express');
const { pool, nextNumero } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { findOrCreateClient } = require('./clients');
const { isPositiveNumber, isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds);

const STATUTS = ['Paye','En cours','En retard'];
const MODES   = ['Espèces','Virement','Chèque','Mobile Money'];

// GET /api/ventes  (avec filtres)
router.get('/', async (req, res) => {
  try {
    const { mois, annee, statut, client_id } = req.query;
    const limit  = Math.min(Math.max(0, parseInt(req.query.limit)  || 200), 500);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const ids = req.scopeIds;
    let q = `SELECT v.*, c.type as client_type, u.nom as vendeur_nom,
                    COALESCE(ve.total_verse, 0) AS total_verse,
                    COALESCE(rl.nb_relances, 0) AS nb_relances,
                    rl.derniere_relance
             FROM ventes v
             LEFT JOIN clients c ON v.client_id = c.id
             LEFT JOIN users u ON u.id = v.user_id
             LEFT JOIN (SELECT vente_id, SUM(montant) AS total_verse FROM versements GROUP BY vente_id) ve ON ve.vente_id = v.id
             LEFT JOIN (SELECT vente_id, COUNT(*) AS nb_relances, MAX(date) AS derniere_relance FROM relances GROUP BY vente_id) rl ON rl.vente_id = v.id
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
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note, telephone } = req.body;
    if (!client_nom || !date_vente || !produit || !quantite || !prix_unitaire)
      return res.status(400).json({ error: 'Champs requis : client_nom, date_vente, produit, quantite, prix_unitaire' });
    if (!isPositiveNumber(quantite))
      return res.status(400).json({ error: 'quantite doit etre un nombre positif' });
    if (!isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (cout_unitaire !== undefined && cout_unitaire !== null && !isNonNegativeNumber(cout_unitaire))
      return res.status(400).json({ error: 'cout_unitaire doit etre un nombre positif ou nul' });
    if (!isValidDate(date_vente))
      return res.status(400).json({ error: 'date_vente invalide (format YYYY-MM-DD attendu)' });
    if (date_echeance && !isValidDate(date_echeance))
      return res.status(400).json({ error: 'date_echeance invalide (format YYYY-MM-DD attendu)' });
    if (statut_paiement && !STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'statut_paiement invalide' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(produit, 200))    return res.status(400).json({ error: 'produit trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    // Rattache la vente à un client existant (ou le crée) pour garder le portefeuille à jour.
    let resolvedClientId = client_id || null;
    if (!resolvedClientId) {
      const client = await findOrCreateClient(req.userId, client_nom, telephone);
      resolvedClientId = client.id;
    } else {
      await pool.query(
        "UPDATE clients SET statut='Actif' WHERE id=$1 AND user_id=$2 AND statut='Prospect'",
        [client_id, req.userId]
      );
    }

    const numero = await nextNumero('ventes', 'V', req.userId);
    const result = await pool.query(
      `INSERT INTO ventes (user_id, client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.userId, resolvedClientId, client_nom.trim(), date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement || 'En cours',
       date_echeance || null, mode || null, cout_unitaire || 0, note || null, numero]
    );

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
// Politique B5 : vendeur et manager ne modifient que leurs propres ventes.
// Directeur, rizier, support, superadmin : toute vente dans leur périmètre (scopeIds).
router.put('/:id', async (req, res) => {
  try {
    const { client_id, client_nom, date_vente, produit, quantite, prix_unitaire, statut_paiement, date_echeance, mode, cout_unitaire, note } = req.body;
    if (statut_paiement && !STATUTS.includes(statut_paiement))
      return res.status(400).json({ error: 'Statut invalide' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (quantite !== undefined && !isPositiveNumber(quantite))
      return res.status(400).json({ error: 'quantite doit etre un nombre positif' });
    if (prix_unitaire !== undefined && !isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (cout_unitaire !== undefined && cout_unitaire !== null && !isNonNegativeNumber(cout_unitaire))
      return res.status(400).json({ error: 'cout_unitaire doit etre un nombre positif ou nul' });
    if (date_vente && !isValidDate(date_vente))
      return res.status(400).json({ error: 'date_vente invalide (format YYYY-MM-DD attendu)' });
    if (date_echeance && !isValidDate(date_echeance))
      return res.status(400).json({ error: 'date_echeance invalide (format YYYY-MM-DD attendu)' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    const ownerOnly = ['vendeur', 'manager'].includes(req.userRole);
    const filterClause = ownerOnly
      ? 'user_id = $13'
      : 'user_id = ANY($13::uuid[])';
    const filterParam = ownerOnly ? req.userId : req.scopeIds;

    const result = await pool.query(
      `UPDATE ventes SET
         client_id=$1, client_nom=$2, date_vente=$3, produit=$4,
         quantite=$5, prix_unitaire=$6, statut_paiement=$7,
         date_echeance=$8, mode=$9, cout_unitaire=$10, note=$11
       WHERE id=$12 AND ${filterClause} RETURNING *`,
      [client_id || null, client_nom, date_vente, produit,
       +quantite, +prix_unitaire, statut_paiement,
       date_echeance || null, mode || null, cout_unitaire || 0, note || null,
       req.params.id, filterParam]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/ventes/:id/statut
router.patch('/:id/statut', requirePerm('ventes:statut'), async (req, res) => {
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

// GET /api/ventes/:id/versements
router.get('/:id/versements', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const owns = await pool.query('SELECT id FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, ids]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    const result = await pool.query('SELECT * FROM versements WHERE vente_id=$1 ORDER BY date DESC, created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes/:id/versements — enregistrer un encaissement (paiement échelonné)
router.post('/:id/versements', requirePerm('ventes:versement'), async (req, res) => {
  try {
    const { montant, mode, date } = req.body;
    if (!isPositiveNumber(montant)) return res.status(400).json({ error: 'montant doit etre un nombre positif' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'date invalide (format YYYY-MM-DD attendu)' });

    const ids = req.scopeIds;
    const venteR = await pool.query('SELECT * FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, ids]);
    if (!venteR.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });

    const totalDejaR = await pool.query(
      'SELECT COALESCE(SUM(montant),0) AS total FROM versements WHERE vente_id=$1', [req.params.id]
    );
    const totalDeja = +totalDejaR.rows[0].total;
    const restant   = +venteR.rows[0].montant - totalDeja;
    if (restant <= 0) return res.status(400).json({ error: 'Vente deja entierement payee' });
    if (+montant > restant)
      return res.status(400).json({ error: `Versement excessif : montant maximum autorise est ${restant}` });

    const result = await pool.query(
      `INSERT INTO versements (vente_id, montant, mode, date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, +montant, mode || null, date || new Date().toISOString().slice(0, 10)]
    );

    if (totalDeja + +montant >= +venteR.rows[0].montant) {
      await pool.query("UPDATE ventes SET statut_paiement='Paye' WHERE id=$1", [req.params.id]);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST versements:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/ventes/:id/relances — enregistrer une relance de créance
router.post('/:id/relances', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const owns = await pool.query('SELECT id FROM ventes WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, ids]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Vente non trouvee' });
    const result = await pool.query(
      `INSERT INTO relances (vente_id, date) VALUES ($1, $2) RETURNING *`,
      [req.params.id, req.body.date || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/ventes/:id
router.delete('/:id', requirePerm('ventes:delete'), async (req, res) => {
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
