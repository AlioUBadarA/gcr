const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');

const router = express.Router();
router.use(auth, requirePerm('pilotage:access'));

const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

// GET /api/pilotage/equipe/:semaine — vue consolidée de toute l'équipe (manager/directeur/rizier)
router.get('/equipe/:semaine', attachScopeIds, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.nom AS vendeur_nom
       FROM pilotage p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ANY($1::uuid[]) AND p.semaine = $2
       ORDER BY u.nom,
         CASE p.jour WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
                     WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6 END`,
      [req.scopeIds, req.params.semaine]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET pilotage equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pilotage/:semaine
router.get('/:semaine', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM pilotage WHERE user_id=$1 AND semaine=$2 ORDER BY
        CASE jour WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
                  WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6 END`,
      [req.userId, req.params.semaine]
    );
    // Retourne les 6 jours meme si certains n'ont pas encore de donnees
    const map = {};
    result.rows.forEach(r => { map[r.jour] = r; });
    const data = JOURS.map(j => map[j] || {
      jour: j, semaine: req.params.semaine,
      zone: '', clients_visiter: '', objectif: 0, realise: 0, note: ''
    });
    res.json(data);
  } catch (err) {
    console.error('GET pilotage:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pilotage/:semaine  (upsert de tous les jours en une fois)
router.put('/:semaine', async (req, res) => {
  const { semaine } = req.params;
  const { jours } = req.body; // tableau de 6 objets

  if (!Array.isArray(jours))
    return res.status(400).json({ error: 'jours doit etre un tableau' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const j of jours) {
      if (!JOURS.includes(j.jour)) continue;
      const result = await client.query(
        `INSERT INTO pilotage (user_id, semaine, jour, zone, clients_visiter, objectif, realise, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id, semaine, jour)
         DO UPDATE SET zone=$4, clients_visiter=$5, objectif=$6, realise=$7, note=$8
         RETURNING *`,
        [req.userId, semaine, j.jour,
         j.zone || null, j.clients_visiter || null,
         +j.objectif || 0, +j.realise || 0, j.note || null]
      );
      saved.push(result.rows[0]);
    }
    await client.query('COMMIT');
    res.json(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT pilotage:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/pilotage/:semaine/visites — clients/prospects à visiter, avec leurs données
router.get('/:semaine/visites', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.semaine, v.jour, v.commentaire, v.client_id, v.prospect_id, v.created_at,
        c.nom AS client_nom, c.statut AS client_statut, c.zone AS client_zone,
        c.telephone AS client_telephone, c.type AS client_type,
        (SELECT MAX(date_vente) FROM ventes WHERE client_id = c.id) AS client_derniere_vente,
        (SELECT COALESCE(SUM(montant),0) FROM ventes WHERE client_id = c.id) AS client_ca_total,
        p.nom AS prospect_nom, p.statut AS prospect_statut, p.zone AS prospect_zone,
        p.telephone AS prospect_telephone, p.valeur_estimee AS prospect_valeur_estimee,
        p.priorite AS prospect_priorite
      FROM pilotage_visites v
      LEFT JOIN clients c ON c.id = v.client_id
      LEFT JOIN prospection p ON p.id = v.prospect_id
      WHERE v.user_id = $1 AND v.semaine = $2
      ORDER BY v.created_at`,
      [req.userId, req.params.semaine]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET pilotage visites:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pilotage/:semaine/visites — ajouter un client ou prospect à visiter un jour donné
router.post('/:semaine/visites', attachScopeIds, async (req, res) => {
  try {
    const { jour, client_id, prospect_id, commentaire } = req.body;
    if (!JOURS.includes(jour)) return res.status(400).json({ error: 'Jour invalide' });
    if (!client_id && !prospect_id) return res.status(400).json({ error: 'Sélectionnez un client ou un prospect' });
    if (client_id && prospect_id) return res.status(400).json({ error: 'Un seul de client_id ou prospect_id' });

    if (client_id) {
      const owns = await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id = ANY($2::uuid[])', [client_id, req.scopeIds]);
      if (!owns.rows.length) return res.status(404).json({ error: 'Client non trouvé' });
    } else {
      const owns = await pool.query('SELECT id FROM prospection WHERE id=$1 AND user_id = ANY($2::uuid[])', [prospect_id, req.scopeIds]);
      if (!owns.rows.length) return res.status(404).json({ error: 'Prospect non trouvé' });
    }

    const result = await pool.query(
      `INSERT INTO pilotage_visites (user_id, semaine, jour, client_id, prospect_id, commentaire)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, req.params.semaine, jour, client_id || null, prospect_id || null, commentaire || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST pilotage visites:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pilotage/visites/:id — modifier le commentaire (action à poser) ou le jour
router.put('/visites/:id', async (req, res) => {
  try {
    const { commentaire, jour } = req.body;
    if (jour && !JOURS.includes(jour)) return res.status(400).json({ error: 'Jour invalide' });
    const result = await pool.query(
      `UPDATE pilotage_visites
       SET commentaire = CASE WHEN $1::boolean THEN $2 ELSE commentaire END,
           jour        = COALESCE($3, jour)
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      ['commentaire' in req.body, req.body.commentaire ?? null, jour || null, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Visite non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/pilotage/visites/:id
router.delete('/visites/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM pilotage_visites WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Visite non trouvée' });
    res.json({ message: 'Visite supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pilotage/:semaine/actions
router.get('/:semaine/actions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM actions_correctives WHERE user_id=$1 AND semaine=$2',
      [req.userId, req.params.semaine]
    );
    res.json(result.rows[0] || { semaine: req.params.semaine, contenu: '' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pilotage/:semaine/actions
router.put('/:semaine/actions', async (req, res) => {
  try {
    const { contenu } = req.body;
    const result = await pool.query(
      `INSERT INTO actions_correctives (user_id, semaine, contenu)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, semaine)
       DO UPDATE SET contenu=$3 RETURNING *`,
      [req.userId, req.params.semaine, contenu || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
