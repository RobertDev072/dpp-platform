const { getPool } = require("../config/db");
const { HttpError } = require("../middleware/errorHandler");
const invitesRepo = require("../repositories/invites.repository");

// Bedrijf + eerste beheerder in één keer (één databasetransactie): of alles bestaat
// daarna, of niets. De beheerder krijgt een activatielink (48 uur, eenmalig) en kiest
// zelf een wachtwoord; er wordt geen tijdelijk wachtwoord uitgegeven.
//
//   Platform Owner → partner + eerste Partner Admin   (kind "partner", role partner_admin)
//   Partner Admin  → klantbedrijf + eerste Company Admin (kind "customer", role company_admin)
//
// Dubbel indienen: de slug is uniek, dus een tweede inzending met dezelfde gegevens geeft
// 409 en maakt niets aan. Een e-mailadres dat al een account heeft, wordt geweigerd.

function fieldError(field, message, status = 409) {
  return new HttpError(status, "Ongeldige invoer", { formErrors: [], fieldErrors: { [field]: [message] } });
}

async function createCompanyWithAdmin({ company, admin, adminRole, invitedBy }) {
  const pool = await getPool();
  const email = admin.email.trim();
  const taken = await pool.query("SELECT 1 FROM dbo.users WHERE lower(email) = lower($1)", [email]);
  if (taken.rows.length) throw fieldError("adminEmail", "Dit e-mailadres heeft al een VeriPasso-account");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let created;
    try {
      created = (
        await client.query(
          `INSERT INTO dbo.companies (name, slug, plan_id, status, kind, partner_id, license_start, license_end)
           VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
           RETURNING id, name, slug, status, plan_id, kind, partner_id, license_start, license_end, created_at, updated_at`,
          [
            company.name.trim(),
            company.slug,
            company.planId ?? null,
            company.kind,
            company.partnerId ?? null,
            company.licenseStart ?? null,
            company.licenseEnd ?? null
          ]
        )
      ).rows[0];
    } catch (error) {
      if (error.code === "23505") throw fieldError("slug", "Deze slug is al in gebruik (bestaat dit bedrijf al?)");
      throw error;
    }
    const { invite, token } = await invitesRepo.createInvite(
      {
        companyId: created.id,
        email,
        firstName: admin.firstName?.trim() || null,
        lastName: admin.lastName?.trim() || null,
        invitedBy,
        role: adminRole
      },
      client
    );
    await client.query("COMMIT");
    return { company: created, invite, token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createCompanyWithAdmin };
