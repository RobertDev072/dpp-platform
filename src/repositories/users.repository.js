const { getPool, sql } = require("../config/db");

const PUBLIC_COLUMNS = `id, company_id, email, first_name, last_name, role, status, entra_object_id, entra_subject_id, last_login_at, created_at, updated_at`;

// Leesweergave met bedrijfsnaam en afgeleide identity. Bevat bewust nog de Entra-ids en
// has_password: die zijn nodig voor beheeracties (Graph disable/reset, lokale reset).
// Routes geven rijen daarom NOOIT direct door, maar altijd via toClientUser hieronder.
// [identity] tussen haken: IDENTITY is een gereserveerd woord in T-SQL.
const DETAIL_COLUMNS = `
  u.id, u.company_id, c.name AS company_name, c.status AS company_status,
  u.email, u.first_name, u.last_name, u.role, u.status,
  u.entra_object_id, u.entra_subject_id,
  CASE WHEN u.entra_object_id IS NOT NULL OR u.entra_subject_id IS NOT NULL THEN 'entra' ELSE 'local' END AS [identity],
  CAST(CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS has_password,
  u.last_login_at, u.created_at, u.updated_at`;

// Whitelist van wat de client over een gebruiker te zien krijgt. Nooit password_hash,
// entra_object_id of entra_subject_id: die zijn intern en helpen een aanvaller alleen.
const CLIENT_FIELDS = [
  "id",
  "company_id",
  "company_name",
  "email",
  "first_name",
  "last_name",
  "role",
  "status",
  "identity",
  "last_login_at",
  "created_at",
  "updated_at"
];

function toClientUser(row) {
  if (!row) return null;
  const user = {};
  for (const field of CLIENT_FIELDS) {
    user[field] = row[field] ?? null;
  }
  if (!row.identity) {
    user.identity = row.entra_object_id || row.entra_subject_id ? "entra" : "local";
  }
  return user;
}

async function listUsers({ companyId, role, status } = {}) {
  const pool = await getPool();
  const request = pool.request();

  const where = [];
  if (companyId === null) {
    where.push("u.company_id IS NULL");
  } else if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("u.company_id = @companyId");
  }
  if (role !== undefined) {
    request.input("role", sql.NVarChar(30), role);
    where.push("u.role = @role");
  }
  if (status !== undefined) {
    request.input("status", sql.NVarChar(20), status);
    where.push("u.status = @status");
  }

  const result = await request.query(`
    SELECT ${DETAIL_COLUMNS}
    FROM dbo.Users u
    LEFT JOIN dbo.Companies c ON c.id = u.company_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY u.email
  `);
  return result.recordset;
}

