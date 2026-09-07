const { hasComptableActif } = require('./comptes');

// Enregistre un versement plafonné au montant restant dû, et recalcule le statut de
// paiement de la table cible si `statutTable` est fourni (les contrats paddy n'ont pas de
// colonne statut_paiement, voir routes/encaissements.js). Doit être appelé à l'intérieur
// d'une transaction où la ligne cible est déjà verrouillée (FOR UPDATE) par l'appelant, pour
// empêcher deux versements concurrents de dépasser le montant dû.
//
// Centralise une logique auparavant dupliquée à l'identique entre routes/ventes.js
// (POST /:id/versements) et routes/encaissements.js (POST /vente/:id/versements).
//
// `ownerUserId` (le titulaire du compte propriétaire de la vente/l'échéance/le contrat) sert
// à déterminer si la rizerie a un comptable actif : si oui, le versement est déclaré et
// attend une validation comptable ; sinon, il est validé automatiquement (comportement
// identique à avant l'existence du rôle comptable — aucune régression pour les rizeries qui
// n'utilisent pas encore ce rôle).
async function enregistrerVersement(client, { column, targetId, montant, mode, date, montantTotal, totalDeja, statutTable, statutActuel, ownerUserId, declaredBy, dateEcheanceColumn, prochaineEcheance }) {
  const restant = montantTotal - totalDeja;
  if (restant <= 0) {
    throw Object.assign(new Error('Déjà entièrement payé'), { status: 400 });
  }
  if (+montant > restant) {
    throw Object.assign(new Error(`Versement excessif : montant maximum autorise est ${restant}`), { status: 400 });
  }

  const ownerR = await client.query('SELECT rizerie_id FROM users WHERE id=$1', [ownerUserId]);
  const rizerieId = ownerR.rows[0]?.rizerie_id || null;
  const comptablePresent = await hasComptableActif(client, rizerieId);
  const statutValidation = comptablePresent ? 'declare' : 'valide';
  const valideAt = comptablePresent ? null : new Date();

  const result = await client.query(
    `INSERT INTO versements (${column}, montant, mode, date, statut_validation, valide_at, declare_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [targetId, +montant, mode || null, date || new Date().toISOString().slice(0, 10), statutValidation, valideAt, declaredBy || null]
  );

  if (statutTable) {
    const newTotal = totalDeja + +montant;
    let newStatut = null;
    if (newTotal >= montantTotal) {
      newStatut = 'Paye';
    } else if (!['En cours', 'Paye'].includes(statutActuel)) {
      newStatut = 'En cours';
    }
    if (newStatut) {
      await client.query(`UPDATE ${statutTable} SET statut_paiement=$1 WHERE id=$2`, [newStatut, targetId]);
    }

    // Il reste un solde après cette tranche : la prochaine date de paiement attendue,
    // saisie par le commercial, remplace l'ancienne échéance (sinon elle resterait figée sur
    // la date fixée à la création, sans jamais refléter le nouvel accord avec le client).
    if (dateEcheanceColumn && prochaineEcheance && newTotal < montantTotal) {
      await client.query(`UPDATE ${statutTable} SET ${dateEcheanceColumn}=$1 WHERE id=$2`, [prochaineEcheance, targetId]);
    }
  }
  return result.rows[0];
}

module.exports = { enregistrerVersement };
