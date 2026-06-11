-- ============================================================
-- PFS Commercial Platform - Schema PostgreSQL
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── UTILISATEURS (un compte par rizier) ──────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom              VARCHAR(120) NOT NULL,
  email            VARCHAR(200) UNIQUE NOT NULL,
  password         VARCHAR(200) NOT NULL,
  rizerie          VARCHAR(150),
  telephone        VARCHAR(30),
  ville            VARCHAR(80),
  role             VARCHAR(20) NOT NULL DEFAULT 'rizier' CHECK (role IN ('rizier','superadmin')),
  suspended        BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at     TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations idempotentes pour bases existantes
ALTER TABLE users ADD COLUMN IF NOT EXISTS role             VARCHAR(20) NOT NULL DEFAULT 'rizier';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id        UUID REFERENCES users(id) ON DELETE SET NULL;

-- Étend la contrainte role pour inclure vendeur
DO $$
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
END $$;

-- forecast : objectifs mensuels
CREATE TABLE IF NOT EXISTS forecast (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  annee            INT NOT NULL,
  mois             INT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  produit          VARCHAR(100) NOT NULL DEFAULT 'Général',
  objectif_montant NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, annee, mois, produit)
);

-- prospection : pipeline nouveaux clients
CREATE TABLE IF NOT EXISTS prospection (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom          VARCHAR(150) NOT NULL,
  type_client  VARCHAR(50),
  zone         VARCHAR(100),
  telephone    VARCHAR(30),
  statut       VARCHAR(40) NOT NULL DEFAULT 'Nouveau'
               CHECK (statut IN ('Nouveau','En contact','Présentation faite','Devis envoyé','Gagné','Perdu')),
  priorite     VARCHAR(20) DEFAULT 'Normale'
               CHECK (priorite IN ('Haute','Normale','Basse')),
  date_contact DATE,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- cout_unitaire sur ventes pour le calcul de rentabilité
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS cout_unitaire NUMERIC(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_forecast_user    ON forecast(user_id, annee);
CREATE INDEX IF NOT EXISTS idx_prospection_user ON prospection(user_id);

-- emplois : liste des employés de la rizerie
CREATE TABLE IF NOT EXISTS emplois (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom           VARCHAR(150) NOT NULL,
  poste         VARCHAR(100),
  type_contrat  VARCHAR(30) DEFAULT 'CDI'
                CHECK (type_contrat IN ('CDI','CDD','Temps partiel','Stage','Journalier')),
  date_embauche DATE,
  salaire       NUMERIC(12,2),
  telephone     VARCHAR(30),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- contrats_clients : commandes récurrentes aval
CREATE TABLE IF NOT EXISTS contrats_clients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id          UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_nom         VARCHAR(150) NOT NULL,
  produit            VARCHAR(100) NOT NULL,
  quantite_mensuelle NUMERIC(10,2) DEFAULT 0,
  prix_unitaire      NUMERIC(10,2) DEFAULT 0,
  date_debut         DATE,
  date_fin           DATE,
  statut             VARCHAR(20) DEFAULT 'Actif'
                     CHECK (statut IN ('Actif','Suspendu','Terminé')),
  note               TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- contrats_paddy : contractualisation producteurs amont
CREATE TABLE IF NOT EXISTS contrats_paddy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  producteur_nom  VARCHAR(150) NOT NULL,
  zone            VARCHAR(100),
  telephone       VARCHAR(30),
  variete         VARCHAR(100),
  quantite_kg     NUMERIC(12,2) DEFAULT 0,
  prix_kg         NUMERIC(10,2) DEFAULT 0,
  date_debut      DATE,
  date_fin        DATE,
  statut          VARCHAR(20) DEFAULT 'Actif'
                  CHECK (statut IN ('Actif','Suspendu','Terminé')),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emplois_user          ON emplois(user_id);
CREATE INDEX IF NOT EXISTS idx_contrats_clients_user ON contrats_clients(user_id);
CREATE INDEX IF NOT EXISTS idx_contrats_paddy_user   ON contrats_paddy(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_nom   VARCHAR(120),
  action      VARCHAR(80) NOT NULL,
  target_id   UUID,
  target_nom  VARCHAR(150),
  detail      JSONB,
  ip          VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs(actor_id);

-- ── CLIENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom         VARCHAR(150) NOT NULL,
  type        VARCHAR(50) NOT NULL CHECK (type IN (
                'Grossiste','Detaillant marche','Boutique',
                'Restauration','Cantine/Institution')),
  statut      VARCHAR(20) NOT NULL DEFAULT 'Prospect' CHECK (statut IN (
                'Actif','Prospect','Dormant')),
  zone        VARCHAR(100),
  telephone   VARCHAR(30),
  volume_estime NUMERIC(10,2) DEFAULT 0,
  frequence   VARCHAR(50),
  valorise    VARCHAR(200),
  horaire     VARCHAR(80),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── VENTES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_nom  VARCHAR(150) NOT NULL,
  date_vente  DATE NOT NULL,
  produit     VARCHAR(100) NOT NULL,
  quantite    NUMERIC(10,2) NOT NULL CHECK (quantite > 0),
  prix_unitaire NUMERIC(10,2) NOT NULL CHECK (prix_unitaire > 0),
  montant     NUMERIC(12,2) GENERATED ALWAYS AS (quantite * prix_unitaire) STORED,
  statut_paiement VARCHAR(20) NOT NULL DEFAULT 'En cours' CHECK (statut_paiement IN (
                    'Paye','En cours','En retard')),
  date_echeance DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── PILOTAGE HEBDOMADAIRE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pilotage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semaine     VARCHAR(30) NOT NULL,
  jour        VARCHAR(15) NOT NULL CHECK (jour IN (
                'Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi')),
  zone        VARCHAR(100),
  clients_visiter TEXT,
  objectif    NUMERIC(12,2) DEFAULT 0,
  realise     NUMERIC(12,2) DEFAULT 0,
  note        TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, semaine, jour)
);

-- ── ACTIONS CORRECTIVES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS actions_correctives (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semaine     VARCHAR(30) NOT NULL,
  contenu     TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, semaine)
);

-- ── INDEX ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ventes_user    ON ventes(user_id);
CREATE INDEX IF NOT EXISTS idx_ventes_date    ON ventes(date_vente);
CREATE INDEX IF NOT EXISTS idx_ventes_statut  ON ventes(statut_paiement);
CREATE INDEX IF NOT EXISTS idx_clients_user   ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_statut ON clients(statut);
CREATE INDEX IF NOT EXISTS idx_pilotage_user  ON pilotage(user_id, semaine);

-- ── TRIGGER updated_at ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','clients','ventes','pilotage','actions_correctives']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_upd ON %1$s;
       CREATE TRIGGER trg_%1$s_upd
       BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
