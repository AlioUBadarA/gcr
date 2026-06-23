const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool, withTransaction, reassignVendeurData } = require('../db/pool');
const auth    = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

function canManage(req, res, next) {
  if (!['rizier', 'manager', 'superadmin'].includes(req.userRole))
    return res.status(403).json({ error: 'Accès réservé au responsable de rizerie' });
  next();
}

// GET /api/equipe — tous les commerciaux du périmètre (directs + sous chaque manager)
router.get('/', canManage, attachScopeIds, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.email, u.telephone, u.suspended, u.created_at, u.parent_id,
             m.nom AS manager_nom,
             COUNT(DISTINCT v.id)        AS nb_ventes,
             COALESCE(SUM(v.montant), 0) AS ca_total,
             MAX(v.date_vente)           AS derniere_vente
      FROM users u
      LEFT JOIN users m ON m.id = u.parent_id AND m.role = 'manager'
      LEFT JOIN ventes v ON v.user_id = u.id
      WHERE u.id = ANY($1::uuid[]) AND u.role = 'vendeur'
      GROUP BY u.id, m.nom
      ORDER BY u.nom
    `, [req.scopeIds]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/equipe — créer un commercial (vendeur) ou, si rizier, un manager
router.post('/', canManage, async (req, res) => {
  try {
    const { nom, email, password, telephone, role, zone, manager_id } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

    const wantsManager = role === 'manager';
    if (wantsManager && req.userRole !== 'rizier')
      return res.status(403).json({ error: 'Seul le rizier peut créer un manager' });

    let parentId = req.userId;
    if (!wantsManager && req.userRole === 'rizier' && manager_id) {
      const mgr = await pool.query(
        `SELECT id FROM users WHERE id=$1 AND parent_id=$2 AND role='manager'`,
        [manager_id, req.userId]
      );
      if (!mgr.rows.length) return res.status(400).json({ error: 'Manager invalide' });
      parentId = manager_id;
    }

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, telephone, role, parent_id, zone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nom, email, telephone, role, zone, parent_id, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash, telephone || null,
       wantsManager ? 'manager' : 'vendeur', parentId, wantsManager ? (zone || null) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/equipe/:id
router.put('/:id', canManage, attachScopeIds, async (req, res) => {
  try {
    const { nom, email, telephone } = req.body;
    const result = await pool.query(
      `UPDATE users SET nom=$1, email=$2, telephone=$3
       WHERE id=$4 AND id = ANY($5::uuid[]) AND role='vendeur'
       RETURNING id, nom, email, telephone, role`,
      [nom, email?.toLowerCase(), telephone || null, req.params.id, req.scopeIds]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/equipe/:id/password
router.patch('/:id/password', canManage, attachScopeIds, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password=$1
       WHERE id=$2 AND id = ANY($3::uuid[]) AND role='vendeur'
       RETURNING id, nom, email`,
      [hash, req.params.id, req.scopeIds]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/equipe/:id
// Rattache les ventes/clients du vendeur à son rattachement direct (manager ou rizier) avant
// suppression, pour ne pas perdre l'historique.
router.delete('/:id', canManage, attachScopeIds, async (req, res) => {
  try {
    const found = await withTransaction(async (client) => {
      const v = await client.query(
        `SELECT id, parent_id FROM users WHERE id=$1 AND id = ANY($2::uuid[]) AND role='vendeur'`,
        [req.params.id, req.scopeIds]
      );
      if (!v.rows.length) return false;
      await reassignVendeurData(client, req.params.id, v.rows[0].parent_id);
      await client.query('DELETE FROM users WHERE id=$1', [req.params.id]);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Vendeur non trouvé' });
    res.json({ message: 'Vendeur supprimé' });
  } catch (err) {
    console.error('DELETE equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
