const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { log } = require('../utils/audit');
const { maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds, requirePerm('encaissements:valider'));

const STATUTS_VALIDATION = ['declare', 'valide', 'rejete'];

// GET /api/comptabilite/versements?statut=declare
// File d'attente du comptable : encaissements déclarés par les commerciaux, en attente de
// validation (ou historique si on filtre sur 'valide'/'rejete'). Le scope du comptable
// couvre toute sa rizerie (voir middleware/scope.js), pas seulement une sous-hiérarchie.
router.get('/versements', async (req, res) => {
  try {
    const statut = STATUTS_VALIDATION.includes(req.query.statut) ? req.query.statut : 'declare';
    const ids = req.scopeIds;

    const result = await pool.query(
      `SELECT ver.id, ver.montant, ver.mode, ver.date, ver.statut_validation, ver.motif_rejet,
              ver.valide_at, ver.created_at,
              uval.nom AS valide_par_nom, udec.nom AS declare_par_nom,
              COALESCE(vt.numero, cc.numero, cp.numero,
                       cce.numero || '-' || TO_CHAR(make_date(ce.annee, ce.mois, 1), 'MM/YYYY')) AS numero,
              COALESCE(vt.client_nom, cc.client_nom, cp.producteur_nom, cce.client_nom) AS client_nom,
              CASE
                WHEN vt.id  IS NOT NULL THEN 'vente'
                WHEN ce.id  IS NOT NULL THEN 'echeance'
                WHEN cp.id  IS NOT NULL THEN 'paddy'
                WHEN cc.id  IS NOT NULL THEN 'contrat'
              END AS type
       FROM versements ver
       LEFT JOIN ventes             vt  ON vt.id  = ver.vente_id
       LEFT JOIN contrats_clients   cc  ON cc.id  = ver.contrat_client_id
       LEFT JOIN contrats_paddy     cp  ON cp.id  = ver.contrat_paddy_id
       LEFT JOIN contrat_echeances  ce  ON ce.id  = ver.contrat_echeance_id
       LEFT JOIN contrats_clients   cce ON cce.id = ce.contrat_client_id
       LEFT JOIN users uval ON uval.id = ver.valide_par
       LEFT JOIN users udec ON udec.id = ver.declare_par
       WHERE ver.statut_validation = $2
         AND (vt.user_id = ANY($1::uuid[]) OR cc.user_id = ANY($1::uuid[])
          OR cp.user_id = ANY($1::uuid[]) OR cce.user_id = ANY($1::uuid[]))
       ORDER BY ver.date DESC, ver.created_at DESC
       LIMIT 200`,
      [ids, statut]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET comptabilite versements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifie que le versement ciblé est bien dans le périmètre du comptable et encore 'declare'.
async function findDeclareDansPerimetre(client, id, ids) {
  const r = await client.query(
    `SELECT ver.id, ver.statut_validation, ver.montant,
            COALESCE(vt.user_id, cc.user_id, cp.user_id, cce.user_id) AS owner_user_id,
            COALESCE(vt.numero, cc.numero, cp.numero,
                     cce.numero || '-' || TO_CHAR(make_date(ce.annee, ce.mois, 1), 'MM/YYYY')) AS numero
     FROM versements ver
     LEFT JOIN ventes             vt  ON vt.id  = ver.vente_id
     LEFT JOIN contrats_clients   cc  ON cc.id  = ver.contrat_client_id
     LEFT JOIN contrats_paddy     cp  ON cp.id  = ver.contrat_paddy_id
     LEFT JOIN contrat_echeances  ce  ON ce.id  = ver.contrat_echeance_id
     LEFT JOIN contrats_clients   cce ON cce.id = ce.contrat_client_id
     WHERE ver.id=$1
       AND (vt.user_id = ANY($2::uuid[]) OR cc.user_id = ANY($2::uuid[])
        OR cp.user_id = ANY($2::uuid[]) OR cce.user_id = ANY($2::uuid[]))
     FOR UPDATE OF ver`,
    [id, ids]
  );
  return r.rows[0] || null;
}

// PATCH /api/comptabilite/versements/:id/valider
router.patch('/versements/:id/valider', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await withTransaction(async (client) => {
      const ver = await findDeclareDansPerimetre(client, req.params.id, ids);
      if (!ver) { const e = new Error('Versement non trouvé'); e.status = 404; throw e; }
      if (ver.statut_validation !== 'declare') {
        const e = new Error(`Ce versement est déjà "${ver.statut_validation}", pas "declare"`);
        e.status = 400; throw e;
      }
      const r = await client.query(
        `UPDATE versements SET statut_validation='valide', valide_par=$1, valide_at=NOW()
         WHERE id=$2 RETURNING *`,
        [req.userId, req.params.id]
      );
      return r.rows[0];
    });
    await log(req.userId, req.userNom, 'VERSEMENT_VALIDE', { id: result.id, nom: result.numero }, { montant: result.montant }, req.ip);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('PATCH comptabilite valider', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/comptabilite/versements/:id/rejeter
router.patch('/versements/:id/rejeter', async (req, res) => {
  try {
    const { motif } = req.body;
    if (!motif?.trim()) return res.status(400).json({ error: 'Motif de rejet requis' });
    if (!maxLen(motif, 500)) return res.status(400).json({ error: 'motif trop long (500 caracteres max)' });

    const ids = req.scopeIds;
    const result = await withTransaction(async (client) => {
      const ver = await findDeclareDansPerimetre(client, req.params.id, ids);
      if (!ver) { const e = new Error('Versement non trouvé'); e.status = 404; throw e; }
      if (ver.statut_validation !== 'declare') {
        const e = new Error(`Ce versement est déjà "${ver.statut_validation}", pas "declare"`);
        e.status = 400; throw e;
      }
      const r = await client.query(
        `UPDATE versements SET statut_validation='rejete', valide_par=$1, valide_at=NOW(), motif_rejet=$2
         WHERE id=$3 RETURNING *`,
        [req.userId, motif.trim(), req.params.id]
      );
      return r.rows[0];
    });
    await log(req.userId, req.userNom, 'VERSEMENT_REJETE', { id: result.id, nom: result.numero }, { montant: result.montant, motif: motif.trim() }, req.ip);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('PATCH comptabilite rejeter', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
