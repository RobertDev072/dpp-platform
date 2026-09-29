const nodemailer = require("nodemailer");

// E-mail via een gratis SMTP-dienst (bijv. Brevo, 300 mails/dag gratis) met het
// eigen domein. Bewust optioneel: zonder SMTP_*-instellingen doet de app niets en
// blijft de bestaande handmatige flow (link kopiëren) gewoon werken.
const REQUIRED_VARS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];

function isMailConfigured() {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    await getTransporter().sendMail({ from: process.env.MAIL_FROM, to, subject, text, html });
    return { sent: true };
  } catch (error) {
    // Nooit de flow blokkeren op een mailstoring; de aanroeper toont de link als vangnet.
    console.error("E-mail versturen mislukt:", error.message);
    return { sent: false, reason: "send_failed" };
  }
}

function inviteEmail({ companyName, activationUrl, expiresAt }) {
  const verloopt = new Date(expiresAt).toLocaleString("nl-NL", {
    dateStyle: "long",
    timeStyle: "short"
  });
  const subject = `Uitnodiging: beheer ${companyName} op VeriPasso`;
  const text =
    `Je bent uitgenodigd als Company Admin voor ${companyName} op VeriPasso.\n\n` +
    `Activeer je account via deze link (geldig tot ${verloopt}):\n${activationUrl}\n\n` +
    `Na activatie stel je zelf een wachtwoord in.\n\n` +
    `Verwachtte je deze uitnodiging niet? Dan kun je deze e-mail negeren.`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="color:#059669">VeriPasso</h2>
      <p>Je bent uitgenodigd als <strong>Company Admin</strong> voor <strong>${companyName}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${activationUrl}"
           style="background:#059669;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">
          Account activeren
        </a>
      </p>
      <p style="font-size:13px;color:#475569">Deze link is geldig tot <strong>${verloopt}</strong>. Na activatie stel je zelf een wachtwoord in.</p>
      <p style="font-size:12px;color:#94a3b8">Verwachtte je deze uitnodiging niet? Dan kun je deze e-mail negeren.</p>
    </div>`;
  return { subject, text, html };
}

module.exports = { isMailConfigured, sendMail, inviteEmail };
