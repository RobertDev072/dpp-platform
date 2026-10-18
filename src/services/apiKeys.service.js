const crypto = require("crypto");
const { getPool } = require("../config/db");

// API-sleutels: "vp_" + 8 tekens prefix (zichtbaar in beheer) + "_" + 40 tekens geheim.
// Hoge entropie (240 bit), dus een snelle SHA-256 volstaat; de sleutel zelf wordt nooit
// opgeslagen of gelogd.
const KEY_PATTERN = /^vp_([a-z0-9]{8})_([A-Za-z0-9]{40})$/;
const MAX_ACTIVE_KEYS = 10;

function hashKey(key) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

function randomChars(length, alphabet) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const COLUMNS = "id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at";

async function listKeys(companyId) {
  const pool = await getPool();
  return (await pool.query(`SELECT ${COLUMNS} FROM dbo.apikeys WHERE company_id = $1 ORDER BY revoked_at NULLS FIRST, id DESC`, [companyId])).rows;
}

async function createKey({ companyId, name, scopes, createdBy, expiresAt = null }) {
  const pool = await getPool();
  const active = Number((await pool.query(
    "SELECT COUNT(*) FROM dbo.apikeys WHERE company_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())",
    [companyId]
  )).rows[0].count);
  if (active >= MAX_ACTIVE_KEYS) {
    const error = new Error(`Maximaal ${MAX_ACTIVE_KEYS} actieve API-sleutels per bedrijf. Trek eerst een oude sleutel in.`);
    error.statusCode = 409;
    throw error;
  }
  const prefix = randomChars(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const secret = randomChars(40, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
  const key = `vp_${prefix}_${secret}`;
  const row = (await pool.query(
    `INSERT INTO dbo.apikeys (company_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
    [companyId, name, `vp_${prefix}`, hashKey(key), scopes, createdBy ?? null, expiresAt]
  )).rows[0];
  return { ...row, key };
}

async function revokeKey(companyId, id) {
  const pool = await getPool();
  const result = await pool.query(
    `UPDATE dbo.apikeys SET revoked_at = now() WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL RETURNING ${COLUMNS}`,
    [id, companyId]
  );
  return result.rows[0] || null;
}

// Geldige sleutel → { keyId, companyId, scopes[] }; anders null. Het bedrijf moet actief
// zijn. last_used_at hooguit eens per 5 minuten bijwerken (geen schrijfactie per verzoek).
async function authenticate(key) {
  if (!KEY_PATTERN.test(String(key || ""))) return null;
  const pool = await getPool();
  const row = (await pool.query(
    `SELECT k.id, k.company_id, k.scopes, k.last_used_at, c.status AS company_status
     FROM dbo.apikeys k JOIN dbo.companies c ON c.id = k.company_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hashKey(key)]
  )).rows[0];
  if (!row || row.company_status !== "active") return null;
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60 * 1000) {
    await pool.query("UPDATE dbo.apikeys SET last_used_at = now() WHERE id = $1", [row.id]).catch(() => {});
  }
  return { keyId: row.id, companyId: row.company_id, scopes: row.scopes.split(" ") };
}

module.exports = { listKeys, createKey, revokeKey, authenticate, hashKey, MAX_ACTIVE_KEYS };
