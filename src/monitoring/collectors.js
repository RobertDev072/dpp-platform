// Verzamelfuncties voor het monitoringdashboard. Uitgangspunten:
// - alles server-side, alleen voor de Platform Owner ontsloten (routes dwingen af);
// - dure metingen (tabelgroottes, opslagverdeling) draaien maar één keer per dag
//   in de snapshot en worden verder uit de snapshot-tabel gelezen;
// - lichte metingen (DB-grootte, verbindingen) hebben een korte in-memory cache;
// - geen enkele meting mag de app laten crashen: alles faalt zacht naar null met
//   een gesaneerde reden, het dashboard toont dan "Niet beschikbaar".

const { getPool, sql } = require("../config/db");
const { sanitizeErrorMessage } = require("./requestMetrics");

// --- mini-cache -------------------------------------------------------------
const cache = new Map(); // key -> { value, expiresAt }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

// Begin van de huidige UTC-dag als timestamptz-expressie.
const START_OF_TODAY_UTC = "(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')";

// --- database ---------------------------------------------------------------

// Actuele databasegrootte + maximum. Supabase rapporteert geen harde maximale
// grootte via SQL; die hangt af van het plan (Free 500 MB, Pro 8 GB inbegrepen) en
// staat daarom in DATABASE_MAX_BYTES. 60s cache.
async function getDatabaseSize() {
  return cached("dbSize", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query("SELECT pg_database_size(current_database()) AS used_bytes");
    const row = result.recordset[0] || {};
    return {
      usedBytes: row.used_bytes ?? null,
      maxBytes: Number(process.env.DATABASE_MAX_BYTES) || null
    };
  });
}

// Tabelgroottes + rijen uit de statistiekviews (geen table scans; rijen zijn de
// actuele schatting van Postgres zelf).
async function getTableStats() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT relname AS table_name,
           n_live_tup AS row_count,
           pg_total_relation_size(relid) AS used_bytes
    FROM pg_stat_user_tables
    WHERE schemaname = 'dbo'
    ORDER BY used_bytes DESC
  `);
  return result.recordset.map((r) => ({
    table: r.table_name,
    rows: Number(r.row_count),
    bytes: Number(r.used_bytes)
  }));
}

// pg_stat_statements staat op Supabase standaard aan, in schema "extensions".
async function querySlowestStatements(pool) {
  const statement = (relation) => `
    SELECT left(query, 160) AS query_text,
           calls AS execution_count,
           mean_exec_time AS avg_ms,
           max_exec_time AS max_ms
    FROM ${relation}
    WHERE calls > 1
      AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY mean_exec_time DESC
    LIMIT 8
  `;
  try {
    return await pool.request().query(statement("extensions.pg_stat_statements"));
  } catch {
    return pool.request().query(statement("pg_stat_statements"));
  }
}

// Live databaseperformance via de statistiekviews (gratis, geen instrumentatie nodig).
async function getDbPerformance() {
  return cached("dbPerf", 60000, async () => {
    const pool = await getPool();
    try {
      const [stats, sessions] = await Promise.all([
        querySlowestStatements(pool),
        pool.request().query(`
          SELECT COUNT(*) AS active_sessions
          FROM pg_stat_activity
          WHERE datname = current_database() AND backend_type = 'client backend'
        `)
      ]);

      // Querytekst is bij ons altijd geparametriseerd ($n), maar we saneren voor de
      // zekerheid alsnog string-literals weg.
      const slowest = stats.recordset.map((r) => ({
        query: String(r.query_text || "").replace(/'[^']*'/g, "'…'").replace(/\s+/g, " ").trim(),
        executions: Number(r.execution_count),
        avgMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
        maxMs: r.max_ms != null ? Math.round(Number(r.max_ms)) : null
      }));

      // Poolstatus van de eigen pg-pool (per serverless-instance).
      let poolStatus = null;
      try {
        const pg = pool.pg;
        poolStatus = {
          used: pg.totalCount - pg.idleCount,
          free: pg.idleCount,
          pendingAcquires: pg.waitingCount,
          max: pg.options.max
        };
      } catch {
        poolStatus = null;
      }

      return {
        available: true,
        slowestQueries: slowest,
        activeSessions: sessions.recordset[0]?.active_sessions ?? null,
        connectionPool: poolStatus
      };
    } catch (error) {
      return { available: false, reason: sanitizeErrorMessage(error.message) };
    }
  });
}

// --- entiteits-tellingen ------------------------------------------------------
// Eén round-trip met subqueries; COUNT(*) blijft goedkoop op de huidige schaal.
async function getEntityCounts() {
  return cached("entityCounts", 5 * 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'partner') AS partner_count,
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'customer') AS company_count,
        (SELECT COUNT(*) FROM dbo.Users WHERE status <> 'deleted') AS user_count,
        (SELECT COUNT(*) FROM dbo.Users WHERE status = 'active') AS active_user_count,
        (SELECT COUNT(*) FROM dbo.Products) AS product_count,
        (SELECT COUNT(*) FROM dbo.Documents) AS document_count,
        (SELECT COUNT(*) FROM dbo.AuditLogs) AS audit_log_count,
        (SELECT COUNT(*) FROM dbo.ScanEvents) AS scan_event_count,
        (SELECT COUNT(*) FROM dbo.CompanyAdminInvites) AS invite_count
    `);
    return result.recordset[0];
  });
}

