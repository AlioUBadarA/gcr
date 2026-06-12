const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db/pool');
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();
router.use(auth, isAdmin);

// ── Helper audit ──────────────────────────────────────────────
async function log(actorId, actorNom, action, target, detail, ip) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_nom, action, target_id, target_nom, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actorId, actorNom, action, target?.id || null, target?.nom || null,
       detail ? JSON.stringify(detail) : null, ip || null]
    );
  } catch (e) {
    console.error('audit log error:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// STATS GLOBALES
// ══════════════════════════════════════════════════════════════

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [usersR, ventesR, clientsR, caMoisR, caGlobalR, suspendedR] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE role = 'rizier'`),
      pool.query(`SELECT COUNT(*) FROM ventes`),
      pool.query(`SELECT COUNT(*) FROM clients`),
      pool.query(`SELECT COALESCE(SUM(montant),0) as total FROM ventes
                  WHERE date_vente >= date_trunc('month', NOW())`),
      pool.query(`SELECT COALESCE(SUM(montant),0) as total FROM ventes`),
      pool.query(`SELECT COUNT(*) FROM users WHERE suspended = TRUE`),
    ]);
    res.json({
      total_riziers:   Number(usersR.rows[0].count),
      total_ventes:    Number(ventesR.rows[0].count),
      total_clients:   Number(clientsR.rows[0].count),
      ca_mois:         Number(caMoisR.rows[0].total),
      ca_global:       Number(caGlobalR.rows[0].total),
      comptes_suspendus: Number(suspendedR.rows[0].count),
    });
  } catch (err) {
    console.error('admin stats:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// GESTION DES RIZERIES
// ══════════════════════════════════════════════════════════════

// GET /api/admin/rizeries
router.get('/rizeries', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.nom, r.ville, r.telephone, r.created_at,
             COUNT(DISTINCT u.id)         AS nb_comptes,
             COALESCE(SUM(v.montant), 0)  AS ca_total
      FROM rizeries r
      LEFT JOIN users  u ON u.rizerie_id = r.id AND u.role IN ('rizier','vendeur')
      LEFT JOIN ventes v ON v.user_id = u.id
      GROUP BY r.id
      ORDER BY r.nom
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET rizeries:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/rizeries
router.post('/rizeries', async (req, res) => {
  try {
    const { nom, ville, telephone } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom de la rizerie requis' });
    const exists = await pool.query('SELECT id FROM rizeries WHERE LOWER(nom)=LOWER($1)', [nom.trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Une rizerie avec ce nom existe déjà' });
    const result = await pool.query(
      `INSERT INTO rizeries (nom, ville, telephone) VALUES ($1,$2,$3) RETURNING *`,
      [nom.trim(), ville || null, telephone || null]
    );
    await log(req.userId, req.userNom, 'RIZERIE_CREATED', result.rows[0], {}, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST rizeries:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/rizeries/:id
router.put('/rizeries/:id', async (req, res) => {
  try {
    const { nom, ville, telephone } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom requis' });
    const result = await pool.query(
      `UPDATE rizeries SET nom=$1, ville=$2, telephone=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [nom.trim(), ville || null, telephone || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Rizerie non trouvée' });
    // Sync le champ texte rizerie sur les users liés
    await pool.query(`UPDATE users SET rizerie=$1 WHERE rizerie_id=$2`, [nom.trim(), req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/rizeries/:id
router.delete('/rizeries/:id', async (req, res) => {
  try {
    const linked = await pool.query(`SELECT COUNT(*) FROM users WHERE rizerie_id=$1`, [req.params.id]);
    if (Number(linked.rows[0].count) > 0)
      return res.status(400).json({ error: 'Impossible : des comptes sont rattachés à cette rizerie' });
    await pool.query('DELETE FROM rizeries WHERE id=$1', [req.params.id]);
    res.json({ message: 'Rizerie supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// GESTION DES UTILISATEURS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/users — liste les comptes riziers uniquement
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.nom, u.email, u.rizerie, u.telephone, u.ville,
        u.role, u.suspended, u.suspended_reason, u.suspended_at,
        u.created_at, u.rizerie_id,
        r.nom AS rizerie_nom,
        COUNT(DISTINCT v.id)         AS nb_ventes,
        COUNT(DISTINCT c.id)         AS nb_clients,
        COALESCE(SUM(v.montant), 0)  AS ca_total,
        MAX(v.date_vente)            AS derniere_vente
      FROM users u
      LEFT JOIN rizeries r ON r.id = u.rizerie_id
      LEFT JOIN ventes   v ON v.user_id = u.id
      LEFT JOIN clients  c ON c.user_id = u.id
      WHERE u.role = 'rizier'
      GROUP BY u.id, r.nom
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('admin users list:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/users/:id — profil complet + ventes + clients + équipe vendeurs
router.get('/users/:id', async (req, res) => {
  try {
    const [userR, ventesR, clientsR, pilotageR, vendeursR] = await Promise.all([
      pool.query(
        `SELECT id, nom, email, rizerie, telephone, ville, role,
                suspended, suspended_reason, suspended_at, created_at
         FROM users WHERE id = $1`, [req.params.id]
      ),
      pool.query(
        `SELECT * FROM ventes WHERE user_id = $1 ORDER BY date_vente DESC LIMIT 50`,
        [req.params.id]
      ),
      pool.query(
        `SELECT * FROM clients WHERE user_id = $1 ORDER BY nom`,
        [req.params.id]
      ),
      pool.query(
        `SELECT p.semaine,
                SUM(p.objectif) AS objectif_total,
                SUM(p.realise)  AS realise_total
         FROM pilotage p WHERE p.user_id = $1
         GROUP BY p.semaine ORDER BY p.semaine DESC LIMIT 8`,
        [req.params.id]
      ),
      pool.query(
        `SELECT u.id, u.nom, u.email, u.telephone, u.suspended, u.created_at,
                COUNT(DISTINCT v.id) AS nb_ventes,
                COALESCE(SUM(v.montant),0) AS ca_total,
                MAX(v.date_vente) AS derniere_vente
         FROM users u
         LEFT JOIN ventes v ON v.user_id = u.id
         WHERE u.parent_id = $1 AND u.role = 'vendeur'
         GROUP BY u.id ORDER BY u.nom`,
        [req.params.id]
      ),
    ]);
    if (!userR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    res.json({
      user:      userR.rows[0],
      ventes:    ventesR.rows,
      clients:   clientsR.rows,
      pilotage:  pilotageR.rows,
      vendeurs:  vendeursR.rows,
    });
  } catch (err) {
    console.error('admin user detail:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/vendeurs — créer un vendeur pour un rizier
router.post('/users/:id/vendeurs', async (req, res) => {
  try {
    const rizierR = await pool.query(
      `SELECT id, nom FROM users WHERE id=$1 AND role='rizier'`, [req.params.id]
    );
    if (!rizierR.rows.length) return res.status(404).json({ error: 'Rizier non trouvé' });

    const { nom, email, password, telephone } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, telephone, role, parent_id)
       VALUES ($1,$2,$3,$4,'vendeur',$5)
       RETURNING id, nom, email, telephone, role, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash, telephone || null, req.params.id]
    );
    await log(req.userId, req.userNom, 'VENDEUR_CREATED',
              result.rows[0], { rizier: rizierR.rows[0].nom, email }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('admin create vendeur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users — créer un compte rizier
router.post('/users', async (req, res) => {
  try {
    const { nom, email, password, rizerie_id, telephone, ville } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    // Récupère le nom de la rizerie pour le champ texte
    let rizeRieNom = null;
    if (rizerie_id) {
      const rR = await pool.query('SELECT nom FROM rizeries WHERE id=$1', [rizerie_id]);
      if (!rR.rows.length) return res.status(400).json({ error: 'Rizerie introuvable' });
      rizeRieNom = rR.rows[0].nom;
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, rizerie, rizerie_id, telephone, ville)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nom, email, rizerie, rizerie_id, telephone, ville, role, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash,
       rizeRieNom, rizerie_id || null, telephone || null, ville || null]
    );
    await log(req.userId, req.userNom, 'ACCOUNT_CREATED_BY_ADMIN',
              result.rows[0], { email }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('admin create user:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/users/:id — modifier le profil
router.put('/users/:id', async (req, res) => {
  try {
    const { nom, rizerie, telephone, ville, email } = req.body;
    const result = await pool.query(
      `UPDATE users SET nom=$1, email=$2, rizerie=$3, telephone=$4, ville=$5
       WHERE id=$6
       RETURNING id, nom, email, rizerie, telephone, ville, role, suspended`,
      [nom, email || null, rizerie || null, telephone || null, ville || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    await log(req.userId, req.userNom, 'PROFILE_UPDATED',
              result.rows[0], { nom, email }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('admin update user:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/suspend — suspendre ou réactiver
router.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { suspended, reason } = req.body;
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de suspendre son propre compte' });

    const result = await pool.query(
      `UPDATE users
       SET suspended=$1, suspended_reason=$2, suspended_at=$3
       WHERE id=$4
       RETURNING id, nom, email, suspended, suspended_reason`,
      [!!suspended, reason || null, suspended ? new Date() : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    await log(req.userId, req.userNom,
              suspended ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_ACTIVATED',
              result.rows[0], { reason }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('admin suspend:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/password — réinitialiser le mot de passe
router.patch('/users/:id/password', async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });

    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password=$1 WHERE id=$2 RETURNING id, nom, email`,
      [hash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    await log(req.userId, req.userNom, 'PASSWORD_RESET',
              result.rows[0], {}, req.ip);
    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) {
    console.error('admin reset password:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/impersonate — token temporaire pour naviguer comme ce rizier
router.post('/users/:id/impersonate', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, email, rizerie, telephone, ville, role, suspended FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const target = result.rows[0];
    if (target.suspended) return res.status(400).json({ error: 'Impossible d\'accéder à un compte suspendu' });

    // Token courte durée (2h) pour l'impersonation
    const token = jwt.sign(
      { userId: target.id, nom: target.nom, role: 'rizier', impersonatedBy: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    await log(req.userId, req.userNom, 'IMPERSONATION_START', target, {}, req.ip);
    res.json({
      token,
      user: { id: target.id, nom: target.nom, email: target.email, rizerie: target.rizerie, role: 'rizier' },
      impersonatedBy: { id: req.userId, nom: req.userNom }
    });
  } catch (err) {
    console.error('admin impersonate:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/users/:id — supprimer un compte
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });

    const userR = await pool.query(
      'SELECT id, nom, email FROM users WHERE id = $1', [req.params.id]
    );
    if (!userR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    await log(req.userId, req.userNom, 'ACCOUNT_DELETED',
              userR.rows[0], { email: userR.rows[0].email }, req.ip);
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'Compte supprimé définitivement' });
  } catch (err) {
    console.error('admin delete user:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════

// GET /api/admin/audit
router.get('/audit', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action || null;

    let q = 'SELECT * FROM audit_logs';
    const params = [];
    if (action) { q += ' WHERE action = $1'; params.push(action); }
    q += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);

    const [logsR, countR] = await Promise.all([
      pool.query(q, params),
      pool.query('SELECT COUNT(*) FROM audit_logs' + (action ? ' WHERE action=$1' : ''),
                 action ? [action] : []),
    ]);
    res.json({ logs: logsR.rows, total: Number(countR.rows[0].count) });
  } catch (err) {
    console.error('admin audit:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
