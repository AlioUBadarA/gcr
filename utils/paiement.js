// Conditions de paiement structurées pour une vente — doit matcher exactement la contrainte
// CHECK sur ventes.conditions_paiement (gcr/db/pool.js, migrations). Remplace le texte libre
// pour les cas qui doivent alimenter un calcul (échéance par défaut, montant attendu).
const CONDITIONS_PAIEMENT = [
  'Comptant',
  'J+15',
  'J+30',
  '50% comptant / 50% J+15',
  '50% comptant / 50% J+30',
];

const SPLIT_CONDITIONS = new Set(['50% comptant / 50% J+15', '50% comptant / 50% J+30']);

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Échéance par défaut déduite de la condition de paiement, utilisée quand date_echeance
// n'est pas fournie explicitement. Pour une condition fractionnée, c'est l'échéance de la
// dernière tranche (celle qui détermine si la vente passe "en retard").
function echeanceParDefaut(conditionsPaiement, dateVente) {
  switch (conditionsPaiement) {
    case 'Comptant': return addDays(dateVente, 0);
    case 'J+15': return addDays(dateVente, 15);
    case 'J+30': return addDays(dateVente, 30);
    case '50% comptant / 50% J+15': return addDays(dateVente, 15);
    case '50% comptant / 50% J+30': return addDays(dateVente, 30);
    default: return null;
  }
}

// Montant attendu à la prochaine échéance compte tenu de ce qui a déjà été versé. Pour une
// condition à tranche unique, c'est tout le solde restant. Pour une condition fractionnée,
// tant que la première tranche (comptant) n'est pas couverte, c'est elle qui est attendue ;
// au-delà, c'est le solde restant (dernière tranche).
function montantAttenduProchaineEcheance(conditionsPaiement, montant, totalVerse) {
  const solde = Math.max(0, +montant - +totalVerse);
  if (solde <= 0) return 0;
  if (SPLIT_CONDITIONS.has(conditionsPaiement)) {
    const premiereTranche = +montant / 2;
    if (+totalVerse < premiereTranche) return +(premiereTranche - +totalVerse).toFixed(2);
  }
  return solde;
}

module.exports = { CONDITIONS_PAIEMENT, echeanceParDefaut, montantAttenduProchaineEcheance };
