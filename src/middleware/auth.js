const crypto = require("crypto");
const { getPool, sql } = require("../config/db");
const { HttpError } = require("./errorHandler");
const { getPermissionsForRole, hasPermission } = require("../auth/permissions");

const SESSION_COOKIE_NAME = "dpp_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(userId) {
  const pool = await getPool();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await pool
    .request()
    .input("userId", sql.Int, userId)
    .input("tokenHash", sql.Char(64), tokenHash)
    .input("expiresAt", sql.DateTime2, expiresAt)
    .query(
      `INSERT INTO dbo.Sessions (user_id, token_hash, expires_at) VALUES (@userId, @tokenHash, @expiresAt);
       UPDATE dbo.Users SET last_login_at = SYSUTCDATETIME() WHERE id = @userId;`
    );

  return { token, expiresAt };
}

async function destroySession(token) {
  const pool = await getPool();
  await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(token))
    .query("DELETE FROM dbo.Sessions WHERE token_hash = @tokenHash");
}

// Trekt alle sessies van een gebruiker in. Aanroepen bij deactiveren/blokkeren, een
// rolwijziging of een wachtwoord-reset, zodat oude sessies niet doorwerken met oude rechten.
async function revokeUserSessions(userId) {
  const pool = await getPool();
  await pool.request().input("userId", sql.Int, userId).query("DELETE FROM dbo.Sessions WHERE user_id = @userId");
}

async function getUserForToken(token) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(token))
    .query(`
      SELECT u.id, u.company_id, u.email, u.first_name, u.last_name, u.role, u.status, s.expires_at,
             c.name AS company_name, c.status AS company_status
      FROM dbo.Sessions s
      JOIN dbo.Users u ON u.id = s.user_id
      LEFT JOIN dbo.Companies c ON c.id = u.company_id
      WHERE s.token_hash = @tokenHash
    `);

  const row = result.recordset[0];
  if (!row || row.status !== "active" || new Date(row.expires_at) < new Date()) {
    return null;
  }

  // Een gedeactiveerde (suspended/archived) company blokkeert direct al haar gebruikers,
  // ook met een nog geldige sessie. Alleen de system_owner hoort bij geen company.
  if (row.role !== "system_owner" && (row.company_id == null || row.company_status !== "active")) {
    return null;
  }

  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name || null,
    email: row.email,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    role: row.role,
    permissions: getPermissionsForRole(row.role)
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Fail closed: secure staat altijd aan, tenzij lokale dev het expliciet uitzet.
    // Nooit afhankelijk van een NODE_ENV=production die het deployment-pad niet garandeert.
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      next(new HttpError(401, "Niet ingelogd"));
      return;
    }

    const user = await getUserForToken(token);
    if (!user) {
      next(new HttpError(401, "Sessie verlopen of ongeldig"));
      return;
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, "Geen toegang"));
      return;
    }
    next();
  };
}

// Eén permissie vereist. Gebruik dit in plaats van requireRole voor nieuwe routes; de
// rol -> permissie-mapping staat in src/auth/permissions.js.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      next(new HttpError(403, "Geen toegang"));
      return;
    }
    next();
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  revokeUserSessions,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole,
  requirePermission
};