async function getUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT ${DETAIL_COLUMNS}
      FROM dbo.Users u
      LEFT JOIN dbo.Companies c ON c.id = u.company_id
      WHERE u.id = @id
    `);
  return result.recordset[0] || null;
}

// Voor de lokale login. company_status erbij zodat de login-route gebruikers van een
// niet-actieve company kan weigeren (zelfde generieke 401 als een fout wachtwoord).
// LOWER aan beide kanten: e-mail is hoofdletterongevoelig, ongeacht de DB-collation.
async function getUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query(`
      SELECT u.id, u.company_id, u.email, u.password_hash, u.role, u.status, c.status AS company_status
      FROM dbo.Users u
      LEFT JOIN dbo.Companies c ON c.id = u.company_id
      WHERE LOWER(u.email) = LOWER(@email)
    `);
  return result.recordset[0] || null;
}

async function emailInUse(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query(`SELECT TOP 1 1 AS found FROM dbo.Users WHERE LOWER(email) = LOWER(@email)`);
  return result.recordset.length > 0;
}

async function getUserByEntraSubjectId(entraSubjectId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sub", sql.NVarChar(255), entraSubjectId)
    .query(`
      SELECT id, company_id, email, role, status
      FROM dbo.Users
      WHERE entra_subject_id = @sub
    `);
  return result.recordset[0] || null;
}

// Voor de "just-in-time" koppeling bij een eerste Entra-login: een account dat door een
// admin is aangemaakt (bekend email, nog geen sub gekoppeld) en actief is.
async function getUnlinkedUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query(`
      SELECT id, company_id, email, role, status
      FROM dbo.Users
      WHERE LOWER(email) = LOWER(@email) AND entra_subject_id IS NULL AND status = 'active'
    `);
  return result.recordset[0] || null;
}

// Koppelt een sub-claim één keer aan een account. De WHERE-clausule met
// "entra_subject_id IS NULL" is de race-guard: als twee logins gelijktijdig proberen te
// koppelen, wint er maar één (rowsAffected = 0 bij de verliezer, die dan opnieuw moet
// opvragen in plaats van blind te overschrijven).
// password_hash gaat daarbij weg: een Entra-account (identity 'entra') houdt nooit een
// lokaal wachtwoord naast Entra, anders blijft er een pad zonder MFA over (bijv. de
// gezaaide System Owner of een account van vóór Entra).
async function linkEntraSubjectId(userId, entraSubjectId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, userId)
    .input("sub", sql.NVarChar(255), entraSubjectId)
    .query(`
      UPDATE dbo.Users
      SET entra_subject_id = @sub, password_hash = NULL, updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.id, INSERTED.company_id, INSERTED.email, INSERTED.role, INSERTED.status
      WHERE id = @id AND entra_subject_id IS NULL
    `);
  return result.recordset[0] || null;
}

// Minimale company-info voor gebruikersbeheer (bestaat de company, is ze actief?).
async function getCompanyStatus(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`SELECT id, status FROM dbo.Companies WHERE id = @companyId`);
  return result.recordset[0] || null;
}

// Snelle, niet-lockende telling voor een "fail fast"-check vóórdat er (kostbare, lastig
// terug te draaien) externe calls zoals Graph-usercreatie worden gedaan. De autoritatieve,
// race-veilige check zit in createUserWithSeatLimit hieronder.
async function countActiveUsers(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`SELECT COUNT(*) AS activeCount FROM dbo.Users WHERE company_id = @companyId AND status = 'active'`);
  return result.recordset[0].activeCount;
}

// Een rollback na een fout die de transactie al heeft afgebroken gooit zelf ook; die
// tweede fout mag de oorspronkelijke niet maskeren.
async function safeRollback(transaction) {
  try {
    await transaction.rollback();
  } catch {
    // transactie was al afgebroken
  }
}

// Telt actieve users binnen een company met UPDLOCK+HOLDLOCK zodat twee gelijktijdige
// "user aanmaken"-requests niet allebei de limiet-check kunnen passeren voordat een van
// beide zijn insert heeft gecommit (voorkomt een race over de seat-limiet).
// Een gebruiker die als 'inactive' wordt aangemaakt, neemt geen seat in en wordt dus niet
// tegen de limiet gecheckt (heractiveren later wel, zie updateUserWithSeatLimit).
async function createUserWithSeatLimit({ companyId, maxUsers, ...userFields }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  const status = userFields.status || "active";

  try {
    if (maxUsers != null && status === "active") {
      const countResult = await new sql.Request(transaction)
        .input("companyId", sql.Int, companyId)
        .query(`
          SELECT COUNT(*) AS activeCount
          FROM dbo.Users WITH (UPDLOCK, HOLDLOCK)
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
      .input("entraObjectId", sql.NVarChar(255), userFields.entraObjectId ?? null)
      .input("firstName", sql.NVarChar(100), userFields.firstName ?? null)
      .input("lastName", sql.NVarChar(100), userFields.lastName ?? null)
      .input("role", sql.NVarChar(30), userFields.role)
      .input("status", sql.NVarChar(20), status)
      .query(`
        INSERT INTO dbo.Users
          (company_id, email, password_hash, entra_object_id, first_name, last_name, role, status)
        OUTPUT ${PUBLIC_COLUMNS.split(", ").map((c) => `INSERTED.${c}`).join(", ")}
        VALUES (@companyId, @email, @passwordHash, @entraObjectId, @firstName, @lastName, @role, @status)
      `);

    await transaction.commit();
    return { limitReached: false, user: insertResult.recordset[0] };
  } catch (error) {
    await safeRollback(transaction);
    throw error;
  }
}

const UPDATABLE_FIELDS = ["firstName", "lastName", "role", "status"];
const FIELD_TO_COLUMN = { firstName: "first_name", lastName: "last_name", role: "role", status: "status" };

