const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool, withTransaction, reassignVendeurData } = require('../db/pool');
const logger  = require('../utils/logger');
const { isValidUUID } = require('../middleware/validate');
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const { requireSuperadmin } = isAdmin;

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
    logger.error('audit log error', { err: e.message, stack: e.stack });
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
    logger.error('admin stats', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
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
      SELECT r.id, r.nom, r.pays, r.region, r.ville, r.telephone, r.created_at,
             r.emplois_baseline, r.masse_salariale_baseline, r.ca_baseline, r.baseline_date,
             COUNT(DISTINCT u.id)                    AS nb_comptes,
             COALESCE(SUM(va.ca_total), 0)           AS ca_total,
             COALESCE(SUM(va_cur.ca_annee), 0)       AS ca_annee_courante,
             COALESCE(SUM(va_prev.ca_annee), 0)      AS ca_annee_precedente,
             COALESCE(SUM(ea.nb_emplois), 0)         AS emplois_actuels,
             COALESCE(SUM(ea.masse_salariale), 0)    AS masse_salariale_actuelle
      FROM rizeries r
      LEFT JOIN users u ON u.rizerie_id = r.id AND u.role IN ('rizier','vendeur')
      LEFT JOIN (SELECT user_id, SUM(montant) AS ca_total FROM ventes GROUP BY user_id) va ON va.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(montant) AS ca_annee FROM ventes
        WHERE EXTRACT(YEAR FROM date_vente) = EXTRACT(YEAR FROM NOW())
        GROUP BY user_id
      ) va_cur ON va_cur.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(montant) AS ca_annee FROM ventes
        WHERE EXTRACT(YEAR FROM date_vente) = EXTRACT(YEAR FROM NOW()) - 1
        GROUP BY user_id
      ) va_prev ON va_prev.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS nb_emplois, SUM(salaire) AS masse_salariale FROM emplois GROUP BY user_id) ea ON ea.user_id = u.id
      GROUP BY r.id
      ORDER BY r.nom
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error('GET rizeries', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/rizeries
router.post('/rizeries', async (req, res) => {
  try {
    const { nom, pays, region, ville, telephone, emplois_baseline, masse_salariale_baseline, ca_baseline } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom de la rizerie requis' });
    const exists = await pool.query('SELECT id FROM rizeries WHERE LOWER(nom)=LOWER($1)', [nom.trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Une rizerie avec ce nom existe déjà' });
    const result = await pool.query(
      `INSERT INTO rizeries (nom, pays, region, ville, telephone, emplois_baseline, masse_salariale_baseline, ca_baseline, baseline_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE) RETURNING *`,
      [nom.trim(), pays || null, region || null, ville || null, telephone || null,
       emplois_baseline || 0, masse_salariale_baseline || 0, ca_baseline || 0]
    );
    await log(req.userId, req.userNom, 'RIZERIE_CREATED', result.rows[0], {}, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST rizeries', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/rizeries/:id
router.put('/rizeries/:id', async (req, res) => {
  try {
    const { nom, pays, region, ville, telephone, emplois_baseline, masse_salariale_baseline, ca_baseline } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom requis' });
    const result = await pool.query(
      `UPDATE rizeries SET nom=$1, pays=$2, region=$3, ville=$4, telephone=$5,
         emplois_baseline=$6, masse_salariale_baseline=$7, ca_baseline=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [nom.trim(), pays || null, region || null, ville || null, telephone || null,
       emplois_baseline || 0, masse_salariale_baseline || 0, ca_baseline || 0, req.params.id]
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
    logger.error('admin users list', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/users/:id — profil complet + ventes + clients + équipe vendeurs
router.get('/users/:id', async (req, res) => {
  try {
    const [userR, ventesR, clientsR, pilotageR, vendeursR, managersR] = await Promise.all([
      pool.query(
        `SELECT id, nom, email, rizerie, telephone, ville, role,
                suspended, suspended_reason, suspended_at, must_change_password, created_at
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
        `SELECT u.id, u.nom, u.email, u.telephone, u.suspended, u.created_at, u.parent_id,
                m.nom AS manager_nom,
                COUNT(DISTINCT v.id) AS nb_ventes,
                COALESCE(SUM(v.montant),0) AS ca_total,
                MAX(v.date_vente) AS derniere_vente
         FROM users u
         LEFT JOIN users m ON m.id = u.parent_id AND m.role = 'manager'
         LEFT JOIN ventes v ON v.user_id = u.id
         WHERE u.role = 'vendeur' AND (u.parent_id = $1 OR u.parent_id IN (SELECT id FROM users WHERE parent_id = $1 AND role = 'manager'))
         GROUP BY u.id, m.nom ORDER BY u.nom`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, nom, email, zone, created_at FROM users WHERE parent_id = $1 AND role = 'manager' ORDER BY nom`,
        [req.params.id]
      ),
    ]);
    if (!userR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    res.json({
      user:      userR.rows[0],
      managers:  managersR.rows,
      ventes:    ventesR.rows,
      clients:   clientsR.rows,
      pilotage:  pilotageR.rows,
      vendeurs:  vendeursR.rows,
    });
  } catch (err) {
    logger.error('admin user detail', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Handler partagé : créer un directeur / manager / vendeur rattaché à un rizier.
// Accessible via POST /api/admin/users/:id/membre  (nouvelle route)
//              et  POST /api/admin/users/:id/vendeurs (ancienne route, rétrocompat)
// rizerie_id et rizerie (nom texte) sont automatiquement copiés depuis le rizier.
async function createMembreHandler(req, res) {
  try {
    const rizierR = await pool.query(
      `SELECT u.id, u.nom, u.rizerie_id, r.nom AS rizerie_nom
       FROM users u
       LEFT JOIN rizeries r ON r.id = u.rizerie_id
       WHERE u.id=$1 AND u.role='rizier'`,
      [req.params.id]
    );
    if (!rizierR.rows.length) return res.status(404).json({ error: 'Rizier non trouvé' });
    const rizier = rizierR.rows[0];

    const { nom, email, password, telephone, role, zone, manager_id } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

    const targetRole = ['directeur','manager','vendeur'].includes(role) ? role : 'vendeur';

    if (targetRole === 'directeur' && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut créer un directeur' });

    // Déterminer le parent : un vendeur peut être rattaché à un manager de ce rizier,
    // un manager ou directeur est toujours rattaché directement au rizier.
    let parentId = rizier.id;
    if (targetRole === 'vendeur' && manager_id) {
      const mgrR = await pool.query(
        `SELECT id FROM users WHERE id=$1 AND role='manager'
         AND (parent_id=$2 OR parent_id IN (
           SELECT id FROM users WHERE parent_id=$2 AND role='directeur'
         ))`,
        [manager_id, rizier.id]
      );
      if (!mgrR.rows.length)
        return res.status(400).json({ error: 'Manager invalide ou non rattaché à ce rizier' });
      parentId = manager_id;
    }

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, telephone, role, parent_id, zone, rizerie_id, rizerie)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, nom, email, telephone, role, zone, parent_id, rizerie_id, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash, telephone || null,
       targetRole, parentId, zone || null,
       rizier.rizerie_id || null, rizier.rizerie_nom || null]
    );
    const actionMap = { directeur: 'DIRECTEUR_CREATED', manager: 'MANAGER_CREATED', vendeur: 'VENDEUR_CREATED' };
    await log(req.userId, req.userNom, actionMap[targetRole],
              result.rows[0], { rizier: rizier.nom, email }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('admin create membre', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

router.post('/users/:id/membre',  createMembreHandler);
router.post('/users/:id/vendeurs', createMembreHandler); // rétrocompat

// POST /api/admin/users — créer un compte rizier
router.post('/users', async (req, res) => {
  try {
    const { nom, email, password, rizerie_id, telephone, ville } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

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
    logger.error('admin create user', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/users/:id — modifier le profil
router.put('/users/:id', async (req, res) => {
  try {
    const targetR = await pool.query('SELECT id, nom, role FROM users WHERE id=$1', [req.params.id]);
    if (!targetR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const target = targetR.rows[0];
    if (['superadmin', 'support'].includes(target.role) && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut modifier ce compte' });

    const { nom, rizerie, telephone, ville, email } = req.body;
    const result = await pool.query(
      `UPDATE users SET nom=$1, email=$2, rizerie=$3, telephone=$4, ville=$5
       WHERE id=$6
       RETURNING id, nom, email, rizerie, telephone, ville, role, suspended`,
      [nom, email || null, rizerie || null, telephone || null, ville || null, req.params.id]
    );
    await log(req.userId, req.userNom, 'PROFILE_UPDATED',
              result.rows[0], { nom, email }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('admin update user', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/suspend — suspendre ou réactiver
router.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { suspended, reason } = req.body;
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de suspendre son propre compte' });

    const targetR = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
    if (!targetR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (['superadmin', 'support'].includes(targetR.rows[0].role) && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut suspendre ce compte' });

    const result = await pool.query(
      `UPDATE users
       SET suspended=$1, suspended_reason=$2, suspended_at=$3,
           token_revoked_at = CASE WHEN $1 THEN NOW() ELSE token_revoked_at END
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
    logger.error('admin suspend', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/password — réinitialiser le mot de passe
router.patch('/users/:id/password', async (req, res) => {
  try {
    const targetR = await pool.query('SELECT id, nom, email, role FROM users WHERE id=$1', [req.params.id]);
    if (!targetR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (['superadmin', 'support'].includes(targetR.rows[0].role) && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut réinitialiser ce mot de passe' });

    const { new_password } = req.body;
    if (!new_password || new_password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2 RETURNING id, nom, email`,
      [hash, req.params.id]
    );
    await log(req.userId, req.userNom, 'PASSWORD_RESET',
              result.rows[0], {}, req.ip);
    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) {
    logger.error('admin reset password', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/force-password-change — oblige l'utilisateur à changer
// son mot de passe à sa prochaine connexion (sans que l'admin en choisisse un nouveau).
router.patch('/users/:id/force-password-change', async (req, res) => {
  try {
    const targetR = await pool.query('SELECT id, nom, email, role FROM users WHERE id=$1', [req.params.id]);
    if (!targetR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (['superadmin', 'support'].includes(targetR.rows[0].role) && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut forcer ce changement' });

    const result = await pool.query(
      `UPDATE users SET must_change_password=TRUE WHERE id=$1 RETURNING id, nom, email`,
      [req.params.id]
    );
    await log(req.userId, req.userNom, 'PASSWORD_CHANGE_FORCED',
              result.rows[0], {}, req.ip);
    res.json({ message: 'L\'utilisateur devra changer son mot de passe à sa prochaine connexion' });
  } catch (err) {
    logger.error('admin force password change', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users/:id/impersonate — token temporaire pour naviguer comme ce compte
router.post('/users/:id/impersonate', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, email, rizerie, telephone, ville, role, suspended FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const target = result.rows[0];
    if (['superadmin', 'support'].includes(target.role))
      return res.status(403).json({ error: 'Impossible d\'impersonner un compte superadmin ou support' });
    if (target.suspended) return res.status(400).json({ error: 'Impossible d\'accéder à un compte suspendu' });

    // Le token porte le rôle réel du compte cible : la portée (scope.js) et les redirections
    // frontend restent celles de ce rôle, jamais élargies au périmètre d'un rizier.
    const token = jwt.sign(
      { userId: target.id, nom: target.nom, role: target.role, impersonatedBy: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    await log(req.userId, req.userNom, 'IMPERSONATION_START', target, {}, req.ip);
    res.json({
      token,
      user: { id: target.id, nom: target.nom, email: target.email, rizerie: target.rizerie, role: target.role },
      impersonatedBy: { id: req.userId, nom: req.userNom }
    });
  } catch (err) {
    logger.error('admin impersonate', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/users/:id — supprimer un compte
// Si c'est un vendeur, ses ventes/clients sont rattachés au rizier parent avant suppression
// (au lieu d'être supprimés en cascade) pour ne pas perdre l'historique commercial.
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });

    const userR = await pool.query(
      'SELECT id, nom, email, role, parent_id FROM users WHERE id = $1', [req.params.id]
    );
    if (!userR.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const target = userR.rows[0];

    if (['superadmin', 'support'].includes(target.role) && req.userRole !== 'superadmin')
      return res.status(403).json({ error: 'Seul le superadmin peut supprimer ce compte' });

    await withTransaction(async (client) => {
      if (target.role === 'vendeur' && target.parent_id) {
        await reassignVendeurData(client, target.id, target.parent_id);
      }
      await client.query('DELETE FROM users WHERE id = $1', [target.id]);
    });

    await log(req.userId, req.userNom, 'ACCOUNT_DELETED', target, { email: target.email }, req.ip);
    res.json({ message: 'Compte supprimé définitivement' });
  } catch (err) {
    logger.error('admin delete user', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// COMPTES SUPPORT — accès admin complet, mais seul le vrai superadmin
// peut en créer ou en supprimer (pas un autre compte support).
// ══════════════════════════════════════════════════════════════

// GET /api/admin/support
router.get('/support', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom, email, created_at FROM users WHERE role = 'support' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET support', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/support
router.post('/support', requireSuperadmin, async (req, res) => {
  try {
    const { nom, email, password } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, role)
       VALUES ($1,$2,$3,'support')
       RETURNING id, nom, email, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash]
    );
    await log(req.userId, req.userNom, 'SUPPORT_CREATED', result.rows[0], { email }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST support', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/support/:id — modifier nom / email (+ mot de passe optionnel)
router.put('/support/:id', requireSuperadmin, async (req, res) => {
  try {
    const { nom, email, new_password } = req.body;
    if (!nom?.trim() || !email?.trim())
      return res.status(400).json({ error: 'Nom et email requis' });

    const conflict = await pool.query(
      'SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id!=$2', [email.trim(), req.params.id]
    );
    if (conflict.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    let result;
    if (new_password) {
      if (new_password.length < 12)
        return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });
      const hash = await bcrypt.hash(new_password, 12);
      result = await pool.query(
        `UPDATE users SET nom=$1, email=$2, password=$3
         WHERE id=$4 AND role='support'
         RETURNING id, nom, email, created_at`,
        [nom.trim(), email.toLowerCase().trim(), hash, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET nom=$1, email=$2
         WHERE id=$3 AND role='support'
         RETURNING id, nom, email, created_at`,
        [nom.trim(), email.toLowerCase().trim(), req.params.id]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'Compte support non trouvé' });
    await log(req.userId, req.userNom, 'SUPPORT_UPDATED', result.rows[0], { email }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('PUT support', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/support/:id
router.delete('/support/:id', requireSuperadmin, async (req, res) => {
  try {
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });

    const result = await pool.query(
      `DELETE FROM users WHERE id=$1 AND role='support' RETURNING id, nom, email`
    , [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Compte support non trouvé' });

    await log(req.userId, req.userNom, 'SUPPORT_DELETED', result.rows[0], { email: result.rows[0].email }, req.ip);
    res.json({ message: 'Compte support supprimé' });
  } catch (err) {
    logger.error('DELETE support', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// COMPTES SUPERADMIN — seul un vrai superadmin peut en créer ou en
// supprimer un autre (même restriction que pour les comptes support).
// ══════════════════════════════════════════════════════════════

// GET /api/admin/superadmins
router.get('/superadmins', requireSuperadmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom, email, created_at FROM users WHERE role = 'superadmin' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET superadmins', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/superadmins
router.post('/superadmins', requireSuperadmin, async (req, res) => {
  try {
    const { nom, email, password } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (nom, email, password, role)
       VALUES ($1,$2,$3,'superadmin')
       RETURNING id, nom, email, created_at`,
      [nom.trim(), email.toLowerCase().trim(), hash]
    );
    await log(req.userId, req.userNom, 'SUPERADMIN_CREATED', result.rows[0], { email }, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST superadmins', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/superadmins/:id — modifier nom / email (+ mot de passe optionnel)
router.put('/superadmins/:id', requireSuperadmin, async (req, res) => {
  try {
    const { nom, email, new_password } = req.body;
    if (!nom?.trim() || !email?.trim())
      return res.status(400).json({ error: 'Nom et email requis' });

    const conflict = await pool.query(
      'SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id!=$2', [email.trim(), req.params.id]
    );
    if (conflict.rows.length) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    let result;
    if (new_password) {
      if (new_password.length < 12)
        return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });
      const hash = await bcrypt.hash(new_password, 12);
      result = await pool.query(
        `UPDATE users SET nom=$1, email=$2, password=$3
         WHERE id=$4 AND role='superadmin'
         RETURNING id, nom, email, created_at`,
        [nom.trim(), email.toLowerCase().trim(), hash, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET nom=$1, email=$2
         WHERE id=$3 AND role='superadmin'
         RETURNING id, nom, email, created_at`,
        [nom.trim(), email.toLowerCase().trim(), req.params.id]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'Compte superadmin non trouvé' });
    await log(req.userId, req.userNom, 'SUPERADMIN_UPDATED', result.rows[0], { email }, req.ip);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('PUT superadmins', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/superadmins/:id
router.delete('/superadmins/:id', requireSuperadmin, async (req, res) => {
  try {
    if (req.params.id === req.userId)
      return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });

    const countR = await pool.query(`SELECT COUNT(*) FROM users WHERE role='superadmin'`);
    if (Number(countR.rows[0].count) <= 1)
      return res.status(400).json({ error: 'Impossible : il doit rester au moins un compte superadmin' });

    const result = await pool.query(
      `DELETE FROM users WHERE id=$1 AND role='superadmin' RETURNING id, nom, email`
    , [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Compte superadmin non trouvé' });

    await log(req.userId, req.userNom, 'SUPERADMIN_DELETED', result.rows[0], { email: result.rows[0].email }, req.ip);
    res.json({ message: 'Compte superadmin supprimé' });
  } catch (err) {
    logger.error('DELETE superadmins', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// COMPTES COMMERCIAUX (directeur / manager / vendeur)
// Visibles par le superadmin pour superviser tous les accès créés
// automatiquement depuis la gestion des employés.
// ══════════════════════════════════════════════════════════════

// GET /api/admin/comptes — liste tous les comptes commerciaux par rizerie
router.get('/comptes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nom, u.email, u.role, u.telephone, u.zone,
             u.suspended, u.suspended_at, u.suspended_reason, u.created_at,
             u.rizerie_id, r.nom AS rizerie_nom,
             p.nom AS parent_nom, p.role AS parent_role,
             e.id AS emploi_id, e.poste
      FROM users u
      LEFT JOIN rizeries r ON r.id = u.rizerie_id
      LEFT JOIN users p    ON p.id = u.parent_id
      LEFT JOIN emplois e  ON e.user_account_id = u.id
      WHERE u.role IN ('directeur','manager','vendeur')
      ORDER BY r.nom NULLS LAST, u.role, u.nom
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error('GET comptes', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// EXPORT CSV
// Paramètres :
//   type      : ventes | clients | emplois (défaut : ventes)
//   periode   : semaine | mois | trimestre | semestre | annuel (défaut : mois)
//   annee     : ex. 2025 (défaut : année courante)
//   valeur    : numéro de semaine (1-52), mois (1-12), trimestre (1-4), semestre (1-2)
//               ignoré pour annuel
//   rizerie_id: UUID (optionnel — toutes les rizeries si absent)
// ══════════════════════════════════════════════════════════════

function getDateRange(periode, annee, valeur) {
  const y = parseInt(annee) || new Date().getFullYear();
  const v = parseInt(valeur) || 1;
  switch (periode) {
    case 'semaine': {
      const jan4 = new Date(y, 0, 4);
      const w1Mon = new Date(jan4);
      w1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
      const mon = new Date(w1Mon);
      mon.setDate(w1Mon.getDate() + (v - 1) * 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { debut: mon.toISOString().slice(0,10), fin: sun.toISOString().slice(0,10) };
    }
    case 'mois': {
      const d = new Date(y, v - 1, 1);
      const f = new Date(y, v, 0);
      return { debut: d.toISOString().slice(0,10), fin: f.toISOString().slice(0,10) };
    }
    case 'trimestre': {
      const sm = (v - 1) * 3;
      return { debut: new Date(y, sm, 1).toISOString().slice(0,10),
               fin:   new Date(y, sm + 3, 0).toISOString().slice(0,10) };
    }
    case 'semestre': {
      const sm = (v - 1) * 6;
      return { debut: new Date(y, sm, 1).toISOString().slice(0,10),
               fin:   new Date(y, sm + 6, 0).toISOString().slice(0,10) };
    }
    default:
      return { debut: `${y}-01-01`, fin: `${y}-12-31` };
  }
}

function rowsToCsv(rows, cols) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(';') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))];
  return lines.join('\n') + '\n';
}

// GET /api/admin/export
router.get('/export', async (req, res) => {
  try {
    const { type = 'ventes', periode = 'mois', annee, valeur, rizerie_id } = req.query;
    if (rizerie_id && !isValidUUID(rizerie_id))
      return res.status(400).json({ error: 'rizerie_id invalide (UUID attendu)' });
    const { debut, fin } = getDateRange(periode, annee, valeur);

    // Tous les paramètres passent par des placeholders — jamais d'interpolation de chaîne.
    const params = rizerie_id ? [debut, fin, rizerie_id] : [debut, fin];
    const rFilter = rizerie_id ? `AND u.rizerie_id = $3::uuid` : '';

    let csv = '';
    let filename = '';

    if (type === 'emplois') {
      const q = await pool.query(`
        SELECT e.nom, e.poste, e.type_contrat, e.date_embauche, e.salaire, e.telephone,
               u.nom AS responsable, r.nom AS rizerie, e.note, e.created_at
        FROM emplois e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN rizeries r ON r.id = u.rizerie_id
        WHERE e.created_at::date BETWEEN $1 AND $2 ${rFilter}
        ORDER BY r.nom, e.nom
      `, params);
      csv = rowsToCsv(q.rows, ['nom','poste','type_contrat','date_embauche','salaire',
                                'telephone','responsable','rizerie','note','created_at']);
      filename = `emplois_${debut}_${fin}.csv`;

    } else if (type === 'clients') {
      const q = await pool.query(`
        SELECT c.nom, c.type, c.statut, c.zone, c.region, c.segment,
               c.telephone, c.potentiel_annuel, c.volume_estime, c.frequence,
               u.nom AS commercial, r.nom AS rizerie, c.note, c.created_at
        FROM clients c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN rizeries r ON r.id = u.rizerie_id
        WHERE c.created_at::date BETWEEN $1 AND $2 ${rFilter}
        ORDER BY r.nom, c.nom
      `, params);
      csv = rowsToCsv(q.rows, ['nom','type','statut','zone','region','segment','telephone',
                                'potentiel_annuel','volume_estime','frequence','commercial',
                                'rizerie','note','created_at']);
      filename = `clients_${debut}_${fin}.csv`;

    } else {
      const q = await pool.query(`
        SELECT v.numero, v.date_vente, v.client_nom, v.produit,
               v.quantite, v.prix_unitaire, v.montant, v.cout_unitaire,
               ROUND(v.quantite * COALESCE(NULLIF(v.cout_unitaire,0),0), 2) AS cout_total,
               ROUND(v.montant - v.quantite * COALESCE(NULLIF(v.cout_unitaire,0),0), 2) AS marge,
               v.statut_paiement, v.mode, v.date_echeance,
               COALESCE((SELECT SUM(vs.montant) FROM versements vs WHERE vs.vente_id = v.id), 0) AS total_verse,
               u.nom AS commercial, u.role AS role_commercial,
               p.nom AS manager, r.nom AS rizerie, v.note, v.created_at
        FROM ventes v
        JOIN users u ON u.id = v.user_id
        LEFT JOIN users p ON p.id = u.parent_id AND p.role IN ('manager','directeur','rizier')
        LEFT JOIN rizeries r ON r.id = u.rizerie_id
        WHERE v.date_vente BETWEEN $1 AND $2 ${rFilter}
        ORDER BY r.nom, v.date_vente DESC
      `, params);
      csv = rowsToCsv(q.rows, ['numero','date_vente','client_nom','produit','quantite',
                                'prix_unitaire','montant','cout_unitaire','cout_total','marge',
                                'statut_paiement','mode','date_echeance','total_verse',
                                'commercial','role_commercial','manager','rizerie','note','created_at']);
      filename = `ventes_${debut}_${fin}.csv`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM UTF-8 pour Excel
  } catch (err) {
    logger.error('GET export', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// CONNEXIONS — statistiques de connexion à la plateforme
// ══════════════════════════════════════════════════════════════

// GET /api/admin/connexions
router.get('/connexions', async (req, res) => {
  try {
    const [parJourR, recentsR, kpiR] = await Promise.all([
      // Connexions par jour sur les 30 derniers jours
      pool.query(`
        SELECT
          created_at::date                    AS date,
          COUNT(*)::int                       AS nb_connexions,
          COUNT(DISTINCT actor_id)::int       AS nb_utilisateurs
        FROM audit_logs
        WHERE action = 'LOGIN_SUCCESS'
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY created_at::date
        ORDER BY date
      `),
      // 100 dernières connexions avec détails utilisateur
      pool.query(`
        SELECT
          al.created_at,
          al.target_id   AS actor_id,
          al.target_nom  AS actor_nom,
          al.ip,
          u.role,
          u.rizerie,
          r.pays
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.target_id
        LEFT JOIN rizeries r ON r.id = u.rizerie_id
        WHERE al.action = 'LOGIN_SUCCESS'
        ORDER BY al.created_at DESC
        LIMIT 100
      `),
      // KPIs rapides
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int             AS aujourd_hui,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW()))::int      AS cette_semaine,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int     AS ce_mois,
          COUNT(DISTINCT actor_id) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS uniques_aujourd_hui
        FROM audit_logs
        WHERE action = 'LOGIN_SUCCESS'
      `),
    ]);

    res.json({
      kpi:      kpiR.rows[0],
      parJour:  parJourR.rows,
      recents:  recentsR.rows,
    });
  } catch (err) {
    logger.error('GET connexions', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
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
    const date   = req.query.date || null; // YYYY-MM-DD, jour unique

    const conditions = [];
    const params = [];
    if (action) { conditions.push(`action = $${params.length + 1}`); params.push(action); }
    if (date)   { conditions.push(`created_at::date = $${params.length + 1}`); params.push(date); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    let q = `SELECT * FROM audit_logs${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const listParams = [...params, limit, offset];

    const [logsR, countR] = await Promise.all([
      pool.query(q, listParams),
      pool.query(`SELECT COUNT(*) FROM audit_logs${where}`, params),
    ]);
    res.json({ logs: logsR.rows, total: Number(countR.rows[0].count) });
  } catch (err) {
    logger.error('admin audit', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// PERFORMANCE & IMPACT RIZAO
// ══════════════════════════════════════════════════════════════

// GET /api/admin/performance
router.get('/performance', async (req, res) => {
  try {
    const [globalR, mensuelR, parRizerieR, baselines, contratsR, emploisR] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(v.montant), 0)                                               AS ca_app,
          COUNT(DISTINCT v.id)                                                       AS nb_ventes,
          COUNT(DISTINCT v.client_nom)                                               AS nb_clients,
          COUNT(DISTINCT v.id) FILTER (WHERE v.statut_paiement = 'Paye')            AS nb_paye,
          COUNT(DISTINCT v.id) FILTER (WHERE v.statut_paiement = 'En cours')        AS nb_en_cours,
          COUNT(DISTINCT v.id) FILTER (WHERE v.statut_paiement = 'En retard')       AS nb_retard,
          COALESCE(SUM(vers.montant), 0)                                             AS total_verse
        FROM ventes v
        LEFT JOIN versements vers ON vers.vente_id = v.id
      `),
      pool.query(`
        SELECT
          TO_CHAR(date_trunc('month', date_vente), 'YYYY-MM') AS mois,
          COALESCE(SUM(montant), 0) AS ca
        FROM ventes
        WHERE date_vente >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY mois
        ORDER BY mois
      `),
      pool.query(`
        SELECT
          r.id, r.nom,
          r.ca_baseline, r.emplois_baseline, r.masse_salariale_baseline,
          COALESCE((
            SELECT SUM(v.montant) FROM ventes v
            JOIN users u ON u.id = v.user_id WHERE u.rizerie_id = r.id
          ), 0) AS ca_app,
          COALESCE((
            SELECT SUM(ver.montant) FROM versements ver
            JOIN ventes v ON v.id = ver.vente_id
            JOIN users u ON u.id = v.user_id WHERE u.rizerie_id = r.id
          ), 0) AS total_verse,
          COALESCE((
            SELECT COUNT(DISTINCT v.id) FROM ventes v
            JOIN users u ON u.id = v.user_id WHERE u.rizerie_id = r.id
          ), 0) AS nb_ventes,
          COALESCE((
            SELECT COUNT(DISTINCT v.client_nom) FROM ventes v
            JOIN users u ON u.id = v.user_id WHERE u.rizerie_id = r.id
          ), 0) AS nb_clients,
          COALESCE((
            SELECT COUNT(*) FROM emplois e
            JOIN users u ON u.id = e.user_id WHERE u.rizerie_id = r.id
            AND (e.periode_rizao = 'Avec RIZAO' OR e.periode_rizao IS NULL)
          ), 0) AS emplois_app
        FROM rizeries r
        ORDER BY r.nom
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(ca_baseline), 0)              AS ca_baseline_total,
          COALESCE(SUM(emplois_baseline), 0)         AS emplois_baseline_total,
          COALESCE(SUM(masse_salariale_baseline), 0) AS masse_salariale_baseline_total
        FROM rizeries
      `),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE statut = 'Actif') AS actifs FROM contrats_clients
      `),
      pool.query(`SELECT COUNT(*) AS nb FROM emplois WHERE periode_rizao = 'Avec RIZAO' OR periode_rizao IS NULL`),
    ]);

    const g = globalR.rows[0];
    const b = baselines.rows[0];
    const ca_app = Number(g.ca_app);
    const taux_recouvrement = ca_app > 0
      ? Math.round(Number(g.total_verse) / ca_app * 100)
      : 0;

    res.json({
      global: {
        ca_app,
        ca_baseline_total:              Number(b.ca_baseline_total),
        nb_ventes:                      Number(g.nb_ventes),
        nb_clients:                     Number(g.nb_clients),
        nb_paye:                        Number(g.nb_paye),
        nb_en_cours:                    Number(g.nb_en_cours),
        nb_retard:                      Number(g.nb_retard),
        taux_recouvrement,
        emplois_baseline_total:         Number(b.emplois_baseline_total),
        emplois_app:                    Number(emploisR.rows[0].nb),
        emplois_total:                  Number(b.emplois_baseline_total) + Number(emploisR.rows[0].nb),
        contrats_actifs:                Number(contratsR.rows[0].actifs),
        masse_salariale_baseline_total: Number(b.masse_salariale_baseline_total),
      },
      mensuel: mensuelR.rows.map(r => ({ mois: r.mois, ca: Number(r.ca) })),
      parRizerie: parRizerieR.rows.map(r => ({
        id:                       r.id,
        nom:                      r.nom,
        ca_baseline:              Number(r.ca_baseline || 0),
        ca_app:                   Number(r.ca_app),
        emplois_baseline:         Number(r.emplois_baseline || 0),
        emplois_app:              Number(r.emplois_app),
        emplois_total:            Number(r.emplois_baseline || 0) + Number(r.emplois_app),
        masse_salariale_baseline: Number(r.masse_salariale_baseline || 0),
        nb_ventes:                Number(r.nb_ventes),
        nb_clients:               Number(r.nb_clients),
        taux_recouvrement:        Number(r.ca_app) > 0
          ? Math.round(Number(r.total_verse) / Number(r.ca_app) * 100)
          : 0,
      })),
    });
  } catch (err) {
    logger.error('admin performance', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
