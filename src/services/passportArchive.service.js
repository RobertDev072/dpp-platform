// Versie-archief van productpaspoorten (EN 18221:2026 §4.2). Zie de migratie
// 20261010000000_passport_versions.sql voor het opslagmodel.
//
// Regels:
// - alleen paspoorten die op de markt zijn (public_id + status published/archived)
//   worden geversioneerd; concepten niet;
// - een nieuwe versie ontstaat alleen bij een inhoudelijke wijziging (andere
//   content-hash), dus herhaald opslaan zonder wijziging maakt geen ruis;
// - per product één schrijver tegelijk (transactie-advisory-lock), zodat
//   versienummers en de hash-keten nooit botsen;
// - versies zijn onveranderlijk (database-trigger) en de keten is te verifiëren.

const { getPool } = require("../config/db");
const passport = require("./passport.service");
const logger = require("../utils/logger");

const LOCK_NAMESPACE = 72_610_002;
const ARCHIVED_STATUSES = new Set(["published", "archived"]);

// Op de markt = ooit gepubliceerd (en dus via de QR-code openbaar geweest).
function isOnMarket(product) {
  return Boolean(product && product.public_id && product.published_at && ARCHIVED_STATUSES.has(product.status));
}

function chainHash({ previousChainSha256, versionNumber, contentSha256, createdAt }) {
  return passport.sha256(`${previousChainSha256 || ""}|${versionNumber}|${contentSha256}|${createdAt}`);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    productId: row.product_id,
    companyId: row.company_id,
    publicId: String(row.public_id).toLowerCase(),
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    contentSha256: row.content_sha256,
    previousChainSha256: row.previous_chain_sha256,
    chainSha256: row.chain_sha256,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString()
  };
}

// Legt een nieuwe versie vast als de inhoud is gewijzigd. Geeft de nieuwe versie
// terug, of null als er niets te archiveren viel.
async function recordVersionIfChanged(productId, { userId = null, reason = "update" } = {}) {
  const candidate = await passport.loadProduct(productId);
  if (!isOnMarket(candidate)) return null;

  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK_NAMESPACE, productId]);
    // Pas ná het verkrijgen van de lock de actuele stand lezen: zo kan een
    // gelijktijdige, eerdere wijziging nooit als laatste versie eindigen.
    const product = await passport.loadProduct(productId, client);
    if (!isOnMarket(product)) {
      await client.query("COMMIT");
      return null;
    }
    const snapshot = await passport.buildSnapshot(product, client);
    const contentSha256 = passport.contentHash(snapshot);
    const latest = await client.query(
      `SELECT version_number, content_sha256, chain_sha256
       FROM dbo.passportversions WHERE product_id = $1
       ORDER BY version_number DESC LIMIT 1`,
      [productId]
    );
    const previous = latest.rows[0];
    if (previous && previous.content_sha256 === contentSha256) {
      await client.query("COMMIT");
      return null;
    }
    const versionNumber = previous ? previous.version_number + 1 : 1;
    const createdAt = new Date().toISOString();
    const previousChainSha256 = previous ? previous.chain_sha256 : null;
    const chainSha256 = chainHash({ previousChainSha256, versionNumber, contentSha256, createdAt });
    const inserted = await client.query(
      `INSERT INTO dbo.passportversions
         (product_id, company_id, public_id, version_number, snapshot, content_sha256,
          previous_chain_sha256, chain_sha256, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        productId,
        product.company_id,
        String(product.public_id).toLowerCase(),
        versionNumber,
        JSON.stringify(snapshot),
        contentSha256,
        previousChainSha256,
        chainSha256,
        String(reason).slice(0, 50),
        userId,
        createdAt
      ]
    );
    await client.query("COMMIT");
    return mapRow(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Best-effort variant voor na een geslaagde wijziging: de wijziging zelf is al
// opgeslagen, dus een archieffout mag het verzoek niet laten mislukken. Wel luid
// loggen (CloudWatch-alarm op "passport_archive_failed"); het dagelijkse onderhoud
// vult ontbrekende versies aan zodra het weer lukt.
async function archiveSafely(productIds, options) {
  const results = [];
  for (const id of [...new Set(productIds.map(Number))].filter(Number.isInteger)) {
    try {
      results.push(await recordVersionIfChanged(id, options));
    } catch (error) {
      logger.error("passport_archive_failed", { productId: id, reason: options?.reason, errorMessage: error.message });
    }
  }
  return results.filter(Boolean);
}

async function listVersions(productId) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, product_id, company_id, public_id, version_number, content_sha256,
            previous_chain_sha256, chain_sha256, reason, created_by, created_at
     FROM dbo.passportversions WHERE product_id = $1 ORDER BY version_number`,
    [productId]
  );
  return result.rows.map((row) => {
    const mapped = mapRow({ ...row, snapshot: null });
    delete mapped.snapshot;
    return mapped;
  });
}

