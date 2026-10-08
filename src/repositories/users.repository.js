const { query, queryRows, queryOne, withTransaction } = require("../config/db");

const PUBLIC_COLUMNS = `id, company_id, email, first_name, last_name, role, status, auth_user_id, created_at, updated_at`;

async function listUsers({ companyId, includeDeleted = false } = {}) {
  const params = [];
  // Definitief verwijderde accounts horen niet in beheerlijsten thuis (de rijen
  // blijven alleen bestaan voor audit-historie).
  const clauses = includeDeleted ? [] : ["u.status <> 'deleted'"];
  if (companyId !== undefined) {
    params.push(companyId);
    clauses.push(`u.company_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const columns = PUBLIC_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ");
  return queryRows(
    `
    SELECT ${columns},
           c.name AS company_name,
           CASE WHEN u.password_hash IS NULL THEN 'supabase' ELSE 'local' END AS auth_provider,
           (SELECT MAX(a.timestamp) FROM audit_logs a WHERE a.user_id = u.id) AS last_activity,
           u.last_login_at,
           (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS active_sessions
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    ${where}
    ORDER BY u.email
  `,
    params
  );
}

async function getUserById(id) {
  return queryOne(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
}

// Alleen voor de admin-wachtwoordreset: welke wachtwoordmethode heeft dit account
// (zonder ooit de hash zelf uit de repository te laten lekken).
async function getUserAuthInfo(id) {
  const row = await queryOne(
    `SELECT auth_user_id, password_hash IS NOT NULL AS has_local_password, must_change_password
     FROM users WHERE id = $1`,
    [id]
  );
  return row
    ? {
        authUserId: row.auth_user_id,
        hasLocalPassword: Boolean(row.has_local_password),
        mustChangePassword: Boolean(row.must_change_password)
      }
    : null;
}

async function setMustChangePassword(id, value) {
  await query("UPDATE users SET must_change_password = $2, updated_at = now() WHERE id = $1", [id, Boolean(value)]);
}

async function clearMustChangePasswordByEmail(email) {
  await query("UPDATE users SET must_change_password = FALSE, updated_at = now() WHERE email = $1", [email]);
}

async function updatePasswordHash(id, passwordHash) {
  await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [id, passwordHash]);
}

async function setAuthUserId(id, authUserId) {
  await query("UPDATE users SET auth_user_id = $2, updated_at = now() WHERE id = $1", [id, authUserId]);
}

async function getUserByEmail(email) {
  return queryOne(
    `SELECT id, company_id, email, password_hash, auth_user_id, role, status, must_change_password
     FROM users WHERE email = $1`,
    [email]
  );
}

// Na een geslaagde Supabase Auth-login: de "sub" van het account is auth_user_id.
async function getUserByAuthUserId(authUserId) {
  return queryOne(`SELECT id, company_id, email, role, status FROM users WHERE auth_user_id = $1`, [authUserId]);
}

// Snelle, niet-lockende telling voor een "fail fast"-check vóórdat er (kostbare, lastig
// terug te draaien) externe calls zoals het aanmaken van een Supabase Auth-account
// worden gedaan. De autoritatieve, race-veilige check zit in createUserWithSeatLimit.
async function countActiveUsers(companyId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS "activeCount" FROM users WHERE company_id = $1 AND status = 'active'`,
    [companyId]
  );
  return row.activeCount;
}

async function countOtherActiveCompanyAdmins(companyId, excludeUserId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS "adminCount" FROM users
     WHERE company_id = $1 AND role = 'company_admin' AND status = 'active' AND id <> $2`,
    [companyId, excludeUserId]
  );
  return row.adminCount;
}

async function countAllActiveUsers() {
  const row = await queryOne(`SELECT COUNT(*) AS "activeCount" FROM users WHERE status = 'active'`);
  return row.activeCount;
}

// Seat-limiet race-veilig: een transactie-advisory-lock per bedrijf zorgt dat twee
// gelijktijdige "gebruiker aanmaken"-requests niet allebei de limietcheck passeren
// voordat een van beide zijn insert heeft gecommit (vervangt UPDLOCK/HOLDLOCK uit
// de SQL Server-versie).
const SEAT_LOCK_NAMESPACE = 41001;

async function createUserWithSeatLimit({ companyId, maxUsers, ...userFields }) {
  return withTransaction(async (client) => {
    if (maxUsers != null) {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [SEAT_LOCK_NAMESPACE, companyId]);
      const countResult = await client.query(
        `SELECT COUNT(*) AS "activeCount" FROM users WHERE company_id = $1 AND status = 'active'`,
        [companyId]
      );
      if (countResult.rows[0].activeCount >= maxUsers) {
        return { limitReached: true, user: null };
      }
    }

    const insertResult = await client.query(
      `INSERT INTO users
         (company_id, email, password_hash, auth_user_id, first_name, last_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PUBLIC_COLUMNS}`,
      [
        companyId,
        userFields.email,
        userFields.passwordHash ?? null,
        userFields.authUserId ?? null,
        userFields.firstName ?? null,
        userFields.lastName ?? null,
        userFields.role,
        userFields.status || "active"
      ]
    );

    return { limitReached: false, user: insertResult.rows[0] };
  });
}

const UPDATABLE_FIELDS = ["firstName", "lastName", "role", "status"];
const FIELD_TO_COLUMN = { firstName: "first_name", lastName: "last_name", role: "role", status: "status" };

async function updateUser(id, fields) {
  const params = [id];
  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    params.push(fields[field]);
    setClauses.push(`${FIELD_TO_COLUMN[field]} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return getUserById(id);
  }

  setClauses.push("updated_at = now()");

  return queryOne(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    params
  );
}

module.exports = {
  listUsers,
  getUserById,
  getUserByEmail,
  getUserByAuthUserId,
  countActiveUsers,
  countOtherActiveCompanyAdmins,
  countAllActiveUsers,
  createUserWithSeatLimit,
  updateUser,
  getUserAuthInfo,
  updatePasswordHash,
  setAuthUserId,
  setMustChangePassword,
  clearMustChangePasswordByEmail
};
