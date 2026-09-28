const { getPool, sql } = require("../config/db");

// Berekende status (docs §8): accepted > revoked > expired > pending. Eén definitie, zodat
// lijst, filter en tellingen nooit uit elkaar lopen.
const STATUS_SQL = `
  CASE
    WHEN i.accepted_at IS NOT NULL THEN 'accepted'
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.expires_at <= SYSUTCDATETIME() THEN 'expired'
    ELSE 'pending'
  END
`;

// "Openstaand" = nog te accepteren. Alleen deze invites worden bij een nieuwe invite of
// resend ingetrokken; verlopen invites houden hun status 'expired'.
const PENDING_SQL = "i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > SYSUTCDATETIME()";

// token_hash wordt nooit teruggegeven: ook de hash hoort niet in API-responses.
const SELECT_INVITATION = `
  SELECT i.id, i.company_id, c.name AS company_name, i.email, i.first_name, i.last_name, i.role,
         ${STATUS_SQL} AS status,
         i.expires_at, i.accepted_at, i.accepted_user_id, i.revoked_at, i.created_by,
         cb.email AS created_by_email, i.created_at
  FROM dbo.CompanyInvitations i
  JOIN dbo.Companies c ON c.id = i.company_id
  LEFT JOIN dbo.Users cb ON cb.id = i.created_by
`;

async function listInvitations({ companyId, status } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const where = [];

  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("i.company_id = @companyId");
  }
  if (status !== undefined) {
    request.input("status", sql.NVarChar(20), status);
    where.push(`(${STATUS_SQL}) = @status`);
  }

  const result = await request.query(`
    ${SELECT_INVITATION}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY i.created_at DESC, i.id DESC
  `);
  return result.recordset;
}

async function getInvitationById(id) {
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, id).query(`${SELECT_INVITATION} WHERE i.id = @id`);
  return result.recordset[0] || null;
}

// Alleen een invite die nu nog bruikbaar is én bij een actieve company hoort. Alle andere
// gevallen geven null, zodat de route er één generieke fout van maakt.
async function findValidInvitationByTokenHash(tokenHash) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), tokenHash)
    .query(`
      SELECT i.id, i.company_id, c.name AS company_name, i.email, i.first_name, i.last_name, i.role, i.expires_at
      FROM dbo.CompanyInvitations i
      JOIN dbo.Companies c ON c.id = i.company_id
      WHERE i.token_hash = @tokenHash AND ${PENDING_SQL} AND c.status = 'active'
    `);
  return result.recordset[0] || null;
}

async function safeRollback(transaction) {
  try {
    await transaction.rollback();
  } catch {
    // Transactie was al afgebroken door SQL Server (bijv. na een constraint-fout).
  }
}

async function insertInvitation(transaction, { companyId, email, firstName, lastName, tokenHash, expiryHours, createdBy }) {
  // Intrekken + aanmaken in één transactie: er is voor company + e-mail nooit meer dan
  // één bruikbare link tegelijk.
  await new sql.Request(transaction)
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .query(`
      UPDATE i SET revoked_at = SYSUTCDATETIME()
      FROM dbo.CompanyInvitations i
      WHERE i.company_id = @companyId AND i.email = @email AND ${PENDING_SQL}
    `);

  // Expiry in SQL berekend: dezelfde klok als de SYSUTCDATETIME()-check bij accepteren.
  const inserted = await new sql.Request(transaction)
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .input("firstName", sql.NVarChar(100), firstName ?? null)
    .input("lastName", sql.NVarChar(100), lastName ?? null)
    .input("tokenHash", sql.Char(64), tokenHash)
    .input("expiryHours", sql.Int, expiryHours)
    .input("createdBy", sql.Int, createdBy ?? null)
    .query(`
      INSERT INTO dbo.CompanyInvitations (company_id, email, first_name, last_name, role, token_hash, expires_at, created_by)
      OUTPUT INSERTED.id
      VALUES (@companyId, @email, @firstName, @lastName, 'company_admin', @tokenHash,
              DATEADD(HOUR, @expiryHours, SYSUTCDATETIME()), @createdBy)
    `);
  return inserted.recordset[0].id;
}

async function createInvitation(fields) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  let id;
  try {
    id = await insertInvitation(transaction, fields);
    await transaction.commit();
  } catch (error) {
    await safeRollback(transaction);
    throw error;
  }
  return getInvitationById(id);
}

