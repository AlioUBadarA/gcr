const express = require('express');
const { pool } = require('../db/pool');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');
const { attachScopeIds } = require('../middleware/scope');
const { isNonNegativeNumber, maxLen } = require('../middleware/validate');

const router = express.Router();
router.use(auth, attachScopeIds);

const TYPES_VALIDES  = ['Grossiste','Detaillant marche','Boutique','Restauration','Cantine/Institution'];
const STATUTS_VALIDES = ['Actif','Prospect','Dormant'];

async function getUserRizerieId(userId) {
  const r = await pool.query('SELECT rizerie_id FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.rizerie_id || null;
}

// Tout le monde voit tous les clients de la rizerie — les droits de modification diffèrent
function readClause(role, rizerieId, scopeIds) {
  if (rizerieId) {
    return { clause: 'c.rizerie_id = $1', params: [rizerieId] };
  }
  return { clause: 'c.user_id = ANY($1::uuid[])', params: [scopeIds] };
}

// Cherche par téléphone dans la rizerie puis par nom sous l'utilisateur, crée si absent.
// Utilisé par ventes.js lors de la création automatique de clients depuis une vente,
// et par prospection.js lors de la conversion d'un prospect gagné en client.
async function findOrCreateClient(userId, clientNom, telephone, type) {
  const nom = clientNom.trim();
  const typeFinal = TYPES_VALIDES.includes(type) ? type : 'Boutique';
  const rizerieId = await getUserRizerieId(userId);

  if (telephone && rizerieId) {
    const byPhone = await pool.query(
      'SELECT * FROM clients WHERE rizerie_id=$1 AND telephone=$2 LIMIT 1',
      [rizerieId, telephone]
    );
    if (byPhone.rows.length) {
      const updated = await pool.query(
        `UPDATE clients SET statut = CASE WHEN statut='Prospect' THEN 'Actif' ELSE statut END
         WHERE id=$1 RETURNING *`,
        [byPhone.rows[0].id]
      );
      return updated.rows[0];
    }
  }

  const byName = rizerieId
    ? await pool.query('SELECT * FROM clients WHERE rizerie_id=$1 AND LOWER(nom)=LOWER($2) LIMIT 1', [rizerieId, nom])
    : await pool.query('SELECT * FROM clients WHERE user_id=$1 AND LOWER(nom)=LOWER($2) LIMIT 1', [userId, nom]);
  if (byName.rows.length) {
    const c = byName.rows[0];
    const updated = await pool.query(
      `UPDATE clients SET
         statut = CASE WHEN statut='Prospect' THEN 'Actif' ELSE statut END,
         telephone = COALESCE(telephone, $1)
       WHERE id=$2 RETURNING *`,
      [telephone || null, c.id]
    );
    return updated.rows[0];
  }

  const created = await pool.query(
    `INSERT INTO clients (user_id, rizerie_id, nom, type, statut, telephone)
     VALUES ($1,$2,$3,$4,'Actif',$5) RETURNING *`,
    [userId, rizerieId, nom, typeFinal, telephone || null]
  );
  return created.rows[0];
}

// GET /api/clients
router.get('/', async (req, res) => {
  try {
    const { statut, type, search } = req.query;
    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId && !['superadmin','support'].includes(req.userRole)) return res.json([]);

    const { clause, params } = readClause(req.userRole, rizerieId, req.scopeIds);
    // CA/nb ventes/dernier achat calculés sur TOUTES les ventes du client (pas un sous-ensemble
    // plafonné côté API), pour que le scoring RFM reste correct quel que soit le volume d'activité.
    let q = `SELECT c.*, u.nom AS vendeur_nom,
                    COALESCE(vs.nb_ventes, 0) AS nb_ventes,
                    COALESCE(vs.ca_total, 0)  AS ca_total,
                    vs.derniere_vente
             FROM clients c
             LEFT JOIN users u ON u.id = c.user_id
             LEFT JOIN (
               SELECT client_id, COUNT(*) AS nb_ventes, SUM(montant) AS ca_total, MAX(date_vente) AS derniere_vente
               FROM ventes WHERE client_id IS NOT NULL GROUP BY client_id
             ) vs ON vs.client_id = c.id
             WHERE ${clause}`;
    if (statut && STATUTS_VALIDES.includes(statut)) {
      q += ` AND c.statut = $${params.length + 1}`; params.push(statut);
    }
    if (type && TYPES_VALIDES.includes(type)) {
      q += ` AND c.type = $${params.length + 1}`; params.push(type);
    }
    if (search) {
      q += ` AND (c.nom ILIKE $${params.length + 1} OR c.zone ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    q += ' ORDER BY c.statut, c.nom';
    const result = await pool.query(q, params);

    // directeur/rizier/superadmin : modifient tout
    // manager : modifie clients de son équipe (scopeIds)
    // vendeur : modifie seulement ses propres clients
    const canEditAll = ['directeur', 'rizier', 'superadmin'].includes(req.userRole);
    const scopeSet = new Set(req.scopeIds.map(String));
    const rows = result.rows.map(r => ({
      ...r,
      can_edit: canEditAll || scopeSet.has(String(r.user_id)),
      can_delete: ['directeur', 'rizier', 'superadmin', 'support'].includes(req.userRole),
    }));
    res.json(rows);
  } catch (err) {
    logger.error('GET clients', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/clients — vérifier doublon par téléphone dans toute la rizerie
router.post('/', async (req, res) => {
  try {
    const { nom, type, statut, zone, region, segment, potentiel_annuel, telephone,
            volume_estime, frequence, valorise, horaire, note, produits_interet } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'Nom et type requis' });
    if (!TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
    if (!maxLen(nom, 200))  return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(zone, 200)) return res.status(400).json({ error: 'zone trop longue (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    if (potentiel_annuel !== undefined && potentiel_annuel !== null && !isNonNegativeNumber(potentiel_annuel))
      return res.status(400).json({ error: 'potentiel_annuel doit etre un nombre positif ou nul' });
    if (volume_estime !== undefined && volume_estime !== null && !isNonNegativeNumber(volume_estime))
      return res.status(400).json({ error: 'volume_estime doit etre un nombre positif ou nul' });

    const rizerieId = await getUserRizerieId(req.userId);

    if (telephone && rizerieId) {
      const dup = await pool.query(
        `SELECT c.id, c.nom, c.telephone, u.nom AS assigne_a
         FROM clients c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.rizerie_id=$1 AND c.telephone=$2 LIMIT 1`,
        [rizerieId, telephone]
      );
      if (dup.rows.length) {
        return res.status(409).json({
          error: 'client_existe',
          message: 'Un client avec ce numéro existe déjà dans votre rizerie',
          client: {
            id: dup.rows[0].id,
            nom: dup.rows[0].nom,
            telephone: dup.rows[0].telephone,
            assigne_a: dup.rows[0].assigne_a,
          },
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO clients (user_id, rizerie_id, nom, type, statut, zone, region, segment,
         potentiel_annuel, telephone, volume_estime, frequence, valorise, horaire, note, produits_interet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.userId, rizerieId || null, nom.trim(), type, statut || 'Prospect',
       zone || null, region || null, segment || null, potentiel_annuel || 0, telephone || null,
       volume_estime || 0, frequence || null, valorise || null, horaire || null, note || null,
       Array.isArray(produits_interet) ? produits_interet : []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('POST clients', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/clients/:id — lecture autorisée pour toute la rizerie (avec can_edit/can_delete)
router.get('/:id', async (req, res) => {
  try {
    const rizerieId = await getUserRizerieId(req.userId);
    let result;
    if (rizerieId) {
      result = await pool.query(
        `SELECT c.*, u.nom AS vendeur_nom FROM clients c
         LEFT JOIN users u ON u.id = c.user_id
         WHERE c.id=$1 AND c.rizerie_id=$2`,
        [req.params.id, rizerieId]
      );
    } else {
      result = await pool.query(
        `SELECT c.*, u.nom AS vendeur_nom FROM clients c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.id=$1 AND c.user_id = ANY($2::uuid[])`,
        [req.params.id, req.scopeIds]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouvé' });
    const c = result.rows[0];
    const canEditAll = ['directeur', 'rizier', 'superadmin'].includes(req.userRole);
    const scopeSet = new Set(req.scopeIds.map(String));
    res.json({
      ...c,
      can_edit: canEditAll || scopeSet.has(String(c.user_id)),
      can_delete: ['directeur', 'rizier', 'superadmin', 'support'].includes(req.userRole),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/clients/:id
// Directeur/rizier/manager : tout client de la rizerie — Vendeur : ses propres clients
router.put('/:id', async (req, res) => {
  try {
    const { nom, type, statut, zone, region, segment, potentiel_annuel, telephone,
            volume_estime, frequence, valorise, horaire, note, produits_interet } = req.body;
    if (!nom)    return res.status(400).json({ error: 'Nom requis' });
    if (!type)   return res.status(400).json({ error: 'Type requis' });
    if (!statut) return res.status(400).json({ error: 'Statut requis' });
    if (!TYPES_VALIDES.includes(type))     return res.status(400).json({ error: 'Type invalide' });
    if (!STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
    if (!maxLen(nom, 200))  return res.status(400).json({ error: 'nom trop long (200 caracteres max)' });
    if (!maxLen(zone, 200)) return res.status(400).json({ error: 'zone trop longue (200 caracteres max)' });
    if (!maxLen(note, 2000)) return res.status(400).json({ error: 'note trop longue (2000 caracteres max)' });
    if (potentiel_annuel !== undefined && potentiel_annuel !== null && !isNonNegativeNumber(potentiel_annuel))
      return res.status(400).json({ error: 'potentiel_annuel doit etre un nombre positif ou nul' });
    if (volume_estime !== undefined && volume_estime !== null && !isNonNegativeNumber(volume_estime))
      return res.status(400).json({ error: 'volume_estime doit etre un nombre positif ou nul' });

    const rizerieId = await getUserRizerieId(req.userId);
    const canEditAll = ['directeur', 'rizier', 'superadmin'].includes(req.userRole);

    const access = canEditAll && rizerieId
      ? await pool.query('SELECT id FROM clients WHERE id=$1 AND rizerie_id=$2', [req.params.id, rizerieId])
      : await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, req.scopeIds]);
    if (!access.rows.length) return res.status(403).json({ error: 'Modification non autorisée pour ce client' });

    const result = await pool.query(
      `UPDATE clients SET
         nom=$1, type=$2, statut=$3, zone=$4, region=$5, segment=$6, potentiel_annuel=$7, telephone=$8,
         volume_estime=$9, frequence=$10, valorise=$11, horaire=$12, note=$13, produits_interet=$14,
         updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [nom, type, statut, zone || null, region || null, segment || null, potentiel_annuel || 0,
       telephone || null, volume_estime || 0, frequence || null, valorise || null, horaire || null,
       note || null, Array.isArray(produits_interet) ? produits_interet : [], req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('PUT clients', { err: err.message, stack: err.stack, userId: req.userId, ip: req.ip });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/clients/:id/statut — mêmes droits que PUT
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS_VALIDES.includes(statut)) return res.status(400).json({ error: 'Statut invalide' });

    const rizerieId = await getUserRizerieId(req.userId);
    const canEditAll = ['directeur', 'rizier', 'superadmin'].includes(req.userRole);

    const access = canEditAll && rizerieId
      ? await pool.query('SELECT id FROM clients WHERE id=$1 AND rizerie_id=$2', [req.params.id, rizerieId])
      : await pool.query('SELECT id FROM clients WHERE id=$1 AND user_id = ANY($2::uuid[])', [req.params.id, req.scopeIds]);
    if (!access.rows.length) return res.status(403).json({ error: 'Modification non autorisée pour ce client' });

    const result = await pool.query(
      'UPDATE clients SET statut=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [statut, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/clients/:id — directeur et rizier uniquement
router.delete('/:id', async (req, res) => {
  try {
    if (!['directeur', 'rizier', 'superadmin', 'support'].includes(req.userRole))
      return res.status(403).json({ error: 'Seul le directeur peut supprimer un client' });

    const rizerieId = await getUserRizerieId(req.userId);
    if (!rizerieId) return res.status(400).json({ error: 'Compte non rattaché à une rizerie' });

    const result = await pool.query(
      'DELETE FROM clients WHERE id=$1 AND rizerie_id=$2 RETURNING id',
      [req.params.id, rizerieId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouvé' });
    res.json({ message: 'Client supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.findOrCreateClient = findOrCreateClient;
