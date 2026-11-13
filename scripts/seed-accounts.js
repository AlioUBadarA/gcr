/**
 * seed-accounts.js
 * Crée les comptes rizeries + utilisateurs rizier pour chaque entreprise partenaire,
 * et les comptes support pour l'équipe PFS.
 * Idempotent : ignore les doublons (email déjà existant).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Données entreprises ───────────────────────────────────────────────────────
// 1 rizerie + 1 compte rizier par entreprise.
// Login = email du manager, mdp = email du manager.
const ENTERPRISES = [
  { nom: 'AZ Nature',                       pays: 'TG',           cluster: 'D', manager: { nom: 'Hovo Yao Ziggar',               email: 'aznaturebio@gmail.com' } },
  { nom: 'Al Mactom',                        pays: 'SN',        cluster: 'D', manager: { nom: 'Cheikhou Kane',                  email: 'kkane247@gmail.com' } },
  { nom: 'Cafrex',                           pays: 'CI',  cluster: 'A', manager: { nom: 'Bouake Sangare',                 email: 'sangare.cafrex@gmail.com' } },
  { nom: 'Capi',                             pays: 'CI',  cluster: 'C', manager: { nom: 'Sarah Kone',                    email: 'capidaloa@gmail.com' } },
  { nom: 'Casa Art Suarl',                   pays: 'SN',        cluster: 'A', manager: { nom: 'Abdourahmane Diallo',            email: 'casartgroup221@gmail.com' } },
  { nom: 'Coop Kamano EDD',                  pays: 'SN',        cluster: 'C', manager: { nom: 'Bassirou Coly',                  email: 'lycobass@yahoo.fr' } },
  { nom: 'Coumba Nor Thiam',                 pays: 'SN',        cluster: 'D', manager: { nom: 'Oumar Diop',                    email: 'oumardiopcntsuarl@gmail.com' } },
  { nom: 'Esop Adja Ouere',                  pays: 'BJ',          cluster: 'A', manager: { nom: 'Dominique Tovizounkou',          email: 'mindetinmin@gmail.com' } },
  { nom: 'Esop Vallée',                      pays: 'BJ',          cluster: 'B', manager: { nom: 'Jules Avoce',                   email: 'esopvallee@gmail.com' } },
  { nom: 'GFSAI unirice',                    pays: 'SN',        cluster: 'B', manager: { nom: 'Marie Niang',                   email: 'marierassoulniang@gmail.com' } },
  { nom: 'Gie El Hadji Abdou Aziz Sy Dabakh',pays: 'SN',        cluster: 'D', manager: { nom: 'Sokhna Mbodji',                 email: 'mbodjsokhna95@gmail.com' } },
  { nom: 'Gie Lam Toro',                     pays: 'SN',        cluster: 'C', manager: { nom: 'Codou Diop',                    email: 'codiop65@gmail.com' } },
  { nom: 'Gie Xaritou Dieukerame',           pays: 'SN',        cluster: 'D', manager: { nom: 'Asta Diagne',                   email: 'diagneasta98@gmail.com' } },
  { nom: 'Locagri',                          pays: 'CI',  cluster: 'D', manager: { nom: 'Danielle Kouakou',              email: 'danielle.kouakou@locagri.com' } },
  { nom: 'Mintou Rassoul',                   pays: 'SN',        cluster: 'B', manager: { nom: 'Makhtar Seck',                  email: 'djmatar017@gmail.com' } },
  { nom: 'Moulins blancs',                   pays: 'CI',  cluster: 'D', manager: { nom: 'Mamadou Diaby',                 email: 'mamadoudiaby174@gmail.com' } },
  { nom: "Rizerie N'zara SAS",               pays: 'TG',           cluster: 'D', manager: { nom: 'Bagoun Wonworgou',              email: 'rizerienzarasas@gmail.com' } },
  { nom: 'Rizerie Soutouboua',               pays: 'TG',           cluster: 'C', manager: { nom: 'Mazibèdong Wiyaou',             email: 'rizeriesotouboua@gmail.com' } },
  { nom: 'Rizerie Tone',                     pays: 'TG',           cluster: 'B', manager: { nom: 'Name Lene',                     email: 'rizerietone@gmail.com' } },
  { nom: 'SORIZ',                            pays: 'BJ',          cluster: 'D', manager: { nom: 'Benjamin Toulou',               email: 'bentoulou@hotmail.com' } },
  { nom: 'Sanar Agro',                       pays: 'SN',        cluster: 'C', manager: { nom: 'Maimouna Diop',                 email: 'maimounamdiop@gmail.com' } },
  { nom: 'Scoop womiengnonon',               pays: 'CI',  cluster: 'D', manager: { nom: 'Fatogoma Yeo',                  email: 'womiengnonon@gmail.com' } },
  { nom: 'Simapres',                         pays: 'CI',  cluster: 'A', manager: { nom: 'Kadokan Inza Yeo',              email: 'simapres.infos@gmail.com' } },
  { nom: 'Sina Distribution',                pays: 'SN',        cluster: 'C', manager: { nom: 'Ndeye Sine Touré',              email: 'ndeyesine.toure1078@gmail.com' } },
  { nom: 'Sipriz',                           pays: 'CI',  cluster: 'B', manager: { nom: 'Aaron Ibrahima Komara',         email: 'ibrahim.aaronkomara@gmail.com' } },
  { nom: 'Soaida',                           pays: 'CI',  cluster: 'C', manager: { nom: 'Aboudolaye Soro',               email: 'infos.soaida.ci@gmail.com' } },
  { nom: 'Socomci',                          pays: 'CI',  cluster: 'A', manager: { nom: 'Gilles Caron',                  email: 'g.caron@socomci-ci.com' } },
  { nom: 'URFER-C',                          pays: 'BJ',          cluster: 'A', manager: { nom: 'Augustine Agbanrin',            email: 'agbanrinaugustine697@gmail.com' } },
  { nom: 'Vabhekos',                         pays: 'TG',           cluster: 'D', manager: { nom: 'Kossivi Ametana',               email: 'vabhekosrizlapaix@gmail.com' } },
];

// ── Comptes support PFS ───────────────────────────────────────────────────────
const PFS_SUPPORT = [
  { nom: 'Caroline Bamba',       email: 'caroline@partnersinfoodsolutions.com' },
  { nom: 'Frank Bentum',         email: 'frank@partnersinfoodsolutions.com' },
  { nom: 'Gloria Buah-Kwofie',   email: 'gloriab@partnersinfoodsolutions.com' },
  { nom: 'Ibrahima Sory Diallo', email: 'ibrahima@partnersinfoodsolutions.com' },
  { nom: 'Ndeye Marie Ngom',     email: 'ndeye@partnersinfoodsolutions.com' },
  { nom: 'Fabienne Secka Koffi', email: 'fabiennes@partnersinfoodsolutions.com' },
  { nom: 'Fabienne Vuanda',      email: 'fabienne@partnersinfoodsolutions.com' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function upsertRizerie(client, nom, pays) {
  const existing = await client.query(
    'SELECT id FROM rizeries WHERE LOWER(nom) = LOWER($1)',
    [nom]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const res = await client.query(
    'INSERT INTO rizeries (nom, pays) VALUES ($1, $2) RETURNING id',
    [nom, pays]
  );
  return res.rows[0].id;
}

async function createRizierAccount(client, rizerieId, rizerieNom, manager) {
  const email = manager.email.toLowerCase().trim();

  const existing = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    return { status: 'skipped', email };
  }

  const hash = await bcrypt.hash(email, 12);
  await client.query(
    `INSERT INTO users (nom, email, password, rizerie, rizerie_id, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5, 'rizier', TRUE)`,
    [manager.nom, email, hash, rizerieNom, rizerieId]
  );
  return { status: 'created', email };
}

async function createSupportAccount(client, person) {
  const email = person.email.toLowerCase().trim();

  const existing = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    return { status: 'skipped', email };
  }

  const hash = await bcrypt.hash(email, 12);
  await client.query(
    `INSERT INTO users (nom, email, password, role, must_change_password)
     VALUES ($1, $2, $3, 'support', TRUE)`,
    [person.nom, email, hash]
  );
  return { status: 'created', email };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('\n=== CRÉATION DES COMPTES RIZERIES ===\n');

    for (const enterprise of ENTERPRISES) {
      const rizerieId = await upsertRizerie(client, enterprise.nom, enterprise.pays);
      const result    = await createRizierAccount(client, rizerieId, enterprise.nom, enterprise.manager);

      const icon = result.status === 'created' ? '✓' : '⊘';
      const label = result.status === 'created' ? 'créé' : 'déjà existant';
      console.log(`${icon} [${enterprise.cluster}] ${enterprise.nom.padEnd(40)} → ${result.email} (${label})`);
    }

    console.log('\n=== CRÉATION DES COMPTES SUPPORT PFS ===\n');

    for (const person of PFS_SUPPORT) {
      const result = await createSupportAccount(client, person);
      const icon   = result.status === 'created' ? '✓' : '⊘';
      const label  = result.status === 'created' ? 'créé' : 'déjà existant';
      console.log(`${icon} ${person.nom.padEnd(30)} → ${result.email} (${label})`);
    }

    await client.query('COMMIT');

    console.log('\n=== TERMINÉ ===\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERREUR — rollback effectué :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
