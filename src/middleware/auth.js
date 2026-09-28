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
      "INSERT INTO dbo.Sessions (user_id, token_hash, expires_at) VALUES (@userId, @tokenHash, @expiresAt)"
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

async function getUserForToken(token) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(token))
    .query(`
      SELECT u.id, u.company_id, u.email, u.role, u.status, s.expires_at
      FROM dbo.Sessions s
      JOIN dbo.Users u ON u.id = s.user_id
      WHERE s.token_hash = @tokenHash
    `);

  const row = result.recordset[0];
  if (!row || row.status !== "active" || new Date(row.expires_at) < new Date()) {
    return null;
  }

  return { id: row.id, companyId: row.company_id, email: row.email, role: row.role };
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

module.exports = {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole
};
