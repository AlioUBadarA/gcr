const express = require('express');
const { pool, nextNumero } = require('../db/pool');
const auth = require('../middleware/auth');
const { getScopeIds } = require('../middleware/scope');
const { findOrCreateClient } = require('./clients');
const { isPositiveNumber, isNonNegativeNumber, isValidDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth);

const STATUTS = ['Actif','Suspendu','Terminé'];

// ══════════════════════════════════════════════
// CONTRATS CLIENTS (aval)
// ══════════════════════════════════════════════

// GET /api/contrats/clients
router.get('/clients', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    // Mise à jour automatique : tout contrat dont date_fin est dépassée passe à 'Terminé'
    await pool.query(
      `UPDATE contrats_clients SET statut='Terminé'
       WHERE user_id = ANY($1::uuid[]) AND date_fin < CURRENT_DATE AND statut != 'Terminé'`,
      [ids]
    );
    const { statut } = req.query;
    let q = `SELECT cc.*, u.nom AS vendeur_nom
             FROM contrats_clients cc
             LEFT JOIN users u ON u.id = cc.user_id
             WHERE cc.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND cc.statut = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY cc.statut, cc.client_nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET contrats/clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/contrats/clients
router.post('/clients', async (req, res) => {
  try {
    const { client_id, client_nom, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note } = req.body;
    const produitsArr = Array.isArray(produits) && produits.length > 0 ? produits : [];
    if (!client_nom || !produitsArr.length) return res.status(400).json({ error: 'Client et au moins un produit requis' });
    if (quantite_mensuelle !== undefined && quantite_mensuelle !== null && !isNonNegativeNumber(quantite_mensuelle))
      return res.status(400).json({ error: 'quantite_mensuelle doit etre un nombre positif ou nul' });
    if (prix_unitaire !== undefined && prix_unitaire !== null && !isNonNegativeNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    let resolvedClientId = client_id || null;
    if (!resolvedClientId) {
      const client = await findOrCreateClient(req.userId, client_nom, null);
      resolvedClientId = client.id;
    }

    const numero = await nextNumero('contrats_clients', 'CC', req.userId);
    const result = await pool.query(
      `INSERT INTO contrats_clients (user_id, client_id, client_nom, produit, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.userId, resolvedClientId, client_nom.trim(), produitsArr[0],
       produitsArr, quantite_mensuelle || 0, prix_unitaire || 0,
       date_debut || null, date_fin || null, statut || 'Actif', note || null, numero]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST contrats/clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/contrats/clients/:id
router.put('/clients/:id', async (req, res) => {
  try {
    const { client_nom, produits, quantite_mensuelle, prix_unitaire, date_debut, date_fin, statut, note } = req.body;
    const produitsArr = Array.isArray(produits) && produits.length > 0 ? produits : [];
    if (!produitsArr.length) return res.status(400).json({ error: 'Au moins un produit requis' });
    if (quantite_mensuelle !== undefined && quantite_mensuelle !== null && !isNonNegativeNumber(quantite_mensuelle))
      return res.status(400).json({ error: 'quantite_mensuelle doit etre un nombre positif ou nul' });
    if (prix_unitaire !== undefined && prix_unitaire !== null && !isNonNegativeNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `UPDATE contrats_clients SET client_nom=$1, produit=$2, produits=$3, quantite_mensuelle=$4,
         prix_unitaire=$5, date_debut=$6, date_fin=$7, statut=$8, note=$9
       WHERE id=$10 AND user_id = ANY($11::uuid[]) RETURNING *`,
      [client_nom, produitsArr[0], produitsArr, quantite_mensuelle || 0, prix_unitaire || 0,
       date_debut || null, date_fin || null, statut || 'Actif', note || null,
       req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/contrats/clients/:id
router.delete('/clients/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM contrats_clients WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════
// CONTRATS PADDY (amont)
// ══════════════════════════════════════════════

// GET /api/contrats/paddy
router.get('/paddy', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    await pool.query(
      `UPDATE contrats_paddy SET statut='Terminé'
       WHERE user_id = ANY($1::uuid[]) AND date_fin < CURRENT_DATE AND statut != 'Terminé'`,
      [ids]
    );
    const { statut } = req.query;
    let q = `SELECT cp.*, u.nom AS vendeur_nom
             FROM contrats_paddy cp
             LEFT JOIN users u ON u.id = cp.user_id
             WHERE cp.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND cp.statut = $${params.length + 1}`; params.push(statut);
    }
    q += ' ORDER BY cp.statut, cp.producteur_nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET contrats/paddy:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/contrats/paddy
router.post('/paddy', async (req, res) => {
  try {
    const { producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note } = req.body;
    if (!producteur_nom) return res.status(400).json({ error: 'Nom du producteur requis' });
    if (quantite_kg !== undefined && quantite_kg !== null && !isNonNegativeNumber(quantite_kg))
      return res.status(400).json({ error: 'quantite_kg doit etre un nombre positif ou nul' });
    if (prix_kg !== undefined && prix_kg !== null && !isNonNegativeNumber(prix_kg))
      return res.status(400).json({ error: 'prix_kg doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(producteur_nom, 200)) return res.status(400).json({ error: 'producteur_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))          return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const numero = await nextNumero('contrats_paddy', 'CP', req.userId);
    const result = await pool.query(
      `INSERT INTO contrats_paddy (user_id, producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.userId, producteur_nom.trim(), zone || null, telephone || null,
       variete || null, quantite_kg || 0, prix_kg || 0,
       date_debut || null, date_fin || null, statut || 'Actif', note || null, numero]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST contrats/paddy:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/contrats/paddy/:id
router.put('/paddy/:id', async (req, res) => {
  try {
    const { producteur_nom, zone, telephone, variete, quantite_kg, prix_kg, date_debut, date_fin, statut, note } = req.body;
    if (quantite_kg !== undefined && quantite_kg !== null && !isNonNegativeNumber(quantite_kg))
      return res.status(400).json({ error: 'quantite_kg doit etre un nombre positif ou nul' });
    if (prix_kg !== undefined && prix_kg !== null && !isNonNegativeNumber(prix_kg))
      return res.status(400).json({ error: 'prix_kg doit etre un nombre positif ou nul' });
    if (date_debut && !isValidDate(date_debut))
      return res.status(400).json({ error: 'date_debut invalide (format YYYY-MM-DD attendu)' });
    if (date_fin && !isValidDate(date_fin))
      return res.status(400).json({ error: 'date_fin invalide (format YYYY-MM-DD attendu)' });
    if (date_debut && date_fin && date_fin <= date_debut)
      return res.status(400).json({ error: 'date_fin doit etre posterieure a date_debut' });
    if (!maxLen(producteur_nom, 200)) return res.status(400).json({ error: 'producteur_nom trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))          return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      `UPDATE contrats_paddy SET producteur_nom=$1, zone=$2, telephone=$3, variete=$4,
         quantite_kg=$5, prix_kg=$6, date_debut=$7, date_fin=$8, statut=$9, note=$10
       WHERE id=$11 AND user_id = ANY($12::uuid[]) RETURNING *`,
      [producteur_nom, zone || null, telephone || null, variete || null,
       quantite_kg || 0, prix_kg || 0, date_debut || null, date_fin || null,
       statut || 'Actif', note || null, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/contrats/paddy/:id
router.delete('/paddy/:id', async (req, res) => {
  try {
    const ids = await getScopeIds(req.userId, req.userRole);
    const result = await pool.query(
      'DELETE FROM contrats_paddy WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
