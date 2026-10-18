const { getPool } = require("../config/db");
const logger = require("../utils/logger");
const passport = require("./passport.service");

// Continuïteit en registratie van paspoorten met externe partijen.
//
// 1. Back-up-DPP-dienstverlener: elke gearchiveerde paspoortversie (alleen-toevoegen,
//    met hashes) wordt via HTTPS doorgezet naar BACKUP_DPP_PROVIDER_URL:
//      PUT {url}/passports/{dppId}/versions/{n}   (Bearer BACKUP_DPP_PROVIDER_TOKEN)
//    Idempotent (zelfde versie = zelfde inhoud), in volgorde per paspoort, met
//    exponentiële terugval bij fouten. Staat het uit, dan gebeurt er niets; bij inschakelen
//    wordt de volledige historie alsnog verstuurd.
// 2. EU DPP-register: RegisterProductDPP zet een aanmelding in de wachtrij; met
//    EU_DPP_REGISTRY_URL ingesteld wordt die verstuurd als
//      POST {url}/registrations  { digitalProductPassportId, uniqueProductIdentifier, ... }
//    Het echte register en zijn API bestaan nog niet; dit is een generiek koppelpunt dat
//    aangepast moet worden zodra de Commissie de specificatie publiceert.

const TIMEOUT_MS = 15000;

function config() {
  const clean = (v) => (v || "").trim().replace(/\/+$/, "");
  return {
    backupUrl: clean(process.env.BACKUP_DPP_PROVIDER_URL),
    backupToken: (process.env.BACKUP_DPP_PROVIDER_TOKEN || "").trim(),
    registryUrl: clean(process.env.EU_DPP_REGISTRY_URL),
    registryToken: (process.env.EU_DPP_REGISTRY_TOKEN || "").trim()
  };
}

function backoffMinutes(attempts) {
  return Math.min(24 * 60, 2 ** Math.min(attempts, 11));
}

async function httpSend(method, url, token, body) {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
    throw new Error("Alleen HTTPS-endpoints zijn toegestaan");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  } finally {
    clearTimeout(timer);
  }
}

function qrBase() {
  return (process.env.QR_BASE_URL || process.env.APP_BASE_URL || "https://qr.veripasso.com").replace(/\/+$/, "");
}

// --- 1. replicatie ----------------------------------------------------------------------
async function replicateVersions({ limit = 100 } = {}) {
  const { backupUrl, backupToken } = config();
  if (!backupUrl) return { enabled: false };
  const pool = await getPool();
  // Versies die nog niet verstuurd zijn, oudste eerst, per product in volgorde.
  const rows = (await pool.query(
    `SELECT v.id, v.product_id, v.public_id, v.version_number, v.snapshot, v.content_sha256, v.previous_chain_sha256,
            v.chain_sha256, v.created_at, v.reason
     FROM dbo.passportversions v
     LEFT JOIN dbo.dppreplicationstate s ON s.product_id = v.product_id
     WHERE v.id > COALESCE(s.last_version_id, 0)
       AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
     ORDER BY v.product_id, v.id
     LIMIT $1`,
    [limit]
  )).rows;
  const counts = { enabled: true, sent: 0, failed: 0 };
  const blocked = new Set();
  for (const row of rows) {
    if (blocked.has(row.product_id)) continue;
    const dppId = String(row.public_id).toLowerCase();
    try {
      await httpSend("PUT", `${backupUrl}/passports/${dppId}/versions/${row.version_number}`, backupToken, {
        digitalProductPassportId: `urn:uuid:${dppId}`,
        versionNumber: row.version_number,
        createdAt: new Date(row.created_at).toISOString(),
        reason: row.reason,
        contentSha256: row.content_sha256,
        previousChainSha256: row.previous_chain_sha256,
        chainSha256: row.chain_sha256,
        passport: passport.toDppJson(row.snapshot, { qrBaseUrl: qrBase(), lastUpdated: row.created_at, version: { versionNumber: row.version_number, createdAt: row.created_at, contentSha256: row.content_sha256, chainSha256: row.chain_sha256, isCurrent: false } }),
        snapshot: row.snapshot
      });
      await pool.query(
        `INSERT INTO dbo.dppreplicationstate (product_id, last_version_id, last_sent_at, attempts, last_error, next_attempt_at)
         VALUES ($1, $2, now(), 0, NULL, NULL)
         ON CONFLICT (product_id) DO UPDATE SET last_version_id = EXCLUDED.last_version_id, last_sent_at = now(), attempts = 0, last_error = NULL, next_attempt_at = NULL`,
        [row.product_id, row.id]
      );
      counts.sent += 1;
    } catch (error) {
      blocked.add(row.product_id);
      counts.failed += 1;
      await pool.query(
        `INSERT INTO dbo.dppreplicationstate (product_id, attempts, last_error, next_attempt_at)
         VALUES ($1, 1, $2, now() + interval '2 minutes')
         ON CONFLICT (product_id) DO UPDATE SET attempts = dbo.dppreplicationstate.attempts + 1, last_error = EXCLUDED.last_error,
           next_attempt_at = now() + make_interval(mins => LEAST(1440, power(2, LEAST(dbo.dppreplicationstate.attempts + 1, 11))::int))`,
        [row.product_id, String(error.message).slice(0, 500)]
      );
    }
  }
  if (counts.failed) logger.warn("dpp_replication_failed", { failed: counts.failed });
  return counts;
}

