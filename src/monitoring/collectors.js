// Verzamelfuncties voor het monitoringdashboard. Uitgangspunten:
// - alles server-side, alleen voor de Platform Owner ontsloten (routes dwingen af);
// - dure metingen (tabelgroottes, blob-enumeratie) draaien maar één keer per dag
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

// --- database ---------------------------------------------------------------

// Actuele databasegrootte + maximum. Goedkope catalogusquery, 60s cache.
async function getDatabaseSize() {
  return cached("dbSize", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT SUM(CAST(size AS BIGINT)) * 8192 AS used_bytes,
             CAST(DATABASEPROPERTYEX(DB_NAME(), 'MaxSizeInBytes') AS BIGINT) AS max_bytes
      FROM sys.database_files
      WHERE type_desc = 'ROWS'
    `);
    const row = result.recordset[0] || {};
    return { usedBytes: row.used_bytes ?? null, maxBytes: row.max_bytes ?? null };
  });
}

// Tabelgroottes + rijen in één catalogusquery (geen table scans).
async function getTableStats() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT t.name AS table_name,
           SUM(CASE WHEN p.index_id IN (0,1) THEN p.row_count ELSE 0 END) AS row_count,
           SUM(p.used_page_count) * 8192 AS used_bytes
    FROM sys.tables t
    JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id
    WHERE t.is_ms_shipped = 0
    GROUP BY t.name
    ORDER BY used_bytes DESC
  `);
  return result.recordset.map((r) => ({
    table: r.table_name,
    rows: Number(r.row_count),
    bytes: Number(r.used_bytes)
  }));
}

