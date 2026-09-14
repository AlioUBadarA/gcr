const express = require('express');
const { pool, nextNumero, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { requirePerm } = require('../middleware/permissions');
const { findOrCreateClient } = require('./clients');
const { isPositiveNumber, isValidDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds);

const STATUTS = ['En cours', 'Clôturé'];
const TYPES_MOUVEMENT = ['vente', 'retour'];

// Ajoute les quantités écoulées/retournées, le solde restant chez le distributeur et le
// montant dû (quantités vendues déclarées × prix unitaire) à chaque ligne. Le montant dû n'est
// pas stocké : il varie à chaque nouveau rapport de vente du distributeur (voir
// POST /:id/mouvements), contrairement au montant figé d'une vente classique.
function withCalculs(rows) {
  return rows.map((r) => {
    const vendue = Number(r.quantite_vendue || 0);
    const retournee = Number(r.quantite_retournee || 0);
    const montantDu = vendue * Number(r.prix_unitaire);
    return {
      ...r,
      quantite_vendue: vendue,
      quantite_retournee: retournee,
      solde_restant: Math.max(0, Number(r.quantite_deposee) - vendue - retournee),
      montant_du: montantDu,
      montant_restant: Math.max(0, montantDu - Number(r.total_verse || 0)),
    };
  });
}

const JOINS_CALCULS = `
  LEFT JOIN (SELECT depot_vente_id, SUM(quantite) AS qv FROM depot_mouvements WHERE type='vente'  GROUP BY depot_vente_id) mv ON mv.depot_vente_id = d.id
  LEFT JOIN (SELECT depot_vente_id, SUM(quantite) AS qr FROM depot_mouvements WHERE type='retour' GROUP BY depot_vente_id) mr ON mr.depot_vente_id = d.id
  LEFT JOIN (SELECT depot_vente_id, SUM(montant)  AS total_verse FROM versements WHERE statut_validation != 'rejete' GROUP BY depot_vente_id) ve ON ve.depot_vente_id = d.id
`;
const SELECT_CALCULS = `COALESCE(mv.qv, 0) AS quantite_vendue, COALESCE(mr.qr, 0) AS quantite_retournee, COALESCE(ve.total_verse, 0) AS total_verse`;

// GET /api/depots
router.get('/', async (req, res) => {
  try {
    const { statut, client_id } = req.query;
    const ids = req.scopeIds;
    let q = `SELECT d.*, u.nom AS vendeur_nom, ${SELECT_CALCULS}
             FROM depots_vente d
             LEFT JOIN users u ON u.id = d.user_id
             ${JOINS_CALCULS}
             WHERE d.user_id = ANY($1::uuid[])`;
    const params = [ids];
    if (statut && STATUTS.includes(statut)) {
      q += ` AND d.statut = $${params.length + 1}`; params.push(statut);
    }
    if (client_id) {
      q += ` AND d.client_id = $${params.length + 1}`; params.push(client_id);
    }
    q += ' ORDER BY d.date_depot DESC, d.created_at DESC';
    const result = await pool.query(q, params);
    res.json(withCalculs(result.rows));
  } catch (err) {
    logger.error('GET depots', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/depots
router.post('/', async (req, res) => {
  try {
    const { client_id, client_nom, produit, quantite_deposee, prix_unitaire, date_depot, note, telephone } = req.body;
    if (!client_nom || !produit || !quantite_deposee || !prix_unitaire || !date_depot)
      return res.status(400).json({ error: 'Champs requis : client_nom, produit, quantite_deposee, prix_unitaire, date_depot' });
    if (!isPositiveNumber(quantite_deposee))
      return res.status(400).json({ error: 'quantite_deposee doit etre un nombre positif' });
    if (!isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (!isValidDate(date_depot))
      return res.status(400).json({ error: 'date_depot invalide (format YYYY-MM-DD attendu)' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(produit, 200))    return res.status(400).json({ error: 'produit trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    let resolvedClientId = client_id || null;
    if (!resolvedClientId) {
      const client = await findOrCreateClient(req.userId, client_nom, telephone);
      resolvedClientId = client.id;
    } else {
      await pool.query(
        "UPDATE clients SET statut='Actif' WHERE id=$1 AND user_id=$2 AND statut='Prospect'",
        [client_id, req.userId]
      );
    }

    const numero = await nextNumero('depots_vente', 'DV', req.userId);
    const result = await pool.query(
      `INSERT INTO depots_vente (user_id, client_id, client_nom, produit, quantite_deposee, prix_unitaire, date_depot, note, numero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.userId, resolvedClientId, client_nom.trim(), produit, +quantite_deposee, +prix_unitaire, date_depot, note || null, numero]
    );
    res.status(201).json(withCalculs(result.rows)[0]);
  } catch (err) {
    logger.error('POST depots', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/depots/:id
router.get('/:id', async (req, res) => {
  try {
    const ids = req.scopeIds;
    const [depotR, movR] = await Promise.all([
      pool.query(
        `SELECT d.*, ${SELECT_CALCULS} FROM depots_vente d ${JOINS_CALCULS}
         WHERE d.id=$1 AND d.user_id = ANY($2::uuid[])`,
        [req.params.id, ids]
      ),
      pool.query('SELECT * FROM depot_mouvements WHERE depot_vente_id=$1 ORDER BY date DESC, created_at DESC', [req.params.id]),
    ]);
    if (!depotR.rows.length) return res.status(404).json({ error: 'Dépôt non trouvé' });
    res.json({ ...withCalculs(depotR.rows)[0], mouvements: movR.rows });
  } catch (err) {
    logger.error('GET depots/:id', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/depots/:id — manager+ seulement (comme les contrats, voir routes/contrats.js)
router.put('/:id', requirePerm('depots:statut'), async (req, res) => {
  try {
    const { client_nom, produit, quantite_deposee, prix_unitaire, date_depot, note, statut } = req.body;
    if (!client_nom || !produit || !quantite_deposee || !prix_unitaire || !date_depot)
      return res.status(400).json({ error: 'Champs requis : client_nom, produit, quantite_deposee, prix_unitaire, date_depot' });
    if (!isPositiveNumber(quantite_deposee))
      return res.status(400).json({ error: 'quantite_deposee doit etre un nombre positif' });
    if (!isPositiveNumber(prix_unitaire))
      return res.status(400).json({ error: 'prix_unitaire doit etre un nombre positif' });
    if (!isValidDate(date_depot))
      return res.status(400).json({ error: 'date_depot invalide (format YYYY-MM-DD attendu)' });
    if (statut && !STATUTS.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    if (!maxLen(client_nom, 200)) return res.status(400).json({ error: 'client_nom trop long (200 caracteres max)' });
    if (!maxLen(produit, 200))    return res.status(400).json({ error: 'produit trop long (200 caracteres max)' });
    if (!maxLen(note, 2000))      return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    const ids = req.scopeIds;
    const result = await pool.query(
      `UPDATE depots_vente SET client_nom=$1, produit=$2, quantite_deposee=$3, prix_unitaire=$4,
         date_depot=$5, note=$6, statut=COALESCE($7, statut)
       WHERE id=$8 AND user_id = ANY($9::uuid[]) RETURNING *`,
      [client_nom, produit, +quantite_deposee, +prix_unitaire, date_depot, note || null,
       statut || null, req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Dépôt non trouvé' });
    res.json(withCalculs(result.rows)[0]);
  } catch (err) {
    logger.error('PUT depots/:id', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/depots/:id/mouvements — rapport périodique du distributeur (quantité vendue ou
// invendue retournée depuis le dernier passage). Ouvert à tout utilisateur du périmètre
// (comme la création d'une vente) : ce n'est qu'une déclaration de quantité, pas un
// encaissement — le règlement passe par /api/encaissements (type "depot").
router.post('/:id/mouvements', async (req, res) => {
  try {
    const { type, quantite, date, note } = req.body;
    if (!TYPES_MOUVEMENT.includes(type)) return res.status(400).json({ error: 'type invalide (vente ou retour)' });
    if (!isPositiveNumber(quantite)) return res.status(400).json({ error: 'quantite doit etre un nombre positif' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'date invalide (format YYYY-MM-DD attendu)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });

    const ids = req.scopeIds;
    const mouvement = await withTransaction(async (client) => {
      // Verrouille la ligne du dépôt : sérialise les déclarations concurrentes pour ce dépôt
      // (même principe que le FOR UPDATE sur une vente avant un versement).
      const depotR = await client.query(
        'SELECT * FROM depots_vente WHERE id=$1 AND user_id = ANY($2::uuid[]) FOR UPDATE',
        [req.params.id, ids]
      );
      if (!depotR.rows.length) { const e = new Error('Dépôt non trouvé'); e.status = 404; throw e; }
      const depot = depotR.rows[0];

      const soldeR = await client.query(
        `SELECT COALESCE(SUM(quantite) FILTER (WHERE type='vente'),  0) AS qv,
                COALESCE(SUM(quantite) FILTER (WHERE type='retour'), 0) AS qr
         FROM depot_mouvements WHERE depot_vente_id=$1`,
        [req.params.id]
      );
      const qv = +soldeR.rows[0].qv;
      const qr = +soldeR.rows[0].qr;
      const solde = +depot.quantite_deposee - qv - qr;
      if (+quantite > solde) {
        const e = new Error(`Quantité excessive : solde restant en dépôt est ${solde}`);
        e.status = 400; throw e;
      }

      const insR = await client.query(
        `INSERT INTO depot_mouvements (depot_vente_id, type, quantite, date, note)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.params.id, type, +quantite, date || new Date().toISOString().slice(0, 10), note || null]
      );

      // Clôture automatique dès que le dépôt est entièrement écoulé (vendu + retourné).
      if (solde - +quantite <= 0 && depot.statut === 'En cours') {
        await client.query(`UPDATE depots_vente SET statut='Clôturé' WHERE id=$1`, [req.params.id]);
      }

      // Une nouvelle quantité vendue augmente le montant dû : si le dépôt était marqué "Payé"
      // pour l'ancien montant, il repasse "En cours" tant que ce nouveau montant n'est pas
      // lui-même couvert par les versements déjà enregistrés.
      if (type === 'vente') {
        const verseR = await client.query(
          `SELECT COALESCE(SUM(montant),0) AS total FROM versements
           WHERE depot_vente_id=$1 AND statut_validation != 'rejete'`, [req.params.id]
        );
        const montantDu = (qv + +quantite) * +depot.prix_unitaire;
        const nouveauStatutPaiement = +verseR.rows[0].total >= montantDu ? 'Paye' : 'En cours';
        if (nouveauStatutPaiement !== depot.statut_paiement) {
          await client.query(`UPDATE depots_vente SET statut_paiement=$1 WHERE id=$2`, [nouveauStatutPaiement, req.params.id]);
        }
      }

      return insR.rows[0];
    });
    res.status(201).json(mouvement);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('POST depots/:id/mouvements', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/depots/:id — manager+ seulement
router.delete('/:id', requirePerm('depots:delete'), async (req, res) => {
  try {
    const ids = req.scopeIds;
    const result = await pool.query(
      'DELETE FROM depots_vente WHERE id=$1 AND user_id = ANY($2::uuid[]) RETURNING id',
      [req.params.id, ids]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Dépôt non trouvé' });
    res.json({ message: 'Dépôt supprimé' });
  } catch (err) {
    logger.error('DELETE depots/:id', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
