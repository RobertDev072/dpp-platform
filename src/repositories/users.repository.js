const { getPool, sql } = require("../config/db");

const PUBLIC_COLUMNS = `id, company_id, email, first_name, last_name, role, status, created_at, updated_at`;

async function listUsers({ companyId, includeDeleted = false } = {}) {
  const pool = await getPool();
  const request = pool.request();

  // Definitief verwijderde accounts horen niet in beheerlijsten thuis (de rijen
  // blijven alleen bestaan voor audit-historie).
  const clauses = includeDeleted ? [] : ["u.status <> 'deleted'"];
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    clauses.push("u.company_id = @companyId");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const columns = PUBLIC_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ");
  const result = await request.query(`
    SELECT ${columns},
           c.name AS company_name,
           CASE WHEN u.password_hash IS NULL THEN 'none' ELSE 'local' END AS auth_provider,
           (u.mfa_enabled_at IS NOT NULL) AS mfa_enabled,
           (SELECT MAX(a.timestamp) FROM dbo.AuditLogs a WHERE a.user_id = u.id) AS last_activity,
           (SELECT MAX(a.timestamp) FROM dbo.AuditLogs a WHERE a.user_id = u.id AND a.action = 'login') AS last_login,
           (SELECT COUNT(*) FROM dbo.Sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS active_sessions
    FROM dbo.Users u
    LEFT JOIN dbo.Companies c ON c.id = u.company_id
    ${where}
    ORDER BY u.email
  `);
  return result.recordset;
}

async function getUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${PUBLIC_COLUMNS} FROM dbo.Users WHERE id = @id`);
  return result.recordset[0] || null;
}

// Alleen voor de admin-wachtwoordreset: welke wachtwoordmethode heeft dit account
// (zonder ooit de hash zelf uit de repository te laten lekken).
async function getUserAuthInfo(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_local_password,
             must_change_password
      FROM dbo.Users WHERE id = @id
    `);
  const row = result.recordset[0];
  return row
    ? {
        hasLocalPassword: Boolean(row.has_local_password),
        mustChangePassword: Boolean(row.must_change_password)
      }
    : null;
}

async function setMustChangePassword(id, value) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("value", sql.Bit, Boolean(value))
    .query("UPDATE dbo.Users SET must_change_password = @value, updated_at = now() WHERE id = @id");
}

async function clearMustChangePasswordByEmail(email) {
  const pool = await getPool();
  await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query("UPDATE dbo.Users SET must_change_password = false, updated_at = now() WHERE lower(email) = lower(@email)");
}

async function updatePasswordHash(id, passwordHash) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("passwordHash", sql.NVarChar(255), passwordHash)
    .query("UPDATE dbo.Users SET password_hash = @passwordHash, updated_at = now() WHERE id = @id");
}

async function getUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query(`SELECT id, company_id, email, password_hash, role, status, must_change_password,
                   mfa_enabled_at, mfa_secret_enc, mfa_last_step, mfa_recovery_hashes
            FROM dbo.Users WHERE lower(email) = lower(@email)`);
  return result.recordset[0] || null;
}

// Snelle, niet-lockende telling voor een "fail fast"-check. De autoritatieve,
// race-veilige check zit in createUserWithSeatLimit hieronder.
async function countActiveUsers(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`SELECT COUNT(*) AS "activeCount" FROM dbo.Users WHERE company_id = @companyId AND status = 'active'`);
  return result.recordset[0].activeCount;
}

async function countOtherActiveCompanyAdmins(companyId, excludeUserId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("excludeUserId", sql.Int, excludeUserId)
    .query(`
      SELECT COUNT(*) AS "adminCount" FROM dbo.Users
      WHERE company_id = @companyId AND role = 'company_admin'
        AND status = 'active' AND id <> @excludeUserId
    `);
  return result.recordset[0].adminCount;
}

async function countAllActiveUsers() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`SELECT COUNT(*) AS "activeCount" FROM dbo.Users WHERE status = 'active'`);
  return result.recordset[0].activeCount;
}

// Namespace voor de advisory lock hieronder (willekeurig, maar vast).
const SEAT_LOCK_NAMESPACE = 4242;

