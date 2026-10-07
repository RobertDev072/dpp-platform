const crypto = require("crypto");
const { queryRows, queryOne } = require("../config/db");

const INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const COLUMNS = "id, company_id, email, first_name, last_name, status, expires_at, accepted_at, created_at";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createInvite({ companyId, email, firstName, lastName, invitedBy }) {
  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_DURATION_MS);

  const invite = await queryOne(
    `
    INSERT INTO company_admin_invites
      (company_id, email, first_name, last_name, token_hash, invited_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, company_id, email, first_name, last_name, status, expires_at, created_at
  `,
    [companyId, email, firstName ?? null, lastName ?? null, tokenHash, invitedBy, expiresAt]
  );

  return { invite, token };
}

async function listInvitesForCompany(companyId) {
  return queryRows(
    `SELECT ${COLUMNS} FROM company_admin_invites WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId]
  );
}

// Alle uitnodigingen van de klantbedrijven van één partner (voor het
// partnerbrede Uitnodigingen-overzicht), inclusief de klantnaam.
async function listInvitesForPartner(partnerId) {
  return queryRows(
    `
    SELECT i.id, i.company_id, c.name AS company_name, i.email, i.first_name, i.last_name,
           i.status, i.expires_at, i.accepted_at, i.created_at
    FROM company_admin_invites i
    JOIN companies c ON c.id = i.company_id
    WHERE c.partner_id = $1
    ORDER BY i.created_at DESC
  `,
    [partnerId]
  );
}

async function getInviteById(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(`SELECT ${COLUMNS} FROM company_admin_invites WHERE id = $1`, [id]);
}

async function getInviteByToken(token) {
  return queryOne(`SELECT ${COLUMNS} FROM company_admin_invites WHERE token_hash = $1`, [hashToken(String(token))]);
}

// Conditionele update op status='pending' is de one-time-use-guard: als twee requests
// gelijktijdig dezelfde invite proberen te accepteren, wint er maar één (0 rijen bij
// de verliezer).
async function markInviteAccepted(id) {
  return queryOne(
    `
    UPDATE company_admin_invites
    SET status = 'accepted', accepted_at = now()
    WHERE id = $1 AND status = 'pending'
    RETURNING id
  `,
    [id]
  );
}

async function revokeInvite(id) {
  return queryOne(
    `
    UPDATE company_admin_invites
    SET status = 'revoked'
    WHERE id = $1 AND status = 'pending'
    RETURNING id, company_id, email, status
  `,
    [id]
  );
}

async function countPendingInvites() {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM company_admin_invites WHERE status = 'pending' AND expires_at > now()"
  );
  return row.n;
}

module.exports = {
  countPendingInvites,
  createInvite,
  listInvitesForCompany,
  listInvitesForPartner,
  getInviteById,
  getInviteByToken,
  markInviteAccepted,
  revokeInvite
};