// QR-scans per periode (echte data uit ScanEvents.scanned_at).
async function getScanStats() {
  return cached("scanStats", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= ${START_OF_TODAY_UTC}) AS today,
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= now() - interval '7 days') AS last7,
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= now() - interval '30 days') AS last30,
        (SELECT COUNT(*) FROM dbo.ScanEvents) AS total
    `);
    return result.recordset[0];
  });
}

// Meest gescande producten (alleen productnaam + aantal; geen bezoekersgegevens).
async function getTopScannedProducts() {
  return cached("topScanned", 5 * 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT p.name, c.name AS company_name, COUNT(*) AS scans
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      JOIN dbo.Companies c ON c.id = p.company_id
      WHERE s.scanned_at >= now() - interval '30 days'
      GROUP BY p.name, c.name
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `);
    return result.recordset;
  });
}

// Logins per periode uit de bestaande auditlog.
async function getLoginStats() {
  return cached("loginStats", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.AuditLogs a WHERE a.action = 'login' AND a.timestamp >= ${START_OF_TODAY_UTC}) AS today,
        (SELECT COUNT(*) FROM dbo.AuditLogs a WHERE a.action = 'login' AND a.timestamp >= now() - interval '7 days') AS last7,
        (SELECT COUNT(*) FROM dbo.AuditLogs a WHERE a.action = 'login' AND a.timestamp >= now() - interval '30 days') AS last30
    `);
    return result.recordset[0];
  });
}

// Groei per entiteit deze maand (op basis van created_at waar beschikbaar).
async function getEntityGrowthThisMonth() {
  return cached("entityGrowth", 10 * 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'partner' AND created_at >= now() - interval '30 days') AS partners,
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'customer' AND created_at >= now() - interval '30 days') AS companies,
        (SELECT COUNT(*) FROM dbo.Users WHERE created_at >= now() - interval '30 days') AS users,
        (SELECT COUNT(*) FROM dbo.Products WHERE created_at >= now() - interval '30 days') AS products,
        (SELECT COUNT(*) FROM dbo.Documents WHERE created_at >= now() - interval '30 days') AS documents,
        (SELECT COUNT(*) FROM dbo.AuditLogs a WHERE a.timestamp >= now() - interval '30 days') AS "auditLogs"
    `);
    return result.recordset[0];
  });
}

