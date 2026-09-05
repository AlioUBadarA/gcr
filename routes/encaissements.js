const express = require('express');
const { pool, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { isPositiveNumber, isValidDate } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds);

const MODES = ['Espèces', 'Virement', 'Chèque', 'Mobile Money'];

// GET /api/encaissements/search?q=...  — recherche unifiée par numéro de transaction ou nom client
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const ids = req.scopeIds;
    const like = `%${q}%`;

    const ventesR = await pool.query(
      `SELECT v.id, v.numero, v.client_nom, v.date_vente AS date, v.montant AS montant_total,
              v.produit, v.quantite, v.prix_unitaire, v.date_echeance, v.mode, v.note,
              v.statut_paiement AS statut, COALESCE(ve.total_verse, 0) AS total_verse,
              u.nom AS vendeur_nom
       FROM ventes v
       LEFT JOIN (SELECT vente_id, SUM(montant) AS total_verse FROM versements GROUP BY vente_id) ve ON ve.vente_id = v.id
       LEFT JOIN users u ON u.id = v.user_id
       WHERE v.user_id = ANY($1::uuid[]) AND (v.numero ILIKE $2 OR v.client_nom ILIKE $2)
       ORDER BY v.created_at DESC LIMIT 30`,
      [ids, like]
    );

    // Un contrat récurrent se paie mois par mois : chaque échéance de l'échéancier est une
    // transaction payable à part entière (comme une vente), pas le contrat entier d'un coup.
    const echeancesR = await pool.query(
      `SELECT e.id, cc.numero || '-' || TO_CHAR(make_date(e.annee, e.mois, 1), 'MM/YYYY') AS numero,
              cc.client_nom, e.date_paiement_prevue AS date,
              e.montant AS montant_total, e.annee, e.mois,
              e.statut_paiement AS statut, COALESCE(ve.total_verse, 0) AS total_verse
       FROM contrat_echeances e
       JOIN contrats_clients cc ON cc.id = e.contrat_client_id
       LEFT JOIN (SELECT contrat_echeance_id, SUM(montant) AS total_verse FROM versements GROUP BY contrat_echeance_id) ve
         ON ve.contrat_echeance_id = e.id
       WHERE cc.user_id = ANY($1::uuid[]) AND (cc.numero ILIKE $2 OR cc.client_nom ILIKE $2)
       ORDER BY e.date_paiement_prevue DESC LIMIT 30`,
      [ids, like]
    );

    const results = [
      ...ventesR.rows.map((r) => ({ ...r, type: 'vente' })),
      ...echeancesR.rows.map((r) => ({ ...r, type: 'echeance' })),
    ];
    res.json(results);
  } catch (err) {
    logger.error('GET encaissements/search', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/encaissements/mois — somme de tous les versements encaissés ce mois (scope)
router.get('/mois', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      `SELECT COALESCE(SUM(v.montant), 0) AS total
       FROM versements v
       LEFT JOIN ventes        vt ON vt.id = v.vente_id
       LEFT JOIN contrats_clients cc ON cc.id = v.contrat_client_id
       LEFT JOIN contrats_paddy    cp ON cp.id = v.contrat_paddy_id
       LEFT JOIN contrat_echeances ce ON ce.id = v.contrat_echeance_id
       LEFT JOIN contrats_clients  cce ON cce.id = ce.contrat_client_id
       WHERE DATE_TRUNC('month', v.date::date) = DATE_TRUNC('month', CURRENT_DATE)
         AND (vt.user_id = ANY($1::uuid[]) OR cc.user_id = ANY($1::uuid[]) OR cp.user_id = ANY($1::uuid[]) OR cce.user_id = ANY($1::uuid[]))`,
      [ids]
    );
    res.json({ total: Number(result.rows[0].total) });
  } catch (err) {
    logger.error('GET encaissements/mois', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function targetTable(type) {
  if (type === 'vente')    return { table: 'ventes',           column: 'vente_id' };
  if (type === 'contrat')  return { table: 'contrats_clients', column: 'contrat_client_id' };
  if (type === 'paddy')    return { table: 'contrats_paddy',   column: 'contrat_paddy_id' };
  if (type === 'echeance') return { table: 'contrat_echeances', column: 'contrat_echeance_id' };
  return null;
}

// Vérifie que l'utilisateur a accès à la transaction ciblée et renvoie la ligne si oui.
// Les échéances de contrat n'ont pas de user_id propre : l'appartenance passe par le contrat
// parent (contrats_clients). `queryable` est soit `pool`, soit un client de transaction —
// FOR UPDATE ne verrouille correctement que dans le second cas.
async function findOwnedTarget(queryable, type, id, ids, { forUpdate = false } = {}) {
  const target = targetTable(type);
  if (!target) return null;
  if (type === 'echeance') {
    const r = await queryable.query(
      `SELECT e.* FROM contrat_echeances e JOIN contrats_clients cc ON cc.id = e.contrat_client_id
       WHERE e.id=$1 AND cc.user_id = ANY($2::uuid[])${forUpdate ? ' FOR UPDATE OF e' : ''}`,
      [id, ids]
    );
    return r.rows[0] || null;
  }
  const r = await queryable.query(
    `SELECT * FROM ${target.table} WHERE id=$1 AND user_id = ANY($2::uuid[])${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, ids]
  );
  return r.rows[0] || null;
}

// GET /api/encaissements/:type/:id/versements — historique des tranches
router.get('/:type/:id/versements', async (req, res) => {
  try {
    const target = targetTable(req.params.type);
    if (!target) return res.status(400).json({ error: 'Type invalide' });
    const ids = req.scopeIds;

    const owns = await findOwnedTarget(pool, req.params.type, req.params.id, ids);
    if (!owns) return res.status(404).json({ error: 'Transaction non trouvee' });

    const result = await pool.query(
      `SELECT * FROM versements WHERE ${target.column}=$1 ORDER BY date DESC, created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET encaissements versements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/encaissements/:type/:id/versements — enregistrer une tranche
router.post('/:type/:id/versements', requirePerm('encaissements:versement'), async (req, res) => {
  try {
    const target = targetTable(req.params.type);
    if (!target) return res.status(400).json({ error: 'Type invalide' });
    const { montant, mode, date } = req.body;
    if (!isPositiveNumber(montant)) return res.status(400).json({ error: 'montant doit etre un nombre positif' });
    if (mode && !MODES.includes(mode)) return res.status(400).json({ error: 'Mode de paiement invalide' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'date invalide (format YYYY-MM-DD attendu)' });

    const ids = req.scopeIds;

    // Ventes et échéances de contrat : transaction avec verrou pour éviter les race conditions
    // (deux encaissements concurrents qui dépasseraient le montant dû), plafond au montant
    // restant, et mise à jour automatique du statut de paiement.
    if (['vente', 'echeance'].includes(req.params.type)) {
      const statutTable = req.params.type === 'vente' ? 'ventes' : 'contrat_echeances';
      const versement = await withTransaction(async (client) => {
        const row = await findOwnedTarget(client, req.params.type, req.params.id, ids, { forUpdate: true });
        if (!row) { const e = new Error('Transaction non trouvee'); e.status = 404; throw e; }

        const totalDejaR = await client.query(
          `SELECT COALESCE(SUM(montant),0) AS total FROM versements WHERE ${target.column}=$1`, [req.params.id]
        );
        const totalDeja = +totalDejaR.rows[0].total;
        const restant   = +row.montant - totalDeja;

        if (restant <= 0) { const e = new Error('Déjà entièrement payé'); e.status = 400; throw e; }
        if (+montant > restant) {
          const e = new Error(`Versement excessif : montant maximum autorise est ${restant}`);
          e.status = 400; throw e;
        }

        const result = await client.query(
          `INSERT INTO versements (${target.column}, montant, mode, date) VALUES ($1,$2,$3,$4) RETURNING *`,
          [req.params.id, +montant, mode || null, date || new Date().toISOString().slice(0, 10)]
        );

        const newTotal = totalDeja + +montant;
        let newStatut = null;
        if (newTotal >= +row.montant) {
          newStatut = 'Paye';
        } else if (!['En cours', 'Paye'].includes(row.statut_paiement)) {
          newStatut = 'En cours';
        }
        if (newStatut) {
          await client.query(`UPDATE ${statutTable} SET statut_paiement=$1 WHERE id=$2`, [newStatut, req.params.id]);
        }
        return result.rows[0];
      });
      return res.status(201).json(versement);
    }

    // Contrat (ancien modèle, conservé pour compat) et paddy : pas de plafond ni de statut.
    const owns = await findOwnedTarget(pool, req.params.type, req.params.id, ids);
    if (!owns) return res.status(404).json({ error: 'Transaction non trouvee' });

    const result = await pool.query(
      `INSERT INTO versements (${target.column}, montant, mode, date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, +montant, mode || null, date || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('POST encaissements versements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/encaissements/versements/:id — annuler un versement et recalculer le statut
// Mêmes droits que la création (encaissements:versement).
router.delete('/versements/:id', requirePerm('encaissements:versement'), async (req, res) => {
  try {
    const ids = req.scopeIds;

    await withTransaction(async (client) => {
      // Récupère le versement et vérifie l'appartenance via la vente, le contrat, le paddy
      // ou l'échéance de contrat (celle-ci passe par contrats_clients, sans user_id propre).
      const verR = await client.query(
        `SELECT v.*, vt.user_id AS vente_user_id, cc.user_id AS contrat_user_id,
                cp.user_id AS paddy_user_id, cce.user_id AS echeance_user_id
         FROM versements v
         LEFT JOIN ventes            vt  ON vt.id  = v.vente_id
         LEFT JOIN contrats_clients  cc  ON cc.id  = v.contrat_client_id
         LEFT JOIN contrats_paddy    cp  ON cp.id  = v.contrat_paddy_id
         LEFT JOIN contrat_echeances ce  ON ce.id  = v.contrat_echeance_id
         LEFT JOIN contrats_clients  cce ON cce.id = ce.contrat_client_id
         WHERE v.id = $1`,
        [req.params.id]
      );
      if (!verR.rows.length) { const e = new Error('Versement non trouvé'); e.status = 404; throw e; }
      const ver = verR.rows[0];

      const ownerId = ver.vente_user_id || ver.contrat_user_id || ver.paddy_user_id || ver.echeance_user_id;
      const idsSet = new Set(ids.map(String));
      if (!ownerId || !idsSet.has(String(ownerId))) {
        const e = new Error('Versement non trouvé'); e.status = 404; throw e;
      }

      await client.query('DELETE FROM versements WHERE id=$1', [req.params.id]);

      // Recalcul du statut pour les versements liés à une vente ou à une échéance de contrat.
      // 'En cours' (pas 'Non payé', valeur interdite par la contrainte CHECK) est bien le
      // statut initial des deux tables quand plus rien n'est payé.
      const cible = ver.vente_id
        ? { table: 'ventes', column: 'vente_id', id: ver.vente_id }
        : ver.contrat_echeance_id
        ? { table: 'contrat_echeances', column: 'contrat_echeance_id', id: ver.contrat_echeance_id }
        : null;

      if (cible) {
        const rowR = await client.query(`SELECT * FROM ${cible.table} WHERE id=$1 FOR UPDATE`, [cible.id]);
        if (rowR.rows.length) {
          const row = rowR.rows[0];
          const totalR = await client.query(
            `SELECT COALESCE(SUM(montant),0) AS total FROM versements WHERE ${cible.column}=$1`, [cible.id]
          );
          const total = +totalR.rows[0].total;
          // 'En cours' que le total retombe à 0 ou reste partiel — 'Non payé' n'est pas une
          // valeur autorisée par la contrainte CHECK (voir schema.sql).
          const newStatut = total >= +row.montant ? 'Paye' : 'En cours';
          if (newStatut !== row.statut_paiement) {
            await client.query(`UPDATE ${cible.table} SET statut_paiement=$1 WHERE id=$2`, [newStatut, cible.id]);
          }
        }
      }
    });

    res.json({ message: 'Versement supprimé' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('DELETE versements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