// Bouwt de SET-clausules uit een vaste whitelist: kolomnamen komen nooit uit de request.
function buildUpdateClauses(request, fields) {
  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields) || fields[field] === undefined) continue;
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${field}`);

    if (field === "role") {
      request.input(field, sql.NVarChar(30), fields[field]);
    } else if (field === "status") {
      request.input(field, sql.NVarChar(20), fields[field]);
    } else {
      request.input(field, sql.NVarChar(100), fields[field] ?? null);
    }
  }
  return setClauses;
}

async function updateUser(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = buildUpdateClauses(request, fields);
  if (setClauses.length === 0) {
    return getUserById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Users
    SET ${setClauses.join(", ")}
    OUTPUT ${PUBLIC_COLUMNS.split(", ").map((c) => `INSERTED.${c}`).join(", ")}
    WHERE id = @id
  `);

  return result.recordset[0] || null;
}

// Wijzigt een gebruiker in één transactie. Gaat de status naar 'active' vanuit iets
// anders (heractiveren), dan telt dat als een nieuwe seat: de telling gebeurt met
// UPDLOCK+HOLDLOCK zodat twee gelijktijdige heractivaties (of een heractivatie + een
// nieuwe user) niet samen over de limiet heen kunnen. De limiet (COALESCE(company, plan))
// wordt binnen dezelfde transactie gelezen.
// Resultaat: { notFound } | { limitReached } | { user, previous }.
async function updateUserWithSeatLimit(id, fields) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const currentResult = await new sql.Request(transaction)
      .input("id", sql.Int, id)
      .query(`SELECT id, company_id, role, status FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    const current = currentResult.recordset[0];
    if (!current) {
      await transaction.rollback();
      return { notFound: true };
    }

    const activating = fields.status === "active" && current.status !== "active";
    if (activating && current.company_id != null) {
      const seatResult = await new sql.Request(transaction)
        .input("companyId", sql.Int, current.company_id)
        .query(`
          SELECT
            (SELECT COALESCE(c.max_users, p.max_users)
               FROM dbo.Companies c LEFT JOIN dbo.Plans p ON p.id = c.plan_id
              WHERE c.id = @companyId) AS max_users,
            (SELECT COUNT(*) FROM dbo.Users WITH (UPDLOCK, HOLDLOCK)
              WHERE company_id = @companyId AND status = 'active') AS active_users
        `);
      const { max_users: maxUsers, active_users: activeUsers } = seatResult.recordset[0];
      if (maxUsers != null && activeUsers >= maxUsers) {
        await transaction.rollback();
        return { limitReached: true };
      }
    }

    const request = new sql.Request(transaction).input("id", sql.Int, id);
    const setClauses = buildUpdateClauses(request, fields);
    let updated = null;
    if (setClauses.length > 0) {
      setClauses.push("updated_at = SYSUTCDATETIME()");
      const result = await request.query(`
        UPDATE dbo.Users
        SET ${setClauses.join(", ")}
        OUTPUT ${PUBLIC_COLUMNS.split(", ").map((c) => `INSERTED.${c}`).join(", ")}
        WHERE id = @id
      `);
      updated = result.recordset[0] || null;
    }

    await transaction.commit();
    return { user: updated, previous: current };
  } catch (error) {
    await safeRollback(transaction);
    throw error;
  }
}

// Alleen ooit een bcrypt-hash; het wachtwoord zelf komt nooit in de database.
async function setPasswordHash(id, passwordHash) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("passwordHash", sql.NVarChar(255), passwordHash)
    .query(`UPDATE dbo.Users SET password_hash = @passwordHash, updated_at = SYSUTCDATETIME() WHERE id = @id`);
}

// SQL Server unique-violation (constraint 2627, unique index 2601): een gelijktijdige
// aanvraag met hetzelfde e-mailadres heeft de pre-check net ingehaald.
function isUniqueViolation(error) {
  const number = error && (error.number ?? error.originalError?.info?.number);
  return number === 2627 || number === 2601;
}

module.exports = {
  CLIENT_FIELDS,
  toClientUser,
  listUsers,
  getUserById,
  getUserByEmail,
  emailInUse,
  getUserByEntraSubjectId,
  getUnlinkedUserByEmail,
  linkEntraSubjectId,
  getCompanyStatus,
  countActiveUsers,
  createUserWithSeatLimit,
  updateUser,
  updateUserWithSeatLimit,
  setPasswordHash,
  isUniqueViolation
};