// Opslagverdeling documenten op basis van de DB (betrouwbaar: file_size wordt bij
// upload vastgelegd). Foto's hebben geen size in de DB - die komen uit de
// dagelijkse opslag-snapshot.
async function getDocumentStorageBreakdown() {
  return cached("docBreakdown", 10 * 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT type, COUNT(*) AS n, SUM(file_size::bigint) AS bytes
      FROM dbo.Documents
      WHERE blob_name IS NOT NULL
      GROUP BY type
      ORDER BY bytes DESC NULLS LAST
    `);
    return result.recordset.map((r) => ({ type: r.type, count: r.n, bytes: Number(r.bytes || 0) }));
  });
}

// --- bestandsopslag (Supabase Storage) ------------------------------------------
// Supabase houdt per object de metadata (incl. grootte) bij in storage.objects, in
// dezelfde database. Eén aggregatiequery geeft dus exact de opslag per bucket en
// per extensie - geen enumeratie via de API nodig.
async function getBlobStats() {
  const { isStorageConfigured, IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../config/storage");
  if (!isStorageConfigured()) {
    return { available: false, reason: "Supabase Storage niet geconfigureerd" };
  }
  const buckets = [IMAGES_BUCKET, DOCUMENTS_BUCKET];

  const pool = await getPool();
  const result = await pool
    .request()
    .input("buckets", buckets)
    .query(`
      SELECT bucket_id,
             lower(coalesce(substring(name from '\\.([^./]{1,10})$'), 'onbekend')) AS ext,
             COUNT(*) AS n,
             COALESCE(SUM((metadata->>'size')::bigint), 0) AS bytes
      FROM storage.objects
      WHERE bucket_id = ANY(@buckets)
      GROUP BY bucket_id, ext
    `);

  const containers = {};
  for (const name of buckets) {
    containers[name] = { available: true, bytes: 0, count: 0, byExtension: {} };
  }
  let totalBytes = 0;
  let totalCount = 0;
  for (const row of result.recordset) {
    const container = containers[row.bucket_id];
    const bytes = Number(row.bytes);
    container.bytes += bytes;
    container.count += row.n;
    container.byExtension[row.ext] = { count: row.n, bytes };
    totalBytes += bytes;
    totalCount += row.n;
  }

  return { available: true, totalBytes, totalCount, containers };
}

// --- snapshots ------------------------------------------------------------------

async function takeSnapshot() {
  const pool = await getPool();
  const [dbSize, tableStats, counts, blobStats] = await Promise.all([
    getDatabaseSize().catch(() => ({ usedBytes: null, maxBytes: null })),
    getTableStats().catch(() => null),
    getEntityCounts().catch(() => null),
    getBlobStats().catch((e) => ({ available: false, reason: sanitizeErrorMessage(e.message) }))
  ]);

  await pool
    .request()
    .input("dbBytes", sql.BigInt, dbSize.usedBytes)
    .input("dbMaxBytes", sql.BigInt, dbSize.maxBytes)
    .input("blobBytes", sql.BigInt, blobStats?.available ? blobStats.totalBytes : null)
    .input("blobCount", sql.Int, blobStats?.available ? blobStats.totalCount : null)
    .input("partnerCount", sql.Int, counts?.partner_count ?? 0)
    .input("companyCount", sql.Int, counts?.company_count ?? 0)
    .input("userCount", sql.Int, counts?.user_count ?? 0)
    .input("activeUserCount", sql.Int, counts?.active_user_count ?? 0)
    .input("productCount", sql.Int, counts?.product_count ?? 0)
    .input("documentCount", sql.Int, counts?.document_count ?? 0)
    .input("auditLogCount", sql.Int, counts?.audit_log_count ?? 0)
    .input("scanEventCount", sql.Int, counts?.scan_event_count ?? 0)
    .input("inviteCount", sql.Int, counts?.invite_count ?? 0)
    .input("tableStats", sql.NVarChar(sql.MAX), tableStats ? JSON.stringify(tableStats) : null)
    .input("blobStats", sql.NVarChar(sql.MAX), blobStats ? JSON.stringify(blobStats) : null)
    .query(`
      INSERT INTO dbo.SystemMetricsSnapshots
        (database_size_bytes, database_max_bytes, blob_storage_bytes, blob_count,
         partner_count, company_count, user_count, active_user_count, product_count,
         document_count, audit_log_count, scan_event_count, invite_count, table_stats, blob_stats)
      VALUES (@dbBytes, @dbMaxBytes, @blobBytes, @blobCount, @partnerCount, @companyCount,
              @userCount, @activeUserCount, @productCount, @documentCount, @auditLogCount,
              @scanEventCount, @inviteCount, @tableStats, @blobStats)
    `);
}

async function getLatestSnapshot() {
  return cached("latestSnapshot", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.SystemMetricsSnapshots ORDER BY taken_at DESC LIMIT 1
    `);
    return result.recordset[0] || null;
  });
}

