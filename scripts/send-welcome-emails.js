/**
 * send-welcome-emails.js
 * Envoie les emails de bienvenue avec identifiants à tous les comptes rizier + support.
 * Usage :
 *   GMAIL_USER=xxx@gmail.com GMAIL_APP_PASSWORD=xxxx node scripts/send-welcome-emails.js
 *
 * Variables d'environnement requises (en plus du .env existant) :
 *   GMAIL_USER         — ton adresse Gmail
 *   GMAIL_APP_PASSWORD — mot de passe d'application Gmail (16 caractères)
 *   FRONTEND_URL       — URL de la plateforme (défaut : https://pfs-frontend.onrender.com)
 *   DRY_RUN            — si "true", affiche les emails sans les envoyer
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs            = require('fs');
const path          = require('path');
const { Pool }      = require('pg');
const nodemailer    = require('nodemailer');

const LOGO_PATH = path.join(__dirname, '..', 'pfs-frontend', 'src', 'assets', 'pfs-logo.png');

const GMAIL_USER     = process.env.GMAIL_USER;
const GMAIL_PASS     = process.env.GMAIL_APP_PASSWORD;
const FRONTEND_URL   = (process.env.FRONTEND_URL || 'https://pfs-frontend.onrender.com').replace('/admin', '');
const DRY_RUN        = process.env.DRY_RUN === 'true';

if (!DRY_RUN && (!GMAIL_USER || !GMAIL_PASS)) {
  console.error('❌  GMAIL_USER et GMAIL_APP_PASSWORD requis.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Template HTML ──────────────────────────────────────────────────────────────
function buildEmail({ nom, email, role }) {
  const isSupport = role === 'support';
  const roleLabel = isSupport ? 'Support PFS' : 'Responsable Rizerie';
  const intro     = isSupport
    ? `Vous avez été ajouté(e) en tant que membre de l'équipe support sur la plateforme <strong>RIZAO Cockpit</strong> de Partners in Food Solutions.`
    : `Votre rizerie a été enregistrée sur la plateforme <strong>RIZAO Cockpit</strong> de Partners in Food Solutions. Vous pouvez dès maintenant accéder à votre espace.`;

  const subject = isSupport
    ? 'Votre accès au Cockpit Commercial – PFS Support'
    : `Votre accès au Cockpit Commercial – ${nom}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Accès RIZAO Cockpit</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1a5c38;padding:28px 40px;text-align:center;">
            <img src="cid:pfslogo" alt="PFS" width="120" style="display:block;margin:0 auto 12px;max-width:120px;" />
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Cockpit Commercial</h1>
            <p style="margin:6px 0 0;color:#a8d5b5;font-size:13px;">Partners in Food Solutions</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;color:#333;font-size:15px;">Bonjour <strong>${nom}</strong>,</p>
            <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">${intro}</p>

            <!-- Credentials box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f3;border:1px solid #c8e6d0;border-radius:6px;margin:0 0 28px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 6px;color:#1a5c38;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Vos identifiants de connexion</p>
                  <table cellpadding="0" cellspacing="0" style="margin-top:12px;">
                    <tr>
                      <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Adresse email :</td>
                      <td style="color:#222;font-size:14px;font-weight:600;">${email}</td>
                    </tr>
                    <tr>
                      <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Mot de passe :</td>
                      <td style="color:#222;font-size:14px;font-weight:600;">${email}</td>
                    </tr>
                    <tr>
                      <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Rôle :</td>
                      <td style="color:#222;font-size:14px;">${roleLabel}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#1a5c38;border-radius:6px;">
                  <a href="${FRONTEND_URL}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                    Accéder à la plateforme →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;border-top:1px solid #eee;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:#999;font-size:12px;">
              Partners in Food Solutions · Cockpit Commercial<br/>
              Si vous n'attendiez pas cet email, vous pouvez l'ignorer.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const { rows } = await pool.query(`
    SELECT nom, email, role FROM users
    WHERE role IN ('rizier', 'support')
    ORDER BY role, nom
  `);

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Envoi des emails à ${rows.length} comptes...\n`);

  let ok = 0, fail = 0;

  for (const user of rows) {
    const { subject, html } = buildEmail(user);

    if (DRY_RUN) {
      console.log(`[DRY] ${user.role.padEnd(8)} ${user.nom.padEnd(35)} → ${user.email}`);
      ok++;
      continue;
    }

    try {
      await transporter.sendMail({
        from:    `"PFS Cockpit Commercial" <${GMAIL_USER}>`,
        to:      user.email,
        subject,
        html,
        attachments: [{ filename: 'pfs-logo.png', path: LOGO_PATH, cid: 'pfslogo' }],
      });
      console.log(`✓ ${user.role.padEnd(8)} ${user.nom.padEnd(35)} → ${user.email}`);
      ok++;
      // Petite pause pour éviter le rate limit Gmail (500 emails/jour max)
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`✗ ${user.nom.padEnd(35)} → ${user.email} — ${err.message}`);
      fail++;
    }
  }

  console.log(`\n✓ ${ok} envoyés  ✗ ${fail} échoués\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
