-- ============================================================
-- seed-accounts.sql
-- Crée les rizeries + comptes rizier (1 par entreprise)
-- et les comptes support PFS.
-- Idempotent : ignore les doublons.
-- Login = email (lowercase), mot de passe = email (lowercase)
-- Exécuter via : psql $DATABASE_URL -f scripts/seed-accounts.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_id   UUID;
  v_nom  TEXT;
  v_pays TEXT;
  v_email TEXT;
  v_manager TEXT;
BEGIN

-- ──────────────────────────────────────────────────────────────
-- ENTREPRISES : 1 rizerie + 1 compte rizier
-- ──────────────────────────────────────────────────────────────

-- AZ Nature ────────────────────────────────────────────────────
  v_nom := 'AZ Nature'; v_pays := 'Togo'; v_manager := 'Hovo Yao Ziggar'; v_email := 'aznaturebio@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Al Mactom ────────────────────────────────────────────────────
  v_nom := 'Al Mactom'; v_pays := 'Sénégal'; v_manager := 'Cheikhou Kane'; v_email := 'kkane247@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Cafrex ───────────────────────────────────────────────────────
  v_nom := 'Cafrex'; v_pays := 'Côte d''Ivoire'; v_manager := 'Bouake Sangare'; v_email := 'sangare.cafrex@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Capi ─────────────────────────────────────────────────────────
  v_nom := 'Capi'; v_pays := 'Côte d''Ivoire'; v_manager := 'Sarah Kone'; v_email := 'capidaloa@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Casa Art Suarl ───────────────────────────────────────────────
  v_nom := 'Casa Art Suarl'; v_pays := 'Sénégal'; v_manager := 'Abdourahmane Diallo'; v_email := 'casartgroup221@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Coop Kamano EDD ──────────────────────────────────────────────
  v_nom := 'Coop Kamano EDD'; v_pays := 'Sénégal'; v_manager := 'Bassirou Coly'; v_email := 'lycobass@yahoo.fr';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Coumba Nor Thiam ─────────────────────────────────────────────
  v_nom := 'Coumba Nor Thiam'; v_pays := 'Sénégal'; v_manager := 'Oumar Diop'; v_email := 'oumardiopcntsuarl@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Esop Adja Ouere ──────────────────────────────────────────────
  v_nom := 'Esop Adja Ouere'; v_pays := 'Bénin'; v_manager := 'Dominique Tovizounkou'; v_email := 'mindetinmin@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Esop Vallée ──────────────────────────────────────────────────
  v_nom := 'Esop Vallée'; v_pays := 'Bénin'; v_manager := 'Jules Avoce'; v_email := 'esopvallee@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- GFSAI unirice ────────────────────────────────────────────────
  v_nom := 'GFSAI unirice'; v_pays := 'Sénégal'; v_manager := 'Marie Niang'; v_email := 'marierassoulniang@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Gie El Hadji Abdou Aziz Sy Dabakh ───────────────────────────
  v_nom := 'Gie El Hadji Abdou Aziz Sy Dabakh'; v_pays := 'Sénégal'; v_manager := 'Sokhna Mbodji'; v_email := 'mbodjsokhna95@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Gie Lam Toro ─────────────────────────────────────────────────
  v_nom := 'Gie Lam Toro'; v_pays := 'Sénégal'; v_manager := 'Codou Diop'; v_email := 'codiop65@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Gie Xaritou Dieukerame ───────────────────────────────────────
  v_nom := 'Gie Xaritou Dieukerame'; v_pays := 'Sénégal'; v_manager := 'Asta Diagne'; v_email := 'diagneasta98@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Locagri ──────────────────────────────────────────────────────
  v_nom := 'Locagri'; v_pays := 'Côte d''Ivoire'; v_manager := 'Danielle Kouakou'; v_email := 'danielle.kouakou@locagri.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Mintou Rassoul ───────────────────────────────────────────────
  v_nom := 'Mintou Rassoul'; v_pays := 'Sénégal'; v_manager := 'Makhtar Seck'; v_email := 'djmatar017@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Moulins blancs ───────────────────────────────────────────────
  v_nom := 'Moulins blancs'; v_pays := 'Côte d''Ivoire'; v_manager := 'Mamadou Diaby'; v_email := 'mamadoudiaby174@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Rizerie N'zara SAS ───────────────────────────────────────────
  v_nom := 'Rizerie N''zara SAS'; v_pays := 'Togo'; v_manager := 'Bagoun Wonworgou'; v_email := 'rizerienzarasas@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Rizerie Soutouboua ───────────────────────────────────────────
  v_nom := 'Rizerie Soutouboua'; v_pays := 'Togo'; v_manager := 'Mazibèdong Wiyaou'; v_email := 'rizeriesotouboua@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Rizerie Tone ─────────────────────────────────────────────────
  v_nom := 'Rizerie Tone'; v_pays := 'Togo'; v_manager := 'Name Lene'; v_email := 'rizerietone@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- SORIZ ────────────────────────────────────────────────────────
  v_nom := 'SORIZ'; v_pays := 'Bénin'; v_manager := 'Benjamin Toulou'; v_email := 'bentoulou@hotmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Sanar Agro ───────────────────────────────────────────────────
  v_nom := 'Sanar Agro'; v_pays := 'Sénégal'; v_manager := 'Maimouna Diop'; v_email := 'maimounamdiop@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Scoop womiengnonon ───────────────────────────────────────────
  v_nom := 'Scoop womiengnonon'; v_pays := 'Côte d''Ivoire'; v_manager := 'Fatogoma Yeo'; v_email := 'womiengnonon@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Simapres ─────────────────────────────────────────────────────
  v_nom := 'Simapres'; v_pays := 'Côte d''Ivoire'; v_manager := 'Kadokan Inza Yeo'; v_email := 'simapres.infos@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Sina Distribution ────────────────────────────────────────────
  v_nom := 'Sina Distribution'; v_pays := 'Sénégal'; v_manager := 'Ndeye Sine Touré'; v_email := 'ndeyesine.toure1078@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Sipriz ───────────────────────────────────────────────────────
  v_nom := 'Sipriz'; v_pays := 'Côte d''Ivoire'; v_manager := 'Aaron Ibrahima Komara'; v_email := 'ibrahim.aaronkomara@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Soaida ───────────────────────────────────────────────────────
  v_nom := 'Soaida'; v_pays := 'Côte d''Ivoire'; v_manager := 'Aboudolaye Soro'; v_email := 'infos.soaida.ci@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Socomci ──────────────────────────────────────────────────────
  v_nom := 'Socomci'; v_pays := 'Côte d''Ivoire'; v_manager := 'Gilles Caron'; v_email := 'g.caron@socomci-ci.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- URFER-C ──────────────────────────────────────────────────────
  v_nom := 'URFER-C'; v_pays := 'Bénin'; v_manager := 'Augustine Agbanrin'; v_email := 'agbanrinaugustine697@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- Vabhekos ─────────────────────────────────────────────────────
  v_nom := 'Vabhekos'; v_pays := 'Togo'; v_manager := 'Kossivi Ametana'; v_email := 'vabhekosrizlapaix@gmail.com';
  INSERT INTO rizeries (nom, pays) SELECT v_nom, v_pays WHERE NOT EXISTS (SELECT 1 FROM rizeries WHERE LOWER(nom)=LOWER(v_nom));
  SELECT id INTO v_id FROM rizeries WHERE LOWER(nom)=LOWER(v_nom);
  INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
    VALUES (v_manager, v_email, crypt(v_email, gen_salt('bf',12)), v_nom, v_id, 'rizier', TRUE)
    ON CONFLICT (email) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- COMPTES SUPPORT PFS
-- ──────────────────────────────────────────────────────────────

  v_email := 'caroline@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Caroline Bamba', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'frank@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Frank Bentum', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'gloriab@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Gloria Buah-Kwofie', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'ibrahima@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Ibrahima Sory Diallo', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'ndeye@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Ndeye Marie Ngom', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'fabiennes@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Fabienne Secka Koffi', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

  v_email := 'fabienne@partnersinfoodsolutions.com';
  INSERT INTO users (nom, email, password, role, must_change_password)
    VALUES ('Fabienne Vuanda', v_email, crypt(v_email, gen_salt('bf',12)), 'support', TRUE)
    ON CONFLICT (email) DO NOTHING;

END $$;
