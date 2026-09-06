const bcrypt = require('bcryptjs');

const ROLES_PLATEFORME = ['vendeur', 'manager', 'directeur'];

// Matrice unique de qui peut créer un compte de quel rôle plateforme. equipe.js (création
// directe d'un commercial) et emplois.js (compte optionnel lié à une fiche RH) créaient
// chacun leur propre variante de cette règle, avec une divergence réelle : emplois.js
// autorisait un directeur à créer un autre directeur, ce qu'equipe.js interdit (réservé au
// rizier). Cette fonction est la seule source de vérité désormais.
function peutCreerRole(actingRole, targetRole) {
  if (targetRole === 'directeur') return ['rizier', 'superadmin'].includes(actingRole);
  if (targetRole === 'manager')   return ['rizier', 'directeur', 'superadmin'].includes(actingRole);
  if (targetRole === 'vendeur')   return ['rizier', 'directeur', 'manager', 'superadmin'].includes(actingRole);
  return false;
}

// Crée un compte utilisateur plateforme (vendeur/manager/directeur), rattaché à la même
// rizerie que le créateur. Point d'entrée unique utilisé par routes/equipe.js et
// routes/emplois.js pour que les deux modules ne fassent pas dériver chacun leur propre
// logique de création de compte (validation, unicité d'email, propagation rizerie...).
// `queryable` est soit `pool`, soit un client de transaction (`withTransaction`).
async function createComptePlateforme(queryable, { nom, email, password, role, telephone, zone, parentId, creatorId }) {
  if (!ROLES_PLATEFORME.includes(role)) {
    throw Object.assign(new Error('Rôle plateforme invalide (vendeur, manager, directeur)'), { status: 400 });
  }
  if (!nom?.trim() || !email || !password) {
    throw Object.assign(new Error('Nom, email et mot de passe requis'), { status: 400 });
  }
  if (password.length < 12) {
    throw Object.assign(new Error('Mot de passe : 12 caractères minimum'), { status: 400 });
  }

  const emailNorm = email.toLowerCase().trim();
  const exists = await queryable.query('SELECT id FROM users WHERE email=$1', [emailNorm]);
  if (exists.rows.length) {
    throw Object.assign(new Error('Cet email est déjà utilisé'), { status: 409 });
  }

  const creatorR = await queryable.query('SELECT rizerie_id, rizerie FROM users WHERE id=$1', [creatorId]);
  const creator = creatorR.rows[0] || {};

  const hash = await bcrypt.hash(password, 12);
  const result = await queryable.query(
    `INSERT INTO users (nom, email, password, telephone, role, parent_id, zone, rizerie_id, rizerie, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)
     RETURNING id, nom, email, telephone, role, zone, parent_id, rizerie_id, created_at`,
    [nom.trim(), emailNorm, hash, telephone || null, role, parentId || creatorId, zone || null,
     creator.rizerie_id || null, creator.rizerie || null]
  );
  return result.rows[0];
}

// Indique si la rizerie a au moins un compte comptable actif (non suspendu). Utilisé pour
// décider si un nouvel encaissement doit passer par le workflow déclaré → validé (voir
// utils/versements.js) : tant qu'aucune rizerie n'a de comptable, on ne change rien au
// comportement existant (validation automatique immédiate).
async function hasComptableActif(queryable, rizerieId) {
  if (!rizerieId) return false;
  const r = await queryable.query(
    `SELECT 1 FROM users WHERE rizerie_id=$1 AND role='comptable' AND suspended=FALSE LIMIT 1`,
    [rizerieId]
  );
  return r.rows.length > 0;
}

module.exports = { ROLES_PLATEFORME, peutCreerRole, createComptePlateforme, hasComptableActif };
