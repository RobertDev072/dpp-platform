const crypto = require("crypto");
const { getPool, sql } = require("../config/db");

// Activatielink: 48 uur geldig (beveiligingsbeleid), eenmalig, alleen de SHA-256-hash
// van het token staat in de database. Het token zelf staat alleen in het antwoord aan
// degene die de link uitgeeft (geen e-mail, zie docs/accounts.md).
const INVITE_DURATION_MS = 48 * 60 * 60 * 1000;
const INVITE_COLUMNS = "id, company_id, email, first_name, last_name, role, status, expires_at, accepted_at, created_at";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Nieuwe activatielink. Een eerdere openstaande link voor hetzelfde bedrijf en e-mailadres
// wordt in dezelfde transactie ingetrokken (alleen de nieuwste werkt).
// db: optionele pg-client binnen een lopende transactie (bijv. bedrijf + beheerder in één keer).
async function createInvite({ companyId, email, firstName, lastName, invitedBy, role = "company_admin" }, db = null) {
  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_DURATION_MS);
  const run = async (client) => {
    await client.query(
      "UPDATE dbo.companyadmininvites SET status = 'revoked' WHERE company_id = $1 AND lower(email) = lower($2) AND status = 'pending'",
      [companyId, email]
    );
    const result = await client.query(
      `INSERT INTO dbo.companyadmininvites
         (company_id, email, first_name, last_name, token_hash, invited_by, expires_at, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${INVITE_COLUMNS}`,
      [companyId, email, firstName ?? null, lastName ?? null, tokenHash, invitedBy ?? null, expiresAt, role]
    );
    return result.rows[0];
  };

  if (db) return { invite: await run(db), token };
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invite = await run(client);
    await client.query("COMMIT");
    return { invite, token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Eenmalig gebruik, atomair: alleen een openstaande, niet-verlopen link kan worden
// geclaimd. Twee gelijktijdige activaties: er wint er precies één.
async function claimInvite(id) {
  const pool = await getPool();
  const result = await pool.query(
    `UPDATE dbo.companyadmininvites SET status = 'accepted', accepted_at = now()
     WHERE id = $1 AND status = 'pending' AND expires_at > now()
     RETURNING ${INVITE_COLUMNS}`,
    [id]
  );
  return result.rows[0] || null;
}

// Terugdraaien als het account na het claimen toch niet aangemaakt kon worden.
async function releaseInvite(id) {
  const pool = await getPool();
  await pool.query("UPDATE dbo.companyadmininvites SET status = 'pending', accepted_at = NULL WHERE id = $1 AND status = 'accepted'", [id]);
}

async function listInvitesForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT id, company_id, email, first_name, last_name, status, expires_at, accepted_at, created_at
      FROM dbo.CompanyAdminInvites
      WHERE company_id = @companyId
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

// Alle uitnodigingen van de klantbedrijven van één partner (voor het
// partnerbrede Uitnodigingen-overzicht), inclusief de klantnaam.
async function listInvitesForPartner(partnerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("partnerId", sql.Int, partnerId)
    .query(`
      SELECT i.id, i.company_id, c.name AS company_name, i.email, i.first_name, i.last_name,
             i.status, i.expires_at, i.accepted_at, i.created_at
      FROM dbo.CompanyAdminInvites i
      JOIN dbo.Companies c ON c.id = i.company_id
      WHERE c.partner_id = @partnerId
      ORDER BY i.created_at DESC
    `);
  return result.recordset;
}

async function getInviteById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT id, company_id, email, first_name, last_name, status, expires_at, accepted_at, created_at
      FROM dbo.CompanyAdminInvites
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function getInviteByToken(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(token))
    .query(`
      SELECT id, company_id, email, first_name, last_name, role, status, expires_at, accepted_at, created_at
      FROM dbo.CompanyAdminInvites
      WHERE token_hash = @tokenHash
    `);
  return result.recordset[0] || null;
}

// Conditionele update op status='pending' is de one-time-use-guard: als twee requests
// gelijktijdig dezelfde invite proberen te accepteren, wint er maar één (rowsAffected 0
// bij de verliezer).
async function markInviteAccepted(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      UPDATE dbo.CompanyAdminInvites
      SET status = 'accepted', accepted_at = now()
      WHERE id = @id AND status = 'pending'
      RETURNING id
    `);
  return result.recordset[0] || null;
}

async function revokeInvite(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      UPDATE dbo.CompanyAdminInvites
      SET status = 'revoked'
      WHERE id = @id AND status = 'pending'
      RETURNING id, company_id, email, status
    `);
  return result.recordset[0] || null;
}

async function countPendingInvites() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query("SELECT COUNT(*) AS n FROM dbo.CompanyAdminInvites WHERE status = 'pending' AND expires_at > now()");
  return result.recordset[0].n;
}

module.exports = {
  countPendingInvites,
  createInvite,
  claimInvite,
  releaseInvite,
  INVITE_DURATION_MS,
  listInvitesForCompany,
  listInvitesForPartner,
  getInviteById,
  getInviteByToken,
  markInviteAccepted,
  revokeInvite
};
