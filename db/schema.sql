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
  zone             VARCHAR(100),
  role             VARCHAR(20) NOT NULL DEFAULT 'rizier' CHECK (role IN ('rizier','superadmin')),
  suspended        BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at     TIMESTAMPTZ,
  suspended_reason TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations idempotentes pour bases existantes
ALTER TABLE users ADD COLUMN IF NOT EXISTS role             VARCHAR(20) NOT NULL DEFAULT 'rizier';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id        UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS zone             VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Étend la contrainte role pour inclure vendeur, support, puis manager
DO $$
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
END $$;

-- ── RIZERIES (entités commerciales) ─────────────────────────
CREATE TABLE IF NOT EXISTS rizeries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         VARCHAR(150) NOT NULL,
  pays        VARCHAR(80),
  region      VARCHAR(100),
  ville       VARCHAR(80),
  telephone   VARCHAR(30),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS rizerie_id UUID REFERENCES rizeries(id) ON DELETE SET NULL;

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
  region       VARCHAR(100),
  source       VARCHAR(50),
  telephone    VARCHAR(30),
  statut       VARCHAR(40) NOT NULL DEFAULT 'Nouveau'
               CHECK (statut IN ('Nouveau','Qualifié','Proposition','Négociation','Gagné','Perdu')),
  priorite     VARCHAR(20) DEFAULT 'Normale'
               CHECK (priorite IN ('Haute','Normale','Basse')),
  date_contact DATE,
  note         TEXT,
  valeur_estimee NUMERIC(14,2) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE prospection ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE prospection ADD COLUMN IF NOT EXISTS source VARCHAR(50);

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
  region      VARCHAR(100),
  segment     VARCHAR(100),
  potentiel_annuel NUMERIC(14,2) DEFAULT 0,
  telephone   VARCHAR(30),
  volume_estime NUMERIC(10,2) DEFAULT 0,
  frequence   VARCHAR(50),
  valorise    VARCHAR(200),
  horaire     VARCHAR(80),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS segment VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS potentiel_annuel NUMERIC(14,2) DEFAULT 0;

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
  mode        VARCHAR(20) CHECK (mode IN ('Espèces','Virement','Chèque','Mobile Money')),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS mode VARCHAR(20);

-- ── VERSEMENTS (paiements échelonnés sur une vente) ───────────
CREATE TABLE IF NOT EXISTS versements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id    UUID NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  montant     NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  mode        VARCHAR(20) CHECK (mode IN ('Espèces','Virement','Chèque','Mobile Money')),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versements_vente ON versements(vente_id);

-- ── RELANCES (suivi du recouvrement) ──────────────────────────
CREATE TABLE IF NOT EXISTS relances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id    UUID NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_relances_vente ON relances(vente_id);

-- ── PRODUITS (catalogue gamme riz : prix/coût/tendance) ───────
CREATE TABLE IF NOT EXISTS produits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref         VARCHAR(40) NOT NULL,
  nom         VARCHAR(100) NOT NULL,
  prix_kg     NUMERIC(10,2) DEFAULT 0,
  cout_kg     NUMERIC(10,2) DEFAULT 0,
  tendance    VARCHAR(20) DEFAULT 'stable' CHECK (tendance IN ('hausse','stable','déclin')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ref)
);

-- ── ACTIVITÉS (journal terrain) ───────────────────────────────
CREATE TABLE IF NOT EXISTS activites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  type        VARCHAR(30) NOT NULL CHECK (type IN (
                'Visite client','Appel','Réunion','Démonstration',
                'Négociation','Relance','Contrat signé')),
  cible       VARCHAR(150),
  resultat    VARCHAR(20) DEFAULT 'Neutre' CHECK (resultat IN ('Positif','Négatif','Neutre')),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activites_user ON activites(user_id, date DESC);

-- ── ALERTES TRAITÉES (état persistant, remplace le localStorage) ─
CREATE TABLE IF NOT EXISTS alertes_traitees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alerte_key  VARCHAR(300) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, alerte_key)
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

-- ── PILOTAGE : VISITES PLANIFIÉES (plusieurs par jour) ────────
CREATE TABLE IF NOT EXISTS pilotage_visites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semaine     VARCHAR(30) NOT NULL,
  jour        VARCHAR(15) NOT NULL CHECK (jour IN (
                'Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi')),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES prospection(id) ON DELETE CASCADE,
  commentaire TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pilotage_visites_user ON pilotage_visites(user_id, semaine, jour);

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

-- ── Produits suivis par client ────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS produits_interet TEXT[] DEFAULT '{}';

-- ── Numéro de transaction (identification vente/contrat) ───────
ALTER TABLE ventes           ADD COLUMN IF NOT EXISTS numero VARCHAR(20);
ALTER TABLE contrats_clients ADD COLUMN IF NOT EXISTS numero VARCHAR(20);
ALTER TABLE contrats_paddy   ADD COLUMN IF NOT EXISTS numero VARCHAR(20);

-- Backfill des transactions existantes sans numéro (idempotent : ne touche que NULL)
WITH numbered AS (
  SELECT id, 'V-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
         LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
  FROM ventes WHERE numero IS NULL
)
UPDATE ventes v SET numero = n.num FROM numbered n WHERE v.id = n.id;

WITH numbered AS (
  SELECT id, 'CC-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
         LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
  FROM contrats_clients WHERE numero IS NULL
)
UPDATE contrats_clients c SET numero = n.num FROM numbered n WHERE c.id = n.id;

WITH numbered AS (
  SELECT id, 'CP-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
         LPAD(ROW_NUMBER() OVER (PARTITION BY user_id, EXTRACT(YEAR FROM created_at) ORDER BY created_at)::TEXT, 4, '0') AS num
  FROM contrats_paddy WHERE numero IS NULL
)
UPDATE contrats_paddy c SET numero = n.num FROM numbered n WHERE c.id = n.id;

-- ── Versements : permettre de rattacher un encaissement à une vente OU un contrat client ──
ALTER TABLE versements ALTER COLUMN vente_id DROP NOT NULL;
ALTER TABLE versements ADD COLUMN IF NOT EXISTS contrat_client_id UUID REFERENCES contrats_clients(id) ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE versements ADD CONSTRAINT versements_one_target_check
    CHECK (num_nonnulls(vente_id, contrat_client_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_versements_contrat_client ON versements(contrat_client_id);

-- ── Rizeries : photo de départ (emplois/masse salariale/CA) pour suivre l'évolution ──
ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS emplois_baseline INT DEFAULT 0;
ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS masse_salariale_baseline NUMERIC(14,2) DEFAULT 0;
ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS ca_baseline NUMERIC(14,2) DEFAULT 0;
ALTER TABLE rizeries ADD COLUMN IF NOT EXISTS baseline_date DATE DEFAULT CURRENT_DATE;

-- Periode RIZAO sur les emplois : 'Avant RIZAO' ou 'Avec RIZAO' (défaut)
ALTER TABLE emplois ADD COLUMN IF NOT EXISTS periode_rizao VARCHAR(20) DEFAULT 'Avec RIZAO'
  CHECK (periode_rizao IN ('Avant RIZAO', 'Avec RIZAO'));
