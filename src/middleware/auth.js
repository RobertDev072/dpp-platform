const crypto = require("crypto");
const { getPool, sql } = require("../config/db");
const { HttpError } = require("./errorHandler");

const SESSION_COOKIE_NAME = "dpp_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(userId, { impersonatorUserId = null, durationMs = SESSION_DURATION_MS } = {}) {
  const pool = await getPool();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + durationMs);

  await pool
    .request()
    .input("userId", sql.Int, userId)
    .input("tokenHash", sql.Char(64), tokenHash)
    .input("expiresAt", sql.DateTime2, expiresAt)
    .input("impersonatorUserId", sql.Int, impersonatorUserId)
    .query(
      "INSERT INTO dbo.Sessions (user_id, token_hash, expires_at, impersonator_user_id) VALUES (@userId, @tokenHash, @expiresAt, @impersonatorUserId)"
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

// Trekt álle actieve sessies van een gebruiker in (bijv. na een wachtwoordreset
// door een beheerder: het oude wachtwoord én bestaande sessies zijn dan waardeloos).
async function destroySessionsForUser(userId) {
  const pool = await getPool();
  await pool
    .request()
    .input("userId", sql.Int, userId)
    .query("DELETE FROM dbo.Sessions WHERE user_id = @userId");
}

async function getUserForToken(token) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(token))
    .query(`
      SELECT u.id, u.company_id, u.email, u.role, u.status, u.first_name, u.last_name,
             CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS has_local_password,
             c.name AS company_name, c.logo AS company_logo, c.status AS company_status,
             s.expires_at, s.impersonator_user_id,
             imp.email AS impersonator_email
      FROM dbo.Sessions s
      JOIN dbo.Users u ON u.id = s.user_id
      LEFT JOIN dbo.Companies c ON c.id = u.company_id
      LEFT JOIN dbo.Users imp ON imp.id = s.impersonator_user_id
      WHERE s.token_hash = @tokenHash
    `);

  const row = result.recordset[0];
  if (!row || row.status !== "active" || new Date(row.expires_at) < new Date()) {
    return null;
  }

  // Een geblokkeerd/opgeschort/gearchiveerd bedrijf sluit al zijn gebruikers per
  // direct buiten (bestaande sessies incluis). De Platform Owner heeft geen bedrijf
  // (company_id NULL) en valt hier dus nooit onder.
  if (row.company_id != null && row.company_status !== "active") {
    return null;
  }

  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    companyName: row.company_name,
    companyLogo: row.company_logo || null,
    authProvider: row.has_local_password ? "local" : "entra",
    impersonator: row.impersonator_user_id
      ? { id: row.impersonator_user_id, email: row.impersonator_email }
      : null
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

function requirePlatformOwner(req, res, next) {
  if (!req.user || req.user.role !== "platform_owner") {
    next(new HttpError(403, "Geen toegang"));
    return;
  }
  next();
}

// Tijdens impersonatie zijn gevoelige acties geblokkeerd (opnieuw impersoneren,
// wachtwoordresets, rol-/statuswijzigingen van gevoelige accounts).
function denyIfImpersonating(req, res, next) {
  if (req.user?.impersonator) {
    next(new HttpError(403, "Deze actie is niet toegestaan tijdens impersonatie"));
    return;
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  destroySessionsForUser,
  setSessionCookie,
  clearSessionCookie,
  getUserForToken,
  requireAuth,
  requireRole,
  requirePlatformOwner,
  denyIfImpersonating
};
