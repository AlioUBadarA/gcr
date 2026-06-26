// Helpers de validation partagés — Session 3
// Aucune dépendance externe. Utilisés inline dans les routes.

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE   = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Retourne true si v est un nombre fini strictement > 0
function isPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

// Retourne true si v est un nombre fini >= 0
function isNonNegativeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

// Retourne true si la date est au format YYYY-MM-DD et représente une date valide
function isValidDate(s) {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

// Retourne true si s est un UUID valide
function isValidUUID(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

// Retourne true si la chaîne ne dépasse pas maxChars caractères
function maxLen(s, maxChars) {
  return !s || String(s).length <= maxChars;
}

module.exports = { isPositiveNumber, isNonNegativeNumber, isValidDate, isValidUUID, maxLen };
