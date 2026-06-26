// Source de vérité des autorisations. Toute vérification de rôle passe par ici.
const VALID_ROLES = new Set(['vendeur', 'manager', 'directeur', 'rizier', 'support', 'superadmin']);

// Matrice role × action. Ajouter ici pour étendre, jamais dans les routes.
const PERMISSIONS = {
  'ventes:delete':    ['manager', 'directeur', 'rizier', 'support', 'superadmin'],
  'ventes:versement': ['manager', 'directeur', 'rizier', 'support', 'superadmin'],
  'ventes:statut':    ['manager', 'directeur', 'rizier', 'support', 'superadmin'],
  'pilotage:access':  ['manager', 'directeur', 'rizier'],
};

/**
 * Middleware : autorise uniquement les rôles listés dans PERMISSIONS[action].
 * Usage : router.delete('/:id', requirePerm('ventes:delete'), handler)
 */
function requirePerm(action) {
  const allowed = PERMISSIONS[action] || [];
  return (req, res, next) => {
    if (!allowed.includes(req.userRole)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

/**
 * Middleware : autorise les rôles passés en argument (liste ad-hoc).
 * Usage : router.use(requireRole('manager', 'directeur', 'rizier'))
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

module.exports = { VALID_ROLES, PERMISSIONS, requirePerm, requireRole };
