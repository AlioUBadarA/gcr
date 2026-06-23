const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth, attachScopeIds);

const TYPES_VALIDES = ['Grossiste','Detaillant marche','Boutique','Restauration','Cantine/Institution'];
const STATUTS_VALIDES = ['Actif','Prospect','Dormant'];

// Cherche un client existant (même rizier, nom identique) pour le rattacher à une
// nouvelle vente/contrat, ou le crée automatiquement sinon — pour que chaque
// transaction garde le portefeuille clients à jour sans saisie manuelle.
async function findOrCreateClient(userId, clientNom, telephone) {
  const nom = clientNom.trim();
  const existing = await pool.query(
    'SELECT * FROM clients WHERE user_id=$1 AND LOWER(nom)=LOWER($2) LIMIT 1',
    [userId, nom]
  );
  if (existing.rows.length) {
    const c = existing.rows[0];
    const result = await pool.query(
      `UPDATE clients SET
         statut = CASE WHEN statut = 'Prospect' THEN 'Actif' ELSE statut END,
         telephone = COALESCE(telephone, $1)
       WHERE id = $2 RETURNING *`,
      [telephone || null, c.id]
    );
    return result.rows[0];
  }
  const created = await pool.query(
    `INSERT INTO clients (user_id, nom, type, statut, telephone) VALUES ($1,$2,'Boutique','Actif',$3) RETURNING *`,
    [userId, nom, telephone || null]
  );
  return created.rows[0];
}

// GET /api/clients
router.get('/', async (req, res) => {
  try {
    const { statut, type, search } = req.query;
    const ids = req.scopeIds;
    let q = `SELECT c.*, u.nom AS vendeur_nom
             FROM clients c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS_VALIDES.includes(statut)) {
      q += ` AND c.statut = $${params.length + 1}`; params.push(statut);
    }
    if (type && TYPES_VALIDES.includes(type)) {
      q += ` AND c.type = $${params.length + 1}`; params.push(type);
    }
    if (search) {
      q += ` AND (c.nom ILIKE $${params.length + 1} OR c.zone ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    q += ' ORDER BY c.statut, c.nom';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/clients
router.post('/', async (req, res) => {
  try {
    const { nom, type, statut, zone, region, segment, potentiel_annuel, telephone, volume_estime, frequence, valorise, horaire, note, produits_interet } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'Nom et type requis' });
    if (!TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide' });

    const result = await pool.query(
      `INSERT INTO clients (user_id, nom, type, statut, zone, region, segment, potentiel_annuel, telephone, volume_estime, frequence, valorise, horaire, note, produits_interet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.userId, nom.trim(), type, statut || 'Prospect', zone || null, region || null, segment || null,
       potentiel_annuel || 0, telephone || null, volume_estime || 0, frequence || null, valorise || null, horaire || null, note || null,
       Array.isArray(produits_interet) ? produits_interet : []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST clients:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND user_id = ANY($2::uuid[])',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  try {
    const { nom, type, statut, zone, region, segment, potentiel_annuel, telephone, volume_estime, frequence, valorise, horaire, note, produits_interet } = req.body;
    if (type && !TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
    if (statut && !STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });

    const ids = req.scopeIds;
    const result = await pool.query(
      `UPDATE clients SET
         nom=$1, type=$2, statut=$3, zone=$4, region=$5, segment=$6, potentiel_annuel=$7, telephone=$8,
         volume_estime=$9, frequence=$10, valorise=$11, horaire=$12, note=$13, produits_interet=$14
       WHERE id=$15 AND user_id = ANY($16::uuid[]) RETURNING *`,
      [nom, type, statut, zone || null, region || null, segment || null, potentiel_annuel || 0, telephone || null,
       volume_estime || 0, frequence || null, valorise || null, horaire || null, note || null,
       Array.isArray(produits_interet) ? produits_interet : [],
       req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/clients/:id/statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    const ids = req.scopeIds;
    const result = await pool.query(
      'UPDATE clients SET statut=$1 WHERE id=$2 AND user_id = ANY($3::uuid[]) RETURNING *',
      [statut, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'DELETE FROM clients WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouve' });
    res.json({ message: 'Client supprime' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.findOrCreateClient = findOrCreateClient;
