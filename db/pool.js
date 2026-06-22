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
    `DO $$
     DECLARE c TEXT;
     BEGIN
       SELECT conname INTO c FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%role%' LIMIT 1;
       IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c); END IF;
       BEGIN
         ALTER TABLE users ADD CONSTRAINT users_role_check
           CHECK (role IN ('rizier','superadmin','vendeur','support'));
       EXCEPTION WHEN duplicate_object THEN NULL; END;
     END $$`,
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
      const hash = await bcrypt.hash(password, 10);
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

module.exports = { pool, initSchema, runMigrations, withTransaction, reassignVendeurData };