async function getVersion(productId, versionNumber) {
  const pool = await getPool();
  const result = await pool.query(
    "SELECT * FROM dbo.passportversions WHERE product_id = $1 AND version_number = $2",
    [productId, versionNumber]
  );
  return mapRow(result.rows[0]);
}

async function getLatestVersion(productId) {
  const pool = await getPool();
  const result = await pool.query(
    "SELECT * FROM dbo.passportversions WHERE product_id = $1 ORDER BY version_number DESC LIMIT 1",
    [productId]
  );
  return mapRow(result.rows[0]);
}

// De versie die op een bepaald tijdstip gold (de laatste die op of vóór dat
// moment is vastgelegd).
async function getVersionAt(productId, at) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM dbo.passportversions
     WHERE product_id = $1 AND created_at <= $2
     ORDER BY version_number DESC LIMIT 1`,
    [productId, at]
  );
  return mapRow(result.rows[0]);
}

// Controleert de hele keten van een product: elke content-hash klopt met de
// opgeslagen snapshot, elke chain-hash met zijn voorganger, en de nummering is
// aaneengesloten. Geeft per probleem een melding terug.
async function verifyChain(productId) {
  const pool = await getPool();
  const result = await pool.query(
    "SELECT * FROM dbo.passportversions WHERE product_id = $1 ORDER BY version_number",
    [productId]
  );
  const problems = [];
  let previous = null;
  for (const row of result.rows.map(mapRow)) {
    const expectedNumber = previous ? previous.versionNumber + 1 : 1;
    if (row.versionNumber !== expectedNumber) {
      problems.push({ version: row.versionNumber, problem: `versienummer ${expectedNumber} ontbreekt` });
    }
    if (passport.contentHash(row.snapshot) !== row.contentSha256) {
      problems.push({ version: row.versionNumber, problem: "inhoud wijkt af van content_sha256" });
    }
    if ((row.previousChainSha256 || null) !== (previous ? previous.chainSha256 : null)) {
      problems.push({ version: row.versionNumber, problem: "verwijzing naar vorige versie klopt niet" });
    }
    const expectedChain = chainHash({
      previousChainSha256: row.previousChainSha256,
      versionNumber: row.versionNumber,
      contentSha256: row.contentSha256,
      createdAt: row.createdAt
    });
    if (expectedChain !== row.chainSha256) {
      problems.push({ version: row.versionNumber, problem: "chain_sha256 klopt niet" });
    }
    previous = row;
  }
  return { productId, versions: result.rows.length, valid: problems.length === 0, problems };
}

// Gepubliceerde/gearchiveerde paspoorten zonder enige versie (bijv. gepubliceerd
// vóór de invoering van het archief, of na een archieffout) krijgen er een.
async function backfillInitialVersions({ limit = 500 } = {}) {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT p.id FROM dbo.products p
     WHERE p.public_id IS NOT NULL AND p.published_at IS NOT NULL AND p.status IN ('published', 'archived')
       AND NOT EXISTS (SELECT 1 FROM dbo.passportversions v WHERE v.product_id = p.id)
     ORDER BY p.id LIMIT $1`,
    [limit]
  );
  const created = await archiveSafely(
    result.rows.map((r) => r.id),
    { reason: "backfill" }
  );
  return created.length;
}

module.exports = {
  recordVersionIfChanged,
  archiveSafely,
  listVersions,
  getVersion,
  getLatestVersion,
  getVersionAt,
  verifyChain,
  backfillInitialVersions,
  chainHash
};