// Live databaseperformance via DMV's (gratis, geen instrumentatie nodig).
// Vereist VIEW DATABASE STATE; zonder die permissie: nette "niet beschikbaar".
async function getDbPerformance() {
  return cached("dbPerf", 60000, async () => {
    const pool = await getPool();
    try {
      const [stats, sessions] = await Promise.all([
        pool.request().query(`
          SELECT TOP 8
                 SUBSTRING(qt.text, 1, 160) AS query_text,
                 qs.execution_count,
                 qs.total_elapsed_time / NULLIF(qs.execution_count, 0) / 1000 AS avg_ms,
                 qs.max_elapsed_time / 1000 AS max_ms
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
          WHERE qs.execution_count > 1
          ORDER BY qs.total_elapsed_time / NULLIF(qs.execution_count, 0) DESC
        `),
        pool.request().query(`
          SELECT COUNT(*) AS active_sessions
          FROM sys.dm_exec_sessions
          WHERE is_user_process = 1
        `)
      ]);

      // Querytekst is bij ons altijd geparametriseerd (@p-variabelen), maar we
      // saneren voor de zekerheid alsnog string-literals weg.
      const slowest = stats.recordset.map((r) => ({
        query: String(r.query_text || "").replace(/'[^']*'/g, "'…'").replace(/\s+/g, " ").trim(),
        executions: Number(r.execution_count),
        avgMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
        maxMs: r.max_ms != null ? Math.round(Number(r.max_ms)) : null
      }));

      // Poolstatus van onze eigen mssql/tarn-pool.
      let poolStatus = null;
      try {
        const tarn = pool.pool;
        if (tarn) {
          poolStatus = {
            used: tarn.numUsed(),
            free: tarn.numFree(),
            pendingAcquires: tarn.numPendingAcquires(),
            max: tarn.max
          };
        }
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
// Eén round-trip met subqueries; alle tabellen hebben een geclusterde PK dus
// COUNT(*) blijft goedkoop op de huidige schaal. Bij echt grote aantallen komt
// dit uit de dagelijkse snapshot i.p.v. live (de routes lezen dan de snapshot).
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

// QR-scans per periode (echte data uit ScanEvents.timestamp).
async function getScanStats() {
  return cached("scanStats", 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= CAST(SYSUTCDATETIME() AS date)) AS today,
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= DATEADD(day, -7, SYSUTCDATETIME())) AS last7,
        (SELECT COUNT(*) FROM dbo.ScanEvents WHERE scanned_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS last30,
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
      SELECT TOP 5 p.name, c.name AS company_name, COUNT(*) AS scans
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      JOIN dbo.Companies c ON c.id = p.company_id
      WHERE s.scanned_at >= DATEADD(day, -30, SYSUTCDATETIME())
      GROUP BY p.name, c.name
      ORDER BY COUNT(*) DESC
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
        (SELECT COUNT(*) FROM dbo.AuditLogs WHERE action = 'login' AND timestamp >= CAST(SYSUTCDATETIME() AS date)) AS today,
        (SELECT COUNT(*) FROM dbo.AuditLogs WHERE action = 'login' AND timestamp >= DATEADD(day, -7, SYSUTCDATETIME())) AS last7,
        (SELECT COUNT(*) FROM dbo.AuditLogs WHERE action = 'login' AND timestamp >= DATEADD(day, -30, SYSUTCDATETIME())) AS last30
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
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'partner' AND created_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS partners,
        (SELECT COUNT(*) FROM dbo.Companies WHERE kind = 'customer' AND created_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS companies,
        (SELECT COUNT(*) FROM dbo.Users WHERE created_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS users,
        (SELECT COUNT(*) FROM dbo.Products WHERE created_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS products,
        (SELECT COUNT(*) FROM dbo.Documents WHERE created_at >= DATEADD(day, -30, SYSUTCDATETIME())) AS documents,
        (SELECT COUNT(*) FROM dbo.AuditLogs WHERE timestamp >= DATEADD(day, -30, SYSUTCDATETIME())) AS auditLogs
    `);
    return result.recordset[0];
  });
}

// Opslagverdeling documenten op basis van de DB (betrouwbaar: file_size wordt bij
// upload vastgelegd). Foto's hebben geen size in de DB - die komen uit de
// dagelijkse blob-snapshot.
async function getDocumentStorageBreakdown() {
  return cached("docBreakdown", 10 * 60000, async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT type, COUNT(*) AS n, SUM(CAST(file_size AS BIGINT)) AS bytes
      FROM dbo.Documents
      WHERE blob_name IS NOT NULL
      GROUP BY type
      ORDER BY bytes DESC
    `);
    return result.recordset.map((r) => ({ type: r.type, count: r.n, bytes: Number(r.bytes || 0) }));
  });
}

// --- blob storage -------------------------------------------------------------
// Volledige enumeratie is de enige exacte meting zonder extra Azure-diensten.
// Draait daarom uitsluitend in de dagelijkse snapshot (niet per page load). Bij
// forse groei (>100k blobs) is het gratis alternatief de maandelijkse capaciteits-
// metric van Azure Monitor; dat staat in het eindrapport als vervolgstap.
async function getBlobStats() {
  const { isBlobStorageConfigured } = require("../config/storage");
  if (!isBlobStorageConfigured()) {
    return { available: false, reason: "Blob Storage niet geconfigureerd" };
  }
  const { IMAGES_CONTAINER, DOCUMENTS_CONTAINER } = require("../services/blobStorage.service");
  const { BlobServiceClient } = require("@azure/storage-blob");
  const { DefaultAzureCredential } = require("@azure/identity");
  const { ACCOUNT_NAME } = require("../config/storage");

  const client = new BlobServiceClient(`https://${ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
  const containers = {};
  let totalBytes = 0;
  let totalCount = 0;

  for (const name of [IMAGES_CONTAINER, DOCUMENTS_CONTAINER]) {
    let bytes = 0;
    let count = 0;
    const byExtension = {};
    try {
      const containerClient = client.getContainerClient(name);
      for await (const blob of containerClient.listBlobsFlat()) {
        const size = blob.properties.contentLength || 0;
        bytes += size;
        count += 1;
        const ext = (blob.name.split(".").pop() || "onbekend").toLowerCase().slice(0, 10);
        byExtension[ext] = byExtension[ext] || { count: 0, bytes: 0 };
        byExtension[ext].count += 1;
        byExtension[ext].bytes += size;
      }
    } catch (error) {
      containers[name] = { available: false, reason: sanitizeErrorMessage(error.message) };
      continue;
    }
    containers[name] = { available: true, bytes, count, byExtension };
    totalBytes += bytes;
    totalCount += count;
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
      SELECT TOP 1 * FROM dbo.SystemMetricsSnapshots ORDER BY taken_at DESC
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
    where = "WHERE taken_at >= DATEADD(day, -@days, SYSUTCDATETIME())";
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
    SELECT DATEDIFF(minute, MAX(taken_at), SYSUTCDATETIME()) AS age_minutes
    FROM dbo.SystemMetricsSnapshots
  `);
  const age = result.recordset[0]?.age_minutes;
  return age == null ? null : age / 60;
}

// --- uurmetrics lezen/schrijven ---------------------------------------------------

async function persistHourlyMetrics(rows, bucketStart) {
  if (!rows.length) return;
  const pool = await getPool();
  // Beperkt aantal rijen (max ~MAX_ROUTE_KEYS); sequentieel is prima en houdt
  // de transactielast minimaal.
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
    WHERE bucket_start >= DATEADD(hour, -@hours, SYSUTCDATETIME()) ${scopeWhere}
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
  const bucketExpr = perDay ? "CAST(bucket_start AS date)" : "bucket_start";
  const result = await request.query(`
    SELECT ${bucketExpr} AS bucket,
           SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx,
           SUM(duration_sum_ms) / NULLIF(SUM(request_count), 0) AS avg_ms,
           SUM(CAST(p95_ms AS BIGINT) * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= DATEADD(hour, -@hours, SYSUTCDATETIME()) ${scopeWhere}
    GROUP BY ${bucketExpr}
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
           SUM(CAST(p95_ms AS BIGINT) * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms,
           MAX(p99_ms) AS p99_ms
    FROM dbo.SystemRequestMetricsHourly
    WHERE bucket_start >= DATEADD(hour, -@hours, SYSUTCDATETIME()) ${scopeWhere}
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
    DELETE FROM dbo.SystemRequestMetricsHourly WHERE bucket_start < DATEADD(day, -@days, SYSUTCDATETIME())
  `);
  await pool.request().input("days", sql.Int, snapshotRetentionDays).query(`
    DELETE FROM dbo.SystemMetricsSnapshots WHERE taken_at < DATEADD(day, -@days, SYSUTCDATETIME())
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
