const bcrypt = require('bcryptjs');

// Comptable n'est pas un rôle de la hiérarchie commerciale (pas de parent_id, scope par
// rizerie — voir middleware/scope.js) mais reste un rôle "affectable" à un employé RH.
const ROLES_PLATEFORME = ['vendeur', 'manager', 'directeur', 'comptable'];

// Matrice unique de qui peut créer un compte de quel rôle plateforme. equipe.js (création
// directe d'un commercial) et emplois.js (compte optionnel lié à une fiche RH) créaient
// chacun leur propre variante de cette règle, avec une divergence réelle : emplois.js
// autorisait un directeur à créer un autre directeur, ce qu'equipe.js interdit (réservé au
// rizier). Cette fonction est la seule source de vérité désormais.
function peutCreerRole(actingRole, targetRole) {
  if (targetRole === 'directeur') return ['rizier', 'superadmin'].includes(actingRole);
  if (targetRole === 'manager')   return ['rizier', 'directeur', 'superadmin'].includes(actingRole);
  if (targetRole === 'vendeur')   return ['rizier', 'directeur', 'manager', 'superadmin'].includes(actingRole);
  // Comptable est un rôle de confiance transversal à toute la rizerie : réservé au rizier,
  // comme le directeur.
  if (targetRole === 'comptable') return ['rizier', 'superadmin'].includes(actingRole);
  return false;
}

// Normalise email/téléphone pour la création d'un compte et exige qu'au moins l'un des deux
// soit fourni (le téléphone est désormais un identifiant de connexion valide au même titre que
// l'email — voir routes/auth.js). Retourne { emailNorm, telephoneNorm } (chacun `null` si absent).
function normalizeIdentifiants({ email, telephone }) {
  const emailNorm = email?.trim() ? email.toLowerCase().trim() : null;
  const telephoneNorm = telephone?.trim() ? telephone.trim() : null;
  if (!emailNorm && !telephoneNorm) {
    throw Object.assign(new Error('Email ou téléphone requis'), { status: 400 });
  }
  return { emailNorm, telephoneNorm };
}

// Vérifie l'unicité de l'email et du téléphone (requêtes séparées pour un message d'erreur
// précis). `excludeId` permet de réutiliser cette fonction lors d'une modification (exclut le
// compte en cours d'édition de la recherche de doublon).
async function checkIdentifiantsUniques(queryable, { emailNorm, telephoneNorm }, excludeId) {
  if (emailNorm) {
    const exists = excludeId
      ? await queryable.query('SELECT id FROM users WHERE email=$1 AND id!=$2', [emailNorm, excludeId])
      : await queryable.query('SELECT id FROM users WHERE email=$1', [emailNorm]);
    if (exists.rows.length) {
      throw Object.assign(new Error('Cet email est déjà utilisé'), { status: 409 });
    }
  }
  if (telephoneNorm) {
    const exists = excludeId
      ? await queryable.query('SELECT id FROM users WHERE telephone=$1 AND id!=$2', [telephoneNorm, excludeId])
      : await queryable.query('SELECT id FROM users WHERE telephone=$1', [telephoneNorm]);
    if (exists.rows.length) {
      throw Object.assign(new Error('Ce téléphone est déjà utilisé'), { status: 409 });
    }
  }
}

// Crée un compte utilisateur plateforme (vendeur/manager/directeur/comptable), rattaché à la
// même rizerie que le créateur. Point d'entrée unique utilisé par routes/equipe.js et
// routes/emplois.js pour que les deux modules ne fassent pas dériver chacun leur propre
// logique de création de compte (validation, unicité d'email/téléphone, propagation rizerie...).
// `queryable` est soit `pool`, soit un client de transaction (`withTransaction`).
// `parentId` doit être explicitement résolu par l'appelant (null pour un comptable, qui
// n'appartient pas à la hiérarchie parent_id).
async function createComptePlateforme(queryable, { nom, email, password, role, telephone, zone, parentId, creatorId }) {
  if (!ROLES_PLATEFORME.includes(role)) {
    throw Object.assign(new Error('Rôle plateforme invalide (vendeur, manager, directeur, comptable)'), { status: 400 });
  }
  if (!nom?.trim() || !password) {
    throw Object.assign(new Error('Nom et mot de passe requis'), { status: 400 });
  }
  if (password.length < 12) {
    throw Object.assign(new Error('Mot de passe : 12 caractères minimum'), { status: 400 });
  }

  const { emailNorm, telephoneNorm } = normalizeIdentifiants({ email, telephone });
  await checkIdentifiantsUniques(queryable, { emailNorm, telephoneNorm });

  const creatorR = await queryable.query('SELECT rizerie_id, rizerie FROM users WHERE id=$1', [creatorId]);
  const creator = creatorR.rows[0] || {};

  const hash = await bcrypt.hash(password, 12);
  const result = await queryable.query(
    `INSERT INTO users (nom, email, password, telephone, role, parent_id, zone, rizerie_id, rizerie, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)
     RETURNING id, nom, email, telephone, role, zone, parent_id, rizerie_id, created_at`,
    [nom.trim(), emailNorm, hash, telephoneNorm, role, parentId ?? null, zone || null,
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

module.exports = {
  ROLES_PLATEFORME, peutCreerRole, createComptePlateforme, hasComptableActif,
  normalizeIdentifiants, checkIdentifiantsUniques,
};
