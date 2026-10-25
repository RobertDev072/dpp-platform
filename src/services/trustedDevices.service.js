const crypto = require("crypto");
const { getPool } = require("../config/db");

// "Onthoud deze computer 30 dagen": na een geslaagde tweestapsverificatie krijgt de browser
// een eigen cookie. Daarmee slaat die gebruiker op dát apparaat de code over; het
// wachtwoord blijft altijd nodig. Alleen de SHA-256 van het token staat in de database.

const COOKIE_NAME = "vp_trusted";
const TRUST_DAYS = 30;
const MAX_DEVICES_PER_USER = 20;

const hash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    expires: expiresAt,
    // Alleen naar de inlogroutes: het cookie reist niet mee met andere verzoeken.
    path: "/api/auth"
  };
}

async function trust(res, userId, userAgent) {
  const pool = await getPool();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TRUST_DAYS * 86400000);
  await pool.query(
    "INSERT INTO dbo.trusteddevices (user_id, token_hash, label, expires_at) VALUES ($1, $2, $3, $4)",
    [userId, hash(token), String(userAgent || "").slice(0, 200) || null, expiresAt]
  );
  // Oudste apparaten opruimen boven het maximum, en verlopen apparaten weg.
  await pool.query(
    `DELETE FROM dbo.trusteddevices WHERE user_id = $1 AND (expires_at < now() OR id NOT IN (
       SELECT id FROM dbo.trusteddevices WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2))`,
    [userId, MAX_DEVICES_PER_USER]
  );
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

// Is dit apparaat vertrouwd voor deze gebruiker? Werkt last_used_at bij.
async function isTrusted(req, userId) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const pool = await getPool();
  const row = (await pool.query(
    "UPDATE dbo.trusteddevices SET last_used_at = now() WHERE token_hash = $1 AND user_id = $2 AND expires_at > now() RETURNING id",
    [hash(token), userId]
  )).rows[0];
  return Boolean(row);
}

async function count(userId) {
  const pool = await getPool();
  return Number((await pool.query("SELECT count(*) FROM dbo.trusteddevices WHERE user_id = $1 AND expires_at > now()", [userId])).rows[0].count);
}

async function forgetAll(userId) {
  const pool = await getPool();
  await pool.query("DELETE FROM dbo.trusteddevices WHERE user_id = $1", [userId]);
}

module.exports = { COOKIE_NAME, TRUST_DAYS, trust, isTrusted, count, forgetAll, cookieOptions };
