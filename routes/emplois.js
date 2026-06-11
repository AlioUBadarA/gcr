const express = require('express');
const { pool } = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

const TYPES = ['CDI','CDD','Temps partiel','Stage','Journalier'];

// GET /api/emplois
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM emplois WHERE user_id = $1 ORDER BY nom`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET emplois:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/emplois
router.post('/', async (req, res) => {
  try {
    const { nom, poste, type_contrat, date_embauche, salaire, telephone, note } = req.body;
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    const result = await pool.query(
      `INSERT INTO emplois (user_id, nom, poste, type_contrat, date_embauche, salaire, telephone, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.userId, nom.trim(), poste || null, type_contrat || 'CDI',
       date_embauche || null, salaire || null, telephone || null, note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST emplois:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/emplois/:id
router.put('/:id', async (req, res) => {
  try {
    const { nom, poste, type_contrat, date_embauche, salaire, telephone, note } = req.body;
    const result = await pool.query(
      `UPDATE emplois SET nom=$1, poste=$2, type_contrat=$3, date_embauche=$4,
         salaire=$5, telephone=$6, note=$7
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [nom, poste || null, type_contrat || 'CDI', date_embauche || null,
       salaire || null, telephone || null, note || null, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/emplois/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM emplois WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
