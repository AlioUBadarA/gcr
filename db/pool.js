const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Erreur pool PostgreSQL:', err.message);
});

// Initialise le schema au demarrage
async function initSchema() {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Schema PostgreSQL initialise');
  } catch (err) {
    console.error('Erreur initialisation schema:', err.message);
    throw err;
  }
}

// Migrations — idempotentes, sans risque
async function runMigrations() {
  console.log('[MIG] Debut runMigrations...');
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'rizier' CHECK (role IN ('rizier','superadmin'))`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
      actor_nom   VARCHAR(120),
      action      VARCHAR(80) NOT NULL,
      target_id   UUID,
      target_nom  VARCHAR(150),
      detail      JSONB,
      ip          VARCHAR(45),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs(actor_id)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `DO $$
     DECLARE c TEXT;
     BEGIN
       SELECT conname INTO c FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%role%' LIMIT 1;
       IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c); END IF;
       BEGIN
         ALTER TABLE users ADD CONSTRAINT users_role_check
           CHECK (role IN ('rizier','superadmin','vendeur'));
       EXCEPTION WHEN duplicate_object THEN NULL; END;
     END $$`,
    `CREATE TABLE IF NOT EXISTS forecast (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       annee INT NOT NULL, mois INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
       produit VARCHAR(100) NOT NULL DEFAULT 'Général',
       objectif_montant NUMERIC(14,2) NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
       UNIQUE(user_id, annee, mois, produit)
     )`,
    `CREATE TABLE IF NOT EXISTS prospection (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       nom VARCHAR(150) NOT NULL, type_client VARCHAR(50), zone VARCHAR(100), telephone VARCHAR(30),
       statut VARCHAR(40) NOT NULL DEFAULT 'Nouveau',
       priorite VARCHAR(20) DEFAULT 'Normale',
       date_contact DATE, note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `ALTER TABLE ventes ADD COLUMN IF NOT EXISTS cout_unitaire NUMERIC(10,2) DEFAULT 0`,
    `CREATE INDEX IF NOT EXISTS idx_forecast_user    ON forecast(user_id, annee)`,
    `CREATE INDEX IF NOT EXISTS idx_prospection_user ON prospection(user_id)`,
    `CREATE TABLE IF NOT EXISTS emplois (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       nom VARCHAR(150) NOT NULL, poste VARCHAR(100),
       type_contrat VARCHAR(30) DEFAULT 'CDI',
       date_embauche DATE, salaire NUMERIC(12,2), telephone VARCHAR(30), note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS contrats_clients (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
       client_nom VARCHAR(150) NOT NULL, produit VARCHAR(100) NOT NULL,
       quantite_mensuelle NUMERIC(10,2) DEFAULT 0, prix_unitaire NUMERIC(10,2) DEFAULT 0,
       date_debut DATE, date_fin DATE,
       statut VARCHAR(20) DEFAULT 'Actif', note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS contrats_paddy (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       producteur_nom VARCHAR(150) NOT NULL, zone VARCHAR(100), telephone VARCHAR(30),
       variete VARCHAR(100), quantite_kg NUMERIC(12,2) DEFAULT 0, prix_kg NUMERIC(10,2) DEFAULT 0,
       date_debut DATE, date_fin DATE,
       statut VARCHAR(20) DEFAULT 'Actif', note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_emplois_user          ON emplois(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contrats_clients_user ON contrats_clients(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contrats_paddy_user   ON contrats_paddy(user_id)`,
    `CREATE TABLE IF NOT EXISTS rizeries (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       nom VARCHAR(150) NOT NULL,
       ville VARCHAR(80),
       telephone VARCHAR(30),
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS rizerie_id UUID REFERENCES rizeries(id) ON DELETE SET NULL`,
    `ALTER TABLE prospection ADD COLUMN IF NOT EXISTS valeur_estimee NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS pays VARCHAR(80)`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS region VARCHAR(100)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS zone VARCHAR(100)`,
    `DO $$
     DECLARE c TEXT;
     BEGIN
       SELECT conname INTO c FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%role%' LIMIT 1;
       IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c); END IF;
       BEGIN
         ALTER TABLE users ADD CONSTRAINT users_role_check
           CHECK (role IN ('rizier','superadmin','vendeur','support','manager'));
       EXCEPTION WHEN duplicate_object THEN NULL; END;
     END $$`,
    // Relabellise le pipeline de prospection à l'identique du HTML de référence
    // (Nouveau/Qualifié/Proposition/Négociation/Gagné/Perdu). On relâche d'abord la
    // contrainte existante (quel que soit son nom réel) avant de remapper les anciennes
    // valeurs, pour ne pas violer le CHECK pendant la migration des lignes existantes.
    // Détection par colonne réelle (pg_attribute.attname) plutôt que par correspondance
    // textuelle sur la définition — fiable quel que soit le nom auto-généré de la contrainte.
    `DO $$
     DECLARE conrec RECORD;
     BEGIN
       FOR conrec IN
         SELECT con.conname
         FROM pg_constraint con
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
         WHERE con.conrelid = 'prospection'::regclass AND con.contype = 'c' AND att.attname = 'statut'
       LOOP
         EXECUTE format('ALTER TABLE prospection DROP CONSTRAINT %I', conrec.conname);
       END LOOP;
     END $$`,
    `ALTER TABLE prospection DROP CONSTRAINT IF EXISTS prospection_statut_check`,
    `UPDATE prospection SET statut = 'Qualifié'    WHERE statut = 'En contact'`,
    `UPDATE prospection SET statut = 'Proposition' WHERE statut = 'Présentation faite'`,
    `UPDATE prospection SET statut = 'Négociation' WHERE statut = 'Devis envoyé'`,
    `ALTER TABLE prospection ADD COLUMN IF NOT EXISTS region VARCHAR(100)`,
    `ALTER TABLE prospection ADD COLUMN IF NOT EXISTS source VARCHAR(50)`,
    `DO $$
     BEGIN
       ALTER TABLE prospection ADD CONSTRAINT prospection_statut_check
         CHECK (statut IN ('Nouveau','Qualifié','Proposition','Négociation','Gagné','Perdu'));
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS region VARCHAR(100)`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS segment VARCHAR(100)`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS potentiel_annuel NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE ventes ADD COLUMN IF NOT EXISTS mode VARCHAR(20)`,
    `CREATE TABLE IF NOT EXISTS versements (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       vente_id UUID NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
       montant NUMERIC(12,2) NOT NULL CHECK (montant > 0),
       mode VARCHAR(20),
       date DATE NOT NULL DEFAULT CURRENT_DATE,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_versements_vente ON versements(vente_id)`,
    `CREATE TABLE IF NOT EXISTS relances (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       vente_id UUID NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
       date DATE NOT NULL DEFAULT CURRENT_DATE,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_relances_vente ON relances(vente_id)`,
    `CREATE TABLE IF NOT EXISTS produits (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       ref VARCHAR(40) NOT NULL,
       nom VARCHAR(100) NOT NULL,
       prix_kg NUMERIC(10,2) DEFAULT 0,
       cout_kg NUMERIC(10,2) DEFAULT 0,
       tendance VARCHAR(20) DEFAULT 'stable',
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW(),
       UNIQUE(user_id, ref)
     )`,
    `CREATE TABLE IF NOT EXISTS activites (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       date DATE NOT NULL DEFAULT CURRENT_DATE,
       type VARCHAR(30) NOT NULL,
       cible VARCHAR(150),
       resultat VARCHAR(20) DEFAULT 'Neutre',
       note TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_activites_user ON activites(user_id, date DESC)`,
    `CREATE TABLE IF NOT EXISTS alertes_traitees (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       alerte_key VARCHAR(300) NOT NULL,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       UNIQUE(user_id, alerte_key)
     )`,
    // Visites planifiées du pilotage hebdomadaire — plusieurs clients/prospects par jour,
    // chacun avec son propre commentaire (action à poser), au lieu d'un simple champ texte.
    `CREATE TABLE IF NOT EXISTS pilotage_visites (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       semaine VARCHAR(30) NOT NULL,
       jour VARCHAR(15) NOT NULL,
       client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
       prospect_id UUID REFERENCES prospection(id) ON DELETE CASCADE,
       commentaire TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_pilotage_visites_user ON pilotage_visites(user_id, semaine, jour)`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS produits_interet TEXT[] DEFAULT '{}'`,
    `ALTER TABLE ventes           ADD COLUMN IF NOT EXISTS numero VARCHAR(20)`,
    `ALTER TABLE contrats_clients ADD COLUMN IF NOT EXISTS numero VARCHAR(20)`,
    `ALTER TABLE contrats_paddy   ADD COLUMN IF NOT EXISTS numero VARCHAR(20)`,
    `WITH numbered AS (
       SELECT id, 'V-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
              LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
       FROM ventes WHERE numero IS NULL
     )
     UPDATE ventes v SET numero = n.num FROM numbered n WHERE v.id = n.id`,
    `WITH numbered AS (
       SELECT id, 'CC-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
              LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
       FROM contrats_clients WHERE numero IS NULL
     )
     UPDATE contrats_clients c SET numero = n.num FROM numbered n WHERE c.id = n.id`,
    `WITH numbered AS (
       SELECT id, 'CP-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
              LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
       FROM contrats_paddy WHERE numero IS NULL
     )
     UPDATE contrats_paddy c SET numero = n.num FROM numbered n WHERE c.id = n.id`,
    `ALTER TABLE versements ALTER COLUMN vente_id DROP NOT NULL`,
    `ALTER TABLE versements ADD COLUMN IF NOT EXISTS contrat_client_id UUID REFERENCES contrats_clients(id) ON DELETE CASCADE`,
    `DO $$ BEGIN
       ALTER TABLE versements ADD CONSTRAINT versements_one_target_check
         CHECK (num_nonnulls(vente_id, contrat_client_id) = 1);
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `CREATE INDEX IF NOT EXISTS idx_versements_contrat_client ON versements(contrat_client_id)`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS emplois_baseline INT DEFAULT 0`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS masse_salariale_baseline NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS ca_baseline NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS baseline_date DATE DEFAULT CURRENT_DATE`,
    // ── Rôle directeur ───────────────────────────────────────────
    `DO $$
     DECLARE c TEXT;
     BEGIN
       SELECT conname INTO c FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%role%' LIMIT 1;
       IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c); END IF;
       BEGIN
         ALTER TABLE users ADD CONSTRAINT users_role_check
           CHECK (role IN ('rizier','superadmin','vendeur','support','manager','directeur'));
       EXCEPTION WHEN duplicate_object THEN NULL; END;
     END $$`,
    // ── Lien compte plateforme sur les employés ───────────────────
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS role_plateforme VARCHAR(20)`,
    `DO $$ BEGIN
       ALTER TABLE emplois ADD CONSTRAINT emplois_role_plateforme_check
         CHECK (role_plateforme IN ('vendeur','manager','directeur'));
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    // ── Produits et Clients liés à la rizerie ─────────────────────
    `ALTER TABLE produits ADD COLUMN IF NOT EXISTS rizerie_id UUID REFERENCES rizeries(id) ON DELETE SET NULL`,
    `UPDATE produits p SET rizerie_id = u.rizerie_id FROM users u WHERE u.id = p.user_id AND p.rizerie_id IS NULL AND u.rizerie_id IS NOT NULL`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS rizerie_id UUID REFERENCES rizeries(id) ON DELETE SET NULL`,
    `UPDATE clients c SET rizerie_id = u.rizerie_id FROM users u WHERE u.id = c.user_id AND c.rizerie_id IS NULL AND u.rizerie_id IS NOT NULL`,
    // ── Plusieurs produits par contrat client ─────────────────────
    `ALTER TABLE contrats_clients ADD COLUMN IF NOT EXISTS produits TEXT[] DEFAULT '{}'`,
    `UPDATE contrats_clients SET produits = ARRAY[produit] WHERE (produits IS NULL OR produits = '{}') AND produit IS NOT NULL AND produit != ''`,
  ];

  for (let i = 0; i < migrations.length; i++) {
    try {
      await pool.query(migrations[i]);
      console.log(`[MIG] Step ${i + 1}/${migrations.length} OK`);
    } catch (err) {
      console.error(`[MIG] Step ${i + 1} error:`, err.message);
    }
  }
  console.log('[MIG] Migrations appliquees');

  // ── Compte superadmin garanti ──────────────────────────────────
  const email    = process.env.SUPERADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SUPERADMIN_PASSWORD?.trim();
  const nom      = process.env.SUPERADMIN_NOM?.trim() || 'Super Admin PFS';

  console.log(`[MIG] SUPERADMIN_EMAIL: ${email || 'NON DEFINI'}`);
  console.log(`[MIG] SUPERADMIN_PASSWORD: ${password ? '***set***' : 'NON DEFINI'}`);

  if (email && password) {
    try {
      const bcrypt = require('bcryptjs');
      console.log('[MIG] Hachage du mot de passe...');
      const hash = await bcrypt.hash(password, 12);
      console.log('[MIG] Hash OK, upsert en cours...');

      await pool.query(`
        INSERT INTO users (nom, email, password, rizerie, role)
        VALUES ($1, $2, $3, 'PFS Administration', 'superadmin')
        ON CONFLICT (email) DO UPDATE
          SET password  = EXCLUDED.password,
              role      = 'superadmin',
              suspended = FALSE
      `, [nom, email, hash]);

      console.log(`[MIG] Superadmin OK : ${email}`);
    } catch (err) {
      console.error('[MIG] Erreur creation superadmin:', err.message);
    }
  } else {
    console.log('[MIG] Pas de superadmin a creer (variables manquantes)');
  }
}

// Exécute fn(client) dans une transaction : BEGIN, COMMIT si succès, ROLLBACK si erreur.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Rattache les ventes/clients d'un vendeur supprimé à son rizier parent,
// pour ne pas perdre l'historique commercial (au lieu du cascade delete).
async function reassignVendeurData(client, vendeurId, parentId) {
  await client.query('UPDATE ventes SET user_id=$1 WHERE user_id=$2', [parentId, vendeurId]);
  await client.query('UPDATE clients SET user_id=$1 WHERE user_id=$2', [parentId, vendeurId]);
}

// Génère un numéro de transaction lisible (ex: V-2026-0007) pour identifier
// une vente/un contrat et pouvoir le retrouver dans Encaissements.
async function nextNumero(table, prefix, userId) {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
    [userId, year]
  );
  return `${prefix}-${year}-${String(rows[0].n + 1).padStart(4, '0')}`;
}

module.exports = { pool, initSchema, runMigrations, withTransaction, reassignVendeurData, nextNumero };