async function replicationStatus() {
  const pool = await getPool();
  const { backupUrl } = config();
  const pending = Number((await pool.query(
    `SELECT COUNT(*) FROM dbo.passportversions v LEFT JOIN dbo.dppreplicationstate s ON s.product_id = v.product_id
     WHERE v.id > COALESCE(s.last_version_id, 0)`
  )).rows[0].count);
  const failing = Number((await pool.query("SELECT COUNT(*) FROM dbo.dppreplicationstate WHERE last_error IS NOT NULL")).rows[0].count);
  return { enabled: Boolean(backupUrl), pendingVersions: pending, failingPassports: failing };
}

// --- 2. EU-register --------------------------------------------------------------------
async function queueRegistration(product) {
  const pool = await getPool();
  const row = (await pool.query(
    `INSERT INTO dbo.dppregistrations (public_id, product_id, company_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO UPDATE SET
       status = CASE WHEN dbo.dppregistrations.status = 'registered' THEN 'registered' ELSE 'queued' END,
       next_attempt_at = CASE WHEN dbo.dppregistrations.status = 'registered' THEN dbo.dppregistrations.next_attempt_at ELSE NULL END
     RETURNING status, registry_reference, requested_at, registered_at, last_error`,
    [String(product.public_id).toLowerCase(), product.id, product.company_id]
  )).rows[0];
  return { ...row, registryConfigured: Boolean(config().registryUrl) };
}

async function getRegistration(publicId) {
  const pool = await getPool();
  const row = (await pool.query(
    "SELECT status, registry_reference, requested_at, registered_at, last_error, attempts FROM dbo.dppregistrations WHERE public_id = $1",
    [String(publicId).toLowerCase()]
  )).rows[0];
  return row ? { ...row, registryConfigured: Boolean(config().registryUrl) } : null;
}

async function processRegistrations({ limit = 50 } = {}) {
  const { registryUrl, registryToken } = config();
  if (!registryUrl) return { enabled: false };
  const pool = await getPool();
  const rows = (await pool.query(
    `SELECT r.public_id, r.product_id, r.attempts FROM dbo.dppregistrations r
     WHERE r.status <> 'registered' AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
     ORDER BY r.requested_at LIMIT $1`,
    [limit]
  )).rows;
  const counts = { enabled: true, registered: 0, failed: 0 };
  for (const row of rows) {
    try {
      const product = await passport.loadProduct(row.product_id);
      if (!product?.published_at) throw new Error("Paspoort is niet (meer) openbaar");
      const json = passport.toDppJson(await passport.buildSnapshot(product), { qrBaseUrl: qrBase() });
      const result = await httpSend("POST", `${registryUrl}/registrations`, registryToken, {
        digitalProductPassportId: json.digitalProductPassportId,
        uniqueProductIdentifier: json.uniqueProductIdentifier,
        granularity: json.granularity,
        economicOperatorId: json.economicOperatorId,
        economicOperatorIdScheme: json.economicOperatorIdScheme,
        facilityId: json.facilityId,
        contentSpecificationIds: json.contentSpecificationIds,
        passportUrl: json.id
      });
      await pool.query(
        "UPDATE dbo.dppregistrations SET status = 'registered', registered_at = now(), registry_reference = $2, last_error = NULL WHERE public_id = $1",
        [row.public_id, String(result.registrationId || result.id || "").slice(0, 200) || null]
      );
      counts.registered += 1;
    } catch (error) {
      counts.failed += 1;
      await pool.query(
        `UPDATE dbo.dppregistrations SET status = 'failed', attempts = attempts + 1, last_error = $2,
           next_attempt_at = now() + make_interval(mins => $3) WHERE public_id = $1`,
        [row.public_id, String(error.message).slice(0, 500), backoffMinutes(row.attempts + 1)]
      );
    }
  }
  return counts;
}

module.exports = { config, replicateVersions, replicationStatus, queueRegistration, getRegistration, processRegistrations };
