function isAdmin(req, res, next) {
  if (req.userRole !== 'superadmin' && req.userRole !== 'support') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

// Réservé au vrai superadmin (pas un compte support) — gestion des comptes support eux-mêmes.
function requireSuperadmin(req, res, next) {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Accès réservé au superadmin' });
  }
  next();
}

module.exports = isAdmin;
module.exports.requireSuperadmin = requireSuperadmin;
