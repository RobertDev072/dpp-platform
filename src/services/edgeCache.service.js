// Cloudflare vóór het QR-domein: de publieke paspoortpagina's (/p/:publicId) worden aan
// de Cloudflare-rand gecachet. Na een wijziging of intrekking moet die cache ververst
// worden. De app (Lambda zonder internettoegang) kan Cloudflare niet zelf aanroepen;
// daarom zet de app de public_id in een wachtrij (dbo.edgecachepurges) en haalt de
// Cloudflare Worker de wachtrij elke minuut op via POST /api/edge/sync (zie
// src/routes/edgeSync.routes.js en edge/cloudflare/).
//
// Alleen actief als EDGE_SYNC_TOKEN gezet is (Cloudflare staat aan); anders doet
// queuePurge niets en groeit de wachtrij niet.

const { getPool } = require("../config/db");
const logger = require("../utils/logger");

function enabled() {
  return Boolean(process.env.EDGE_SYNC_TOKEN);
}

// Gedrukte QR-codes gebruiken de public_id in hoofdletters (zie utils/baseUrl.js), links
// binnen de app soms in kleine letters. Cloudflare cachet die als aparte URL's.
function passportPaths(publicId) {
  const id = String(publicId);
  return [...new Set([`/p/${id.toUpperCase()}`, `/p/${id.toLowerCase()}`])];
}

async function queuePurge(publicIds) {
  if (!enabled()) return 0;
  const ids = [...new Set(publicIds.filter(Boolean).map((id) => String(id).toLowerCase()))];
  if (!ids.length) return 0;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO dbo.edgecachepurges (public_id)
     SELECT unnest($1::uuid[])`,
    [ids]
  );
  return ids.length;
}

// Best-effort na een geslaagde wijziging: de wijziging zelf is al opgeslagen. Zonder
// purge verloopt de cache vanzelf (edge-TTL), dus loggen is genoeg.
async function queuePurgeSafely(publicIds) {
  try {
    return await queuePurge(publicIds);
  } catch (error) {
    logger.error("edge_cache_queue_failed", { count: publicIds.length, errorMessage: error.message });
    return 0;
  }
}

// Alle paspoorten die via de QR-code openbaar zijn (of waren) van één bedrijf, bijv. na
// een nieuwe bedrijfsnaam of een nieuw logo.
async function queuePurgeForCompany(companyId) {
  if (!enabled()) return 0;
  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      "SELECT public_id FROM dbo.products WHERE company_id = $1 AND public_id IS NOT NULL AND published_at IS NOT NULL",
      [companyId]
    );
    return await queuePurge(rows.map((r) => r.public_id));
  } catch (error) {
    logger.error("edge_cache_queue_failed", { companyId, errorMessage: error.message });
    return 0;
  }
}

async function queuePurgeForDocuments(documentIds) {
  if (!enabled() || !documentIds.length) return 0;
  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT p.public_id FROM dbo.documents d JOIN dbo.products p ON p.id = d.product_id
       WHERE d.id = ANY($1::int[]) AND p.public_id IS NOT NULL AND p.published_at IS NOT NULL`,
      [documentIds]
    );
    return await queuePurge(rows.map((r) => r.public_id));
  } catch (error) {
    logger.error("edge_cache_queue_failed", { count: documentIds.length, errorMessage: error.message });
    return 0;
  }
}

// Bevestigde purges weghalen en de volgende portie teruggeven (oudste eerst).
async function takePurges({ ack = 0, limit = 100 } = {}) {
  const pool = await getPool();
  if (ack > 0) await pool.query("DELETE FROM dbo.edgecachepurges WHERE id <= $1", [ack]);
  const { rows } = await pool.query(
    "SELECT id, public_id FROM dbo.edgecachepurges ORDER BY id LIMIT $1",
    [limit]
  );
  if (!rows.length) return { purgeId: ack, paths: [] };
  const paths = new Set();
  for (const row of rows) for (const path of passportPaths(row.public_id)) paths.add(path);
  return { purgeId: Number(rows[rows.length - 1].id), paths: [...paths] };
}

module.exports = {
  enabled,
  passportPaths,
  queuePurge,
  queuePurgeSafely,
  queuePurgeForCompany,
  queuePurgeForDocuments,
  takePurges
};