// Oude link intrekken en een nieuwe maken met dezelfde company/e-mail/naam. Alleen voor een
// invite die nog niet geaccepteerd of ingetrokken is (openstaand of verlopen); anders null.
async function resendInvitation(id, { tokenHash, expiryHours, createdBy }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  let newId;
  try {
    const old = await new sql.Request(transaction)
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.CompanyInvitations
        SET revoked_at = SYSUTCDATETIME()
        OUTPUT INSERTED.company_id, INSERTED.email, INSERTED.first_name, INSERTED.last_name
        WHERE id = @id AND accepted_at IS NULL AND revoked_at IS NULL
      `);

    const row = old.recordset[0];
    if (!row) {
      await safeRollback(transaction);
      return null;
    }

    newId = await insertInvitation(transaction, {
      companyId: row.company_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      tokenHash,
      expiryHours,
      createdBy
    });
    await transaction.commit();
  } catch (error) {
    await safeRollback(transaction);
    throw error;
  }
  return getInvitationById(newId);
}

// Alleen een openstaande invite kan worden ingetrokken; null = bestond niet of was niet (meer) pending.
async function revokeInvitation(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      UPDATE i SET revoked_at = SYSUTCDATETIME()
      FROM dbo.CompanyInvitations i
      WHERE i.id = @id AND ${PENDING_SQL}
    `);
  if (result.rowsAffected[0] === 0) return null;
  return getInvitationById(id);
}

function isEmailUniqueViolation(error) {
  return (error.number === 2627 || error.number === 2601) && /UQ_Users_Email/i.test(error.message || "");
}

// Autoritatieve acceptatie in één transactie (docs §5):
//   1. invite atomair consumeren — twee gelijktijdige accepts met hetzelfde token kunnen
//      niet allebei rowsAffected = 1 krijgen;
//   2. seat-telling met UPDLOCK+HOLDLOCK (zelfde range-lock als createUserWithSeatLimit
//      in users.repository.js, dus ook gelijktijdige "medewerker aanmaken" wacht);
//   3. user insert met company_id en role UIT DE INVITE-RIJ, nooit uit de request.
// Resultaat: { user, invitation } of { error: 'INVITE_INVALID' | 'LICENSE_LIMIT_REACHED' | 'EMAIL_IN_USE' }.
async function acceptInvitation({ tokenHash, passwordHash, entraObjectId, firstName, lastName }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const consumed = await new sql.Request(transaction)
      .input("tokenHash", sql.Char(64), tokenHash)
      .query(`
        UPDATE i SET accepted_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.company_id, INSERTED.email, INSERTED.first_name, INSERTED.last_name, INSERTED.role
        FROM dbo.CompanyInvitations i
        JOIN dbo.Companies c ON c.id = i.company_id
        WHERE i.token_hash = @tokenHash AND ${PENDING_SQL} AND c.status = 'active'
      `);

    const invite = consumed.recordset[0];
    if (!invite) {
      await safeRollback(transaction);
      return { error: "INVITE_INVALID" };
    }

    const seats = await new sql.Request(transaction)
      .input("companyId", sql.Int, invite.company_id)
      .query(`
        SELECT COALESCE(c.max_users, p.max_users) AS max_users,
               (SELECT COUNT(*) FROM dbo.Users u WITH (UPDLOCK, HOLDLOCK)
                 WHERE u.company_id = c.id AND u.status = 'active') AS active_users
        FROM dbo.Companies c WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.Plans p ON p.id = c.plan_id
        WHERE c.id = @companyId
      `);

    const { max_users: maxUsers, active_users: activeUsers } = seats.recordset[0];
    if (maxUsers != null && activeUsers >= maxUsers) {
      await safeRollback(transaction);
      return { error: "LICENSE_LIMIT_REACHED" };
    }

    let inserted;
    try {
      inserted = await new sql.Request(transaction)
        .input("companyId", sql.Int, invite.company_id)
        .input("email", sql.NVarChar(256), invite.email)
        .input("passwordHash", sql.NVarChar(255), passwordHash ?? null)
        .input("entraObjectId", sql.NVarChar(255), entraObjectId ?? null)
        .input("firstName", sql.NVarChar(100), firstName || invite.first_name || null)
        .input("lastName", sql.NVarChar(100), lastName || invite.last_name || null)
        .input("role", sql.NVarChar(30), invite.role)
        .query(`
          INSERT INTO dbo.Users (company_id, email, password_hash, entra_object_id, first_name, last_name, role, status)
          OUTPUT INSERTED.id, INSERTED.company_id, INSERTED.email, INSERTED.first_name, INSERTED.last_name,
                 INSERTED.role, INSERTED.status, INSERTED.created_at
          VALUES (@companyId, @email, @passwordHash, @entraObjectId, @firstName, @lastName, @role, 'active')
        `);
    } catch (error) {
      if (isEmailUniqueViolation(error)) {
        await safeRollback(transaction);
        return { error: "EMAIL_IN_USE" };
      }
      throw error;
    }

    const user = inserted.recordset[0];

    await new sql.Request(transaction)
      .input("id", sql.Int, invite.id)
      .input("userId", sql.Int, user.id)
      .query("UPDATE dbo.CompanyInvitations SET accepted_user_id = @userId WHERE id = @id");

    await transaction.commit();
    return { user, invitation: invite };
  } catch (error) {
    await safeRollback(transaction);
    throw error;
  }
}

module.exports = {
  listInvitations,
  getInvitationById,
  findValidInvitationByTokenHash,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  acceptInvitation
};
