const crypto = require("crypto");
const { getPool, sql } = require("../config/db");

// 24 uur: lang genoeg om de mail te lezen, kort genoeg dat een rondslingerende
// link geen blijvend risico is. Verlopen? Gewoon een nieuwe uitnodiging aanmaken.
const INVITE_DURATION_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createInvite({ companyId, email, firstName, lastName, invitedBy }) {
  const pool = await getPool();
  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_DURATION_MS);

  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .input("firstName", sql.NVarChar(100), firstName ?? null)
    .input("lastName", sql.NVarChar(100), lastName ?? null)
    .input("tokenHash", sql.Char(64), tokenHash)
    .input("invitedBy", sql.Int, invitedBy)
    .input("expiresAt", sql.DateTime2, expiresAt)
    .query(`
      INSERT INTO dbo.CompanyAdminInvites
        (company_id, email, first_name, last_name, token_hash, invited_by, expires_at)
      OUTPUT INSERTED.id, INSERTED.company_id, INSERTED.email, INSERTED.first_name,
             INSERTED.last_name, INSERTED.status, INSERTED.expires_at, INSERTED.created_at
      VALUES (@companyId, @email, @firstName, @lastName, @tokenHash, @invitedBy, @expiresAt)
    `);

  return { invite: result.recordset[0], token };
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
      SELECT id, company_id, email, first_name, last_name, status, expires_at, accepted_at, created_at
      FROM dbo.CompanyAdminInvites
      WHERE token_hash = @tokenHash
    `);
  return result.recordset[0] || null;
}

// Conditionele update op status='pending' is de one-time-use-guard: als twee requests
// gelijktijdig dezelfde invite proberen te accepteren, wint er maar één (rowsAffected 0
// bij de verliezer), net als linkEntraSubjectId in users.repository.js.
async function markInviteAccepted(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      UPDATE dbo.CompanyAdminInvites
      SET status = 'accepted', accepted_at = SYSUTCDATETIME()
      OUTPUT INSERTED.id
      WHERE id = @id AND status = 'pending'
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
      OUTPUT INSERTED.id, INSERTED.company_id, INSERTED.email, INSERTED.status
      WHERE id = @id AND status = 'pending'
    `);
  return result.recordset[0] || null;
}

module.exports = {
  createInvite,
  listInvitesForCompany,
  getInviteById,
  getInviteByToken,
  markInviteAccepted,
  revokeInvite
};