// Telt actieve users binnen een company onder een transactie-advisory-lock per bedrijf,
// zodat twee gelijktijdige "user aanmaken"-requests niet allebei de limiet-check kunnen
// passeren voordat een van beide zijn insert heeft gecommit (voorkomt een race over de
// seat-limiet). De lock vervalt automatisch bij commit/rollback.
async function createUserWithSeatLimit({ companyId, maxUsers, ...userFields }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    if (maxUsers != null) {
      await new sql.Request(transaction)
        .input("namespace", sql.Int, SEAT_LOCK_NAMESPACE)
        .input("companyId", sql.Int, companyId)
        .query("SELECT pg_advisory_xact_lock(@namespace::int, @companyId::int)");

      const countResult = await new sql.Request(transaction)
        .input("companyId", sql.Int, companyId)
        .query(`
          SELECT COUNT(*) AS "activeCount"
          FROM dbo.Users
          WHERE company_id = @companyId AND status = 'active'
        `);

      if (countResult.recordset[0].activeCount >= maxUsers) {
        await transaction.rollback();
        return { limitReached: true, user: null };
      }
    }

    const insertResult = await new sql.Request(transaction)
      .input("companyId", sql.Int, companyId)
      .input("email", sql.NVarChar(256), userFields.email)
      .input("passwordHash", sql.NVarChar(255), userFields.passwordHash ?? null)
      .input("firstName", sql.NVarChar(100), userFields.firstName ?? null)
      .input("lastName", sql.NVarChar(100), userFields.lastName ?? null)
      .input("role", sql.NVarChar(30), userFields.role)
      .input("status", sql.NVarChar(20), userFields.status || "active")
      .query(`
        INSERT INTO dbo.Users
          (company_id, email, password_hash, first_name, last_name, role, status)
        VALUES (@companyId, @email, @passwordHash, @firstName, @lastName, @role, @status)
        RETURNING ${PUBLIC_COLUMNS}
      `);

    await transaction.commit();
    return { limitReached: false, user: insertResult.recordset[0] };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

const UPDATABLE_FIELDS = ["firstName", "lastName", "role", "status"];
const FIELD_TO_COLUMN = { firstName: "first_name", lastName: "last_name", role: "role", status: "status" };

async function updateUser(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${field}`);

    if (field === "role") {
      request.input(field, sql.NVarChar(30), fields[field]);
    } else if (field === "status") {
      request.input(field, sql.NVarChar(20), fields[field]);
    } else {
      request.input(field, sql.NVarChar(100), fields[field]);
    }
  }

  if (setClauses.length === 0) {
    return getUserById(id);
  }

  setClauses.push("updated_at = now()");

  const result = await request.query(`
    UPDATE dbo.Users
    SET ${setClauses.join(", ")}
    WHERE id = @id
    RETURNING ${PUBLIC_COLUMNS}
  `);

  return result.recordset[0] || null;
}

// --- tweestapsverificatie (zie services/mfa.service.js) ---------------------------

async function getMfaState(id) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, company_id, email, role, status, password_hash, must_change_password,
            mfa_secret_enc, mfa_pending_secret_enc, mfa_enabled_at, mfa_last_step, mfa_recovery_hashes
     FROM dbo.users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function setPendingMfaSecret(id, secretEnc) {
  const pool = await getPool();
  await pool.query("UPDATE dbo.users SET mfa_pending_secret_enc = $2, updated_at = now() WHERE id = $1", [id, secretEnc]);
}

async function enableMfa(id, { recoveryHashes, step }) {
  const pool = await getPool();
  const result = await pool.query(
    `UPDATE dbo.users
     SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enabled_at = now(),
         mfa_recovery_hashes = $2, mfa_last_step = $3, updated_at = now()
     WHERE id = $1 AND mfa_pending_secret_enc IS NOT NULL
     RETURNING id`,
    [id, JSON.stringify(recoveryHashes), step]
  );
  return result.rowCount === 1;
}

async function disableMfa(id) {
  const pool = await getPool();
  await pool.query(
    `UPDATE dbo.users
     SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL,
         mfa_recovery_hashes = NULL, mfa_last_step = NULL, updated_at = now()
     WHERE id = $1`,
    [id]
  );
}

// Race-veilig: een tijdstap kan maar één keer "verbruikt" worden, ook bij twee
// gelijktijdige verzoeken met dezelfde code.
async function consumeMfaStep(id, step) {
  const pool = await getPool();
  const result = await pool.query(
    "UPDATE dbo.users SET mfa_last_step = $2 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < $2) RETURNING id",
    [id, step]
  );
  return result.rowCount === 1;
}

// Compare-and-swap op de lijst met herstelcode-hashes (een code is eenmalig).
async function consumeRecoveryCode(id, previousJson, hash) {
  const remaining = JSON.parse(previousJson || "[]").filter((h) => h !== hash);
  const pool = await getPool();
  const result = await pool.query(
    "UPDATE dbo.users SET mfa_recovery_hashes = $3, updated_at = now() WHERE id = $1 AND mfa_recovery_hashes = $2 RETURNING id",
    [id, previousJson, JSON.stringify(remaining)]
  );
  return result.rowCount === 1;
}

module.exports = {
  getMfaState,
  setPendingMfaSecret,
  enableMfa,
  disableMfa,
  consumeMfaStep,
  consumeRecoveryCode,
  listUsers,
  getUserById,
  getUserByEmail,
  countActiveUsers,
  countOtherActiveCompanyAdmins,
  countAllActiveUsers,
  createUserWithSeatLimit,
  updateUser,
  getUserAuthInfo,
  updatePasswordHash,
  setMustChangePassword,
  clearMustChangePasswordByEmail
};
