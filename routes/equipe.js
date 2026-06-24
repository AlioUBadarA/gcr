const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool, withTransaction, reassignVendeurData } = require('../db/pool');
const auth    = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');

const router = express.Router();
router.use(auth);

function canManage(req, res, next) {
  if (!['rizier', 'directeur', 'manager', 'superadmin'].includes(req.userRole))
    return res.status(403).json({ error: 'Accès réservé au responsable de rizerie' });
  next();
}

// GET /api/equipe — tous les commerciaux du périmètre (directs + sous chaque manager),
// avec objectif/réalisé/écart/atteinte/projection/marge à l'identique du HTML de référence.
router.get('/', canManage, attachScopeIds, async (req, res) => {
  try {
    const annee = new Date().getFullYear();
    const monthsElapsed = new Date().getMonth() + 1;

    const [baseR, forecastR] = await Promise.all([
      pool.query(`
        SELECT u.id, u.nom, u.email, u.telephone, u.suspended, u.created_at, u.parent_id,
               m.nom AS manager_nom,
               COUNT(DISTINCT v.id) FILTER (WHERE EXTRACT(YEAR FROM v.date_vente)=$2) AS nb_ventes,
               COUNT(DISTINCT v.client_id)                                            AS nb_clients,
               COALESCE(SUM(v.montant) FILTER (WHERE EXTRACT(YEAR FROM v.date_vente)=$2), 0) AS ca_ytd,
               COALESCE(SUM(v.quantite*COALESCE(NULLIF(v.cout_unitaire,0),0)) FILTER (WHERE EXTRACT(YEAR FROM v.date_vente)=$2), 0) AS cout_ytd,
               COALESCE(SUM(v.montant) FILTER (WHERE v.statut_paiement != 'Paye'), 0) AS creances,
               MAX(v.date_vente) AS derniere_vente
        FROM users u
        LEFT JOIN users m ON m.id = u.parent_id AND m.role = 'manager'
        LEFT JOIN ventes v ON v.user_id = u.id
        WHERE u.id = ANY($1::uuid[]) AND u.role IN ('vendeur','manager','directeur')
        GROUP BY u.id, m.nom
        ORDER BY u.nom
      `, [req.scopeIds, annee]),
      pool.query(`
        SELECT user_id, COALESCE(SUM(objectif_montant),0) AS obj
        FROM forecast WHERE user_id = ANY($1::uuid[]) AND annee=$2
        GROUP BY user_id
      `, [req.scopeIds, annee]),
    ]);

    const objMap = {}; forecastR.rows.forEach(r => { objMap[r.user_id] = +r.obj; });

    const result = baseR.rows.map(r => {
      const ca = +r.ca_ytd;
      const cout = +r.cout_ytd;
      const objAnnuel = objMap[r.id] || 0;
      const marge = ca - cout;
      const prorat = objAnnuel / 12 * monthsElapsed;
      const tauxAtteinte = prorat > 0 ? ca / prorat * 100 : 0;
      const forecast = Math.round(ca / monthsElapsed * 12);
      return {
        ...r,
        nb_ventes: +r.nb_ventes, nb_clients: +r.nb_clients, ca_total: ca, creances: +r.creances,
        objectif_mensuel: Math.round(objAnnuel / 12), objectif_annuel: objAnnuel,
        ecart: ca - prorat, taux_atteinte: tauxAtteinte, forecast, marge,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/equipe — créer un directeur (rizier seulement), un manager (rizier/directeur)
//                    ou un vendeur/commercial (rizier/directeur/manager)
router.post('/', canManage, async (req, res) => {
  try {
    const { nom, email, password, telephone, role, zone, manager_id } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });

    const wantsDirecteur = role === 'directeur';
    const wantsManager   = role === 'manager';
    const targetRole     = wantsDirecteur ? 'directeur' : wantsManager ? 'manager' : 'vendeur';

    if (wantsDirecteur && !['rizier','superadmin'].includes(req.userRole))
      return res.status(403).json({ error: 'Seul le rizier peut créer un directeur' });
    if (wantsManager && !['rizier','directeur','superadmin'].includes(req.userRole))
      return res.status(403).json({ error: 'Seul le rizier ou un directeur peut créer un manager' });

    // Détermination du parent_id
    let parentId = req.userId;
    if (!wantsDirecteur && !wantsManager && manager_id) {
      const mgr = await pool.query(
        `SELECT id FROM users WHERE id=$1 AND role='manager'`,
        [manager_id]
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
       targetRole, parentId, zone || null]
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
       WHERE id=$4 AND id = ANY($5::uuid[]) AND role IN ('vendeur','manager','directeur')
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
    if (!new_password || new_password.length < 12)
      return res.status(400).json({ error: 'Mot de passe : 12 caractères minimum' });
    const hash = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password=$1
       WHERE id=$2 AND id = ANY($3::uuid[]) AND role IN ('vendeur','manager','directeur')
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
// suppression, pour ne pas perdre l'historique. Un manager se supprime aussi : ses vendeurs
// sont alors remontés directement sous le rizier.
router.delete('/:id', canManage, attachScopeIds, async (req, res) => {
  try {
    const found = await withTransaction(async (client) => {
      const target = await client.query(
        `SELECT id, role, parent_id FROM users WHERE id=$1 AND id = ANY($2::uuid[]) AND role IN ('vendeur','manager','directeur')`,
        [req.params.id, req.scopeIds]
      );
      if (!target.rows.length) return false;
      const t = target.rows[0];

      if (t.role === 'vendeur') {
        await reassignVendeurData(client, t.id, t.parent_id);
      } else if (t.role === 'directeur' && !['rizier','superadmin'].includes(req.userRole)) {
        throw Object.assign(new Error('Seul le rizier peut supprimer un directeur'), { status: 403 });
      } else if (t.role === 'manager' && !['rizier','directeur','superadmin'].includes(req.userRole)) {
        throw Object.assign(new Error('Seul le rizier ou un directeur peut supprimer un manager'), { status: 403 });
      } else {
        // Remonte managers et vendeurs directs vers le parent du supprimé
        await client.query(
          `UPDATE users SET parent_id=$1 WHERE parent_id=$2 AND role IN ('manager','vendeur','directeur')`,
          [t.parent_id, t.id]
        );
      }
      await client.query('DELETE FROM users WHERE id=$1', [t.id]);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Compte non trouvé' });
    res.json({ message: 'Compte supprimé' });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    console.error('DELETE equipe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
