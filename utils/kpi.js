// Calculs KPI partagés entre plusieurs routes (dashboard, forecast) pour éviter que la
// même formule soit réécrite indépendamment à plusieurs endroits et diverge silencieusement
// au fil des corrections futures.

// Projection de CA annuel au rythme moyen observé depuis le début de l'année : CA réalisé
// depuis le 1er janvier, ramené à une moyenne mensuelle, étalé sur 12 mois.
function projectionAnnuelle(realiseYTD, monthsElapsed) {
  if (!monthsElapsed) return 0;
  return Math.round(realiseYTD / monthsElapsed * 12);
}

// Objectif annuel ramené au nombre de mois déjà écoulés (« combien devrait-on avoir fait à
// date si l'objectif était atteint au rythme régulier »), utilisé comme dénominateur du taux
// d'atteinte réel (CA YTD / objectif prorata).
function objectifProrata(objectifAnnuel, monthsElapsed) {
  return objectifAnnuel / 12 * monthsElapsed;
}

// Taux d'atteinte réel à date : CA réalisé YTD rapporté à l'objectif prorata du même nombre
// de mois. Renvoie 0 si l'objectif prorata est nul (pas d'objectif défini).
function tauxAtteinte(realiseYTD, objectifAnnuel, monthsElapsed) {
  const prorat = objectifProrata(objectifAnnuel, monthsElapsed);
  return prorat > 0 ? realiseYTD / prorat * 100 : 0;
}

// Coût estimé quand cout_unitaire n'est pas renseigné sur une vente : % du CA appliqué par
// défaut, identique au slider de la page Rentabilité (Rentabilite.jsx) et à la formule
// COUT_LIGNE de rentabilite.js. Réutilisé par dashboard.js, equipe.js et managers.js pour que
// la marge nette affichée ne soit jamais structurellement optimiste dans un seul de ces écrans.
const COUT_FALLBACK_PCT = 70;

module.exports = { projectionAnnuelle, objectifProrata, tauxAtteinte, COUT_FALLBACK_PCT };
