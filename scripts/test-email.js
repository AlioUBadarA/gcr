require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

const LOGO_PATH = path.join(__dirname, '..', 'pfs-frontend', 'src', 'assets', 'pfs-logo.png');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

const email = process.env.GMAIL_USER;

transporter.sendMail({
  from: `"PFS Cockpit Commercial" <${email}>`,
  to:   email,
  subject: '[TEST] Votre accès au Cockpit Commercial – PFS',
  html: `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a5c38;padding:28px 40px;text-align:center;">
            <img src="cid:pfslogo" alt="PFS" width="120" style="display:block;margin:0 auto 12px;max-width:120px;" />
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Cockpit Commercial</h1>
            <p style="margin:6px 0 0;color:#a8d5b5;font-size:13px;">Partners in Food Solutions</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="color:#333;font-size:15px;">Bonjour <strong>Aliou Badar</strong>,</p>
            <p style="color:#555;font-size:15px;line-height:1.6;">
              Votre rizerie a été enregistrée sur le Cockpit Commercial de Partners in Food Solutions.
              Vous pouvez dès maintenant accéder à votre espace.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f3;border:1px solid #c8e6d0;border-radius:6px;margin:24px 0 28px;">
              <tr><td style="padding:24px 28px;">
                <p style="margin:0 0 12px;color:#1a5c38;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Vos identifiants de connexion</p>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Adresse email :</td>
                    <td style="color:#222;font-size:14px;font-weight:600;">badousadia0104@gmail.com</td>
                  </tr>
                  <tr>
                    <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Mot de passe :</td>
                    <td style="color:#222;font-size:14px;font-weight:600;">badousadia0104@gmail.com</td>
                  </tr>
                  <tr>
                    <td style="color:#777;font-size:13px;padding:4px 16px 4px 0;white-space:nowrap;">Rôle :</td>
                    <td style="color:#222;font-size:14px;">Responsable Rizerie</td>
                  </tr>
                </table>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#1a5c38;border-radius:6px;">
                  <a href="https://pfs-frontend.onrender.com" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                    Accéder à la plateforme &rarr;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;border-top:1px solid #eee;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:#999;font-size:12px;">Partners in Food Solutions &middot; Cockpit Commercial<br/>Si vous n'attendiez pas cet email, vous pouvez l'ignorer.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  attachments: [{
    filename: 'pfs-logo.png',
    path:     LOGO_PATH,
    cid:      'pfslogo',
  }],
}).then(r => {
  console.log('✓ Email de test envoyé !');
  console.log('  MessageId :', r.messageId);
}).catch(e => {
  console.error('✗ Erreur :', e.message);
});