async function getSnapshotSeries(days) {
  const pool = await getPool();
  const request = pool.request();
  let where = "";
  if (days) {
    request.input("days", sql.Int, days);
    where = "WHERE taken_at >= now() - make_interval(days => @days::int)";
  }
  const result = await request.query(`
    SELECT id, taken_at, database_size_bytes, database_max_bytes, blob_storage_bytes, blob_count,
           partner_count, company_count, user_count, active_user_count, product_count,
           document_count, audit_log_count, scan_event_count
    FROM dbo.SystemMetricsSnapshots
    ${where}
    ORDER BY taken_at ASC
  `);
  return result.recordset;
}

async function getLastSnapshotAgeHours() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT EXTRACT(EPOCH FROM (now() - MAX(taken_at))) / 60 AS age_minutes
    FROM dbo.SystemMetricsSnapshots
  `);
  const age = result.recordset[0]?.age_minutes;
  return age == null ? null : Number(age) / 60;
}

// --- uurmetrics lezen/schrijven ---------------------------------------------------

// Op Vercel draaien meerdere instances naast elkaar die elk hun eigen deel van een
// uur wegschrijven. Er kunnen dus meerdere rijen per (uur, route) bestaan; alle
// leesqueries hieronder tellen die bij elkaar op (SUM), P95 gewogen, P99/max als MAX.
async function persistHourlyMetrics(rows, bucketStart) {
  if (!rows.length) return;
  const pool = await getPool();
  for (const row of rows) {
    await pool
      .request()
      .input("bucketStart", sql.DateTime2, bucketStart)
      .input("scope", sql.NVarChar(20), row.scope)
      .input("route", sql.NVarChar(200), row.route)
      .input("method", sql.NVarChar(10), row.method)
      .input("requestCount", sql.Int, row.requestCount)
      .input("error4xx", sql.Int, row.error4xx)
      .input("error5xx", sql.Int, row.error5xx)
      .input("durationSum", sql.BigInt, row.durationSumMs)
      .input("durationMax", sql.Int, row.durationMaxMs)
      .input("p50", sql.Int, row.p50Ms)
      .input("p95", sql.Int, row.p95Ms)
      .input("p99", sql.Int, row.p99Ms)
      .query(`
        INSERT INTO dbo.SystemRequestMetricsHourly
          (bucket_start, scope, route, method, request_count, error_4xx_count, error_5xx_count,
           duration_sum_ms, duration_max_ms, p50_ms, p95_ms, p99_ms)
        VALUES (@bucketStart, @scope, @route, @method, @requestCount, @error4xx, @error5xx,
                @durationSum, @durationMax, @p50, @p95, @p99)
      `);
  }
}

async function getHourlyMetrics({ hours, scope }) {
  const pool = await getPool();
  const request = pool.request().input("hours", sql.Int, hours);
  let scopeWhere = "";
  if (scope) {
    request.input("scope", sql.NVarChar(20), scope);
    scopeWhere = "AND scope = @scope";
  }
  const result = await request.query(`
    SELECT bucket_start, scope, route, method, request_count, error_4xx_count, error_5xx_count,
           duration_sum_ms, duration_max_ms, p50_ms, p95_ms, p99_ms
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= now() - make_interval(hours => @hours::int) ${scopeWhere}
    ORDER BY bucket_start ASC
  `);
  return result.recordset;
}

// Tijdserie over de uurdata, per uur of per dag geaggregeerd (SQL-side, compact).
async function getHourlySeries({ hours, scope, perDay = false }) {
  const pool = await getPool();
  const request = pool.request().input("hours", sql.Int, hours);
  let scopeWhere = "";
  if (scope) {
    request.input("scope", sql.NVarChar(20), scope);
    scopeWhere = "AND scope = @scope";
  }
  const bucketExpr = perDay
    ? "(date_trunc('day', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')"
    : "bucket_start";
  const result = await request.query(`
    SELECT ${bucketExpr} AS bucket,
           SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx,
           SUM(duration_sum_ms) / NULLIF(SUM(request_count), 0) AS avg_ms,
           SUM(p95_ms::bigint * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= now() - make_interval(hours => @hours::int) ${scopeWhere}
    GROUP BY 1
    ORDER BY bucket ASC
  `);
  return result.recordset.map((r) => ({
    timestamp: r.bucket,
    requests: Number(r.requests),
    errors: Number(r.errors4xx) + Number(r.errors5xx),
    avgMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
    // Gewogen gemiddelde van uurlijkse P95's - benadering, gelabeld in de UI.
    p95Ms: r.p95_ms != null ? Math.round(Number(r.p95_ms)) : null
  }));
}

// Endpoint-tabel over een periode (langzaamste/snelste/foutgevoeligste routes).
async function getEndpointStats({ hours, scope }) {
  const pool = await getPool();
  const request = pool.request().input("hours", sql.Int, hours);
  let scopeWhere = "";
  if (scope) {
    request.input("scope", sql.NVarChar(20), scope);
    scopeWhere = "AND scope = @scope";
  }
  const result = await request.query(`
    SELECT scope, route, method,
           SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx,
           SUM(duration_sum_ms) / NULLIF(SUM(request_count), 0) AS avg_ms,
           MAX(duration_max_ms) AS max_ms,
           SUM(p95_ms::bigint * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms,
           MAX(p99_ms) AS p99_ms
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= now() - make_interval(hours => @hours::int) ${scopeWhere}
    GROUP BY scope, route, method
  `);
  return result.recordset.map((r) => ({
    scope: r.scope,
    route: r.route,
    method: r.method,
    requests: Number(r.requests),
    errors: Number(r.errors4xx) + Number(r.errors5xx),
    errorRatePct: r.requests ? Math.round(((Number(r.errors4xx) + Number(r.errors5xx)) / Number(r.requests)) * 10000) / 100 : 0,
    avgMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
    maxMs: r.max_ms != null ? Number(r.max_ms) : null,
    p95Ms: r.p95_ms != null ? Math.round(Number(r.p95_ms)) : null,
    p99Ms: r.p99_ms != null ? Number(r.p99_ms) : null
  }));
}

// Requests/fouten sinds een tijdstip (voor de KPI "vandaag"), uurdata + live uur.
async function getRequestTotalsSince(sinceDate) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime2, sinceDate)
    .query(`
    SELECT SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= @since
  `);
  const row = result.recordset[0] || {};
  return {
    requests: Number(row.requests || 0),
    errors4xx: Number(row.errors4xx || 0),
    errors5xx: Number(row.errors5xx || 0)
  };
}

async function pruneOldMetrics({ hourlyRetentionDays, snapshotRetentionDays }) {
  const pool = await getPool();
  await pool.request().input("days", sql.Int, hourlyRetentionDays).query(`
    DELETE FROM dbo.SystemRequestMetricsHourly WHERE bucket_start < now() - make_interval(days => @days::int)
  `);
  await pool.request().input("days", sql.Int, snapshotRetentionDays).query(`
    DELETE FROM dbo.SystemMetricsSnapshots WHERE taken_at < now() - make_interval(days => @days::int)
  `);
}

// --- groei & prognose ---------------------------------------------------------

// Gemiddelde groei per dag over een reeks snapshots (eerste vs. laatste meting).
// Bewust simpel en uitlegbaar: een trendlijn op basis van werkelijke metingen.
function computeGrowth(series, field) {
  const points = series.filter((s) => s[field] != null);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const days = (new Date(last.taken_at) - new Date(first.taken_at)) / 86400000;
  if (days <= 0) return null;
  const delta = Number(last[field]) - Number(first[field]);
  return { deltaTotal: delta, perDay: delta / days, days };
}

function forecast(currentValue, perDay, daysAhead) {
  if (currentValue == null || perDay == null) return null;
  return Math.max(0, Math.round(currentValue + perDay * daysAhead));
}

function daysUntilCapacity(currentValue, maxValue, perDay) {
  if (currentValue == null || maxValue == null || !perDay || perDay <= 0) return null;
  return Math.floor((maxValue - currentValue) / perDay);
}

module.exports = {
  getDatabaseSize,
  getTableStats,
  getDbPerformance,
  getEntityCounts,
  getScanStats,
  getTopScannedProducts,
  getLoginStats,
  getEntityGrowthThisMonth,
  getDocumentStorageBreakdown,
  getBlobStats,
  takeSnapshot,
  getLatestSnapshot,
  getSnapshotSeries,
  getLastSnapshotAgeHours,
  persistHourlyMetrics,
  getHourlyMetrics,
  getHourlySeries,
  getEndpointStats,
  getRequestTotalsSince,
  pruneOldMetrics,
  computeGrowth,
  forecast,
  daysUntilCapacity
};
