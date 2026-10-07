// Verzamelfuncties voor het monitoringdashboard. Uitgangspunten:
// - alles server-side, alleen voor de Platform Owner ontsloten (routes dwingen af);
// - dure metingen (tabelgroottes, opslagtelling) draaien maar één keer per dag
//   in de snapshot en worden verder uit de snapshot-tabel gelezen;
// - lichte metingen (DB-grootte, verbindingen) hebben een korte in-memory cache;
// - geen enkele meting mag de app laten crashen: alles faalt zacht naar null met
//   een gesaneerde reden, het dashboard toont dan "Niet beschikbaar".

const { getPool, query, queryRows, queryOne } = require("../config/db");
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

// Supabase kent geen harde databasegrootte zoals Azure SQL serverless (32 GB), maar
// wel een plan-quotum (Free 0,5 GB, Pro 8 GB inbegrepen). Zet SUPABASE_DB_MAX_BYTES
// op het quotum van je plan voor de capaciteitsprognose.
function configuredDatabaseMaxBytes() {
  const value = Number(process.env.SUPABASE_DB_MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// --- database ---------------------------------------------------------------

// Actuele databasegrootte + maximum. Goedkope catalogusfunctie, 60s cache.
async function getDatabaseSize() {
  return cached("dbSize", 60000, async () => {
    const row = await queryOne("SELECT pg_database_size(current_database()) AS used_bytes");
    return { usedBytes: row?.used_bytes ?? null, maxBytes: configuredDatabaseMaxBytes() };
  });
}

// Tabelgroottes + (geschatte) rijen uit de statistieken (geen table scans).
async function getTableStats() {
  const rows = await queryRows(`
    SELECT c.relname AS table_name,
           GREATEST(c.reltuples, 0)::bigint AS row_count,
           pg_total_relation_size(c.oid) AS used_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY used_bytes DESC
  `);
  return rows.map((r) => ({
    table: r.table_name,
    rows: Number(r.row_count),
    bytes: Number(r.used_bytes)
  }));
}

// Live databaseperformance via pg_stat_statements (standaard aan op Supabase) en
// pg_stat_activity. Zonder pg_stat_statements: alleen sessies, nette melding.
async function getDbPerformance() {
  return cached("dbPerf", 60000, async () => {
    try {
      const sessions = await queryOne(`
        SELECT COUNT(*) AS active_sessions
        FROM pg_stat_activity
        WHERE datname = current_database() AND backend_type = 'client backend'
      `);

      let slowest = [];
      let statementsAvailable = true;
      try {
        const stats = await queryRows(`
          SELECT left(query, 160) AS query_text, calls AS execution_count,
                 mean_exec_time AS avg_ms, max_exec_time AS max_ms
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND calls > 1
            AND query NOT ILIKE '%pg_stat_statements%'
          ORDER BY mean_exec_time DESC
          LIMIT 8
        `);
        // Querytekst is bij ons altijd geparametriseerd ($1-variabelen), maar we
        // saneren voor de zekerheid alsnog string-literals weg.
        slowest = stats.map((r) => ({
          query: String(r.query_text || "").replace(/'[^']*'/g, "'…'").replace(/\s+/g, " ").trim(),
          executions: Number(r.execution_count),
          avgMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
          maxMs: r.max_ms != null ? Math.round(Number(r.max_ms)) : null
        }));
      } catch {
        statementsAvailable = false;
      }

      // Poolstatus van onze eigen node-postgres-pool (deze function-instance).
      let poolStatus = null;
      try {
        const pool = getPool();
        poolStatus = {
          used: pool.totalCount - pool.idleCount,
          free: pool.idleCount,
          pendingAcquires: pool.waitingCount,
          max: pool.options.max
        };
      } catch {
        poolStatus = null;
      }

      return {
        available: true,
        statementsAvailable,
        slowestQueries: slowest,
        activeSessions: sessions?.active_sessions ?? null,
        connectionPool: poolStatus
      };
    } catch (error) {
      return { available: false, reason: sanitizeErrorMessage(error.message) };
    }
  });
}

// --- entiteits-tellingen ------------------------------------------------------
async function getEntityCounts() {
  return cached("entityCounts", 5 * 60000, async () =>
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM companies WHERE kind = 'partner') AS partner_count,
        (SELECT COUNT(*) FROM companies WHERE kind = 'customer') AS company_count,
        (SELECT COUNT(*) FROM users WHERE status <> 'deleted') AS user_count,
        (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_user_count,
        (SELECT COUNT(*) FROM products) AS product_count,
        (SELECT COUNT(*) FROM documents) AS document_count,
        (SELECT COUNT(*) FROM audit_logs) AS audit_log_count,
        (SELECT COUNT(*) FROM scan_events) AS scan_event_count,
        (SELECT COUNT(*) FROM company_admin_invites) AS invite_count
    `)
  );
}

// QR-scans per periode (echte data uit scan_events.scanned_at).
async function getScanStats() {
  return cached("scanStats", 60000, async () =>
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM scan_events WHERE scanned_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today,
        (SELECT COUNT(*) FROM scan_events WHERE scanned_at >= now() - interval '7 days') AS last7,
        (SELECT COUNT(*) FROM scan_events WHERE scanned_at >= now() - interval '30 days') AS last30,
        (SELECT COUNT(*) FROM scan_events) AS total
    `)
  );
}

// Meest gescande producten (alleen productnaam + aantal; geen bezoekersgegevens).
async function getTopScannedProducts() {
  return cached("topScanned", 5 * 60000, async () =>
    queryRows(`
      SELECT p.name, c.name AS company_name, COUNT(*) AS scans
      FROM scan_events s
      JOIN products p ON p.id = s.product_id
      JOIN companies c ON c.id = p.company_id
      WHERE s.scanned_at >= now() - interval '30 days'
      GROUP BY p.name, c.name
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `)
  );
}

// Logins per periode uit de bestaande auditlog.
async function getLoginStats() {
  return cached("loginStats", 60000, async () =>
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM audit_logs WHERE action = 'login' AND timestamp >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today,
        (SELECT COUNT(*) FROM audit_logs WHERE action = 'login' AND timestamp >= now() - interval '7 days') AS last7,
        (SELECT COUNT(*) FROM audit_logs WHERE action = 'login' AND timestamp >= now() - interval '30 days') AS last30
    `)
  );
}

// Groei per entiteit afgelopen 30 dagen (op basis van created_at waar beschikbaar).
async function getEntityGrowthThisMonth() {
  return cached("entityGrowth", 10 * 60000, async () =>
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM companies WHERE kind = 'partner' AND created_at >= now() - interval '30 days') AS partners,
        (SELECT COUNT(*) FROM companies WHERE kind = 'customer' AND created_at >= now() - interval '30 days') AS companies,
        (SELECT COUNT(*) FROM users WHERE created_at >= now() - interval '30 days') AS users,
        (SELECT COUNT(*) FROM products WHERE created_at >= now() - interval '30 days') AS products,
        (SELECT COUNT(*) FROM documents WHERE created_at >= now() - interval '30 days') AS documents,
        (SELECT COUNT(*) FROM audit_logs WHERE timestamp >= now() - interval '30 days') AS "auditLogs"
    `)
  );
}

// Opslagverdeling documenten op basis van de DB (betrouwbaar: file_size wordt bij
// upload vastgelegd). Foto's hebben geen size in de DB - die komen uit de
// dagelijkse opslag-snapshot.
async function getDocumentStorageBreakdown() {
  return cached("docBreakdown", 10 * 60000, async () => {
    const rows = await queryRows(`
      SELECT type, COUNT(*) AS n, SUM(file_size::bigint) AS bytes
      FROM documents
      WHERE blob_name IS NOT NULL
      GROUP BY type
      ORDER BY bytes DESC NULLS LAST
    `);
    return rows.map((r) => ({ type: r.type, count: r.n, bytes: Number(r.bytes || 0) }));
  });
}

// --- bestandsopslag (Supabase Storage) -----------------------------------------
// Supabase houdt alle objecten bij in de tabel storage.objects (met grootte en
// mimetype in metadata), dus één query geeft een exacte telling - geen enumeratie
// van de opslag zelf nodig. Draait alleen in de dagelijkse snapshot.
async function getBlobStats() {
  const { IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../config/supabase");
  const buckets = [IMAGES_BUCKET, DOCUMENTS_BUCKET];

  let rows;
  try {
    rows = await queryRows(
      `
      SELECT bucket_id,
             lower(substring(name from '\\.([A-Za-z0-9]{1,10})$')) AS ext,
             COUNT(*) AS n,
             COALESCE(SUM((metadata->>'size')::bigint), 0) AS bytes
      FROM storage.objects
      WHERE bucket_id = ANY($1)
      GROUP BY bucket_id, ext
    `,
      [buckets]
    );
  } catch (error) {
    // Geen Supabase-database (bijv. lokale Postgres): schema storage bestaat niet.
    return { available: false, reason: sanitizeErrorMessage(error.message) };
  }

  const containers = {};
  let totalBytes = 0;
  let totalCount = 0;
  for (const name of buckets) {
    containers[name] = { available: true, bytes: 0, count: 0, byExtension: {} };
  }
  for (const r of rows) {
    const bucket = containers[r.bucket_id];
    const ext = r.ext || "onbekend";
    const count = Number(r.n);
    const bytes = Number(r.bytes);
    bucket.count += count;
    bucket.bytes += bytes;
    bucket.byExtension[ext] = { count, bytes };
    totalBytes += bytes;
    totalCount += count;
  }

  return { available: true, totalBytes, totalCount, containers };
}

// --- snapshots ------------------------------------------------------------------

async function takeSnapshot() {
  const [dbSize, tableStats, counts, blobStats] = await Promise.all([
    getDatabaseSize().catch(() => ({ usedBytes: null, maxBytes: null })),
    getTableStats().catch(() => null),
    getEntityCounts().catch(() => null),
    getBlobStats().catch((e) => ({ available: false, reason: sanitizeErrorMessage(e.message) }))
  ]);

  await query(
    `
    INSERT INTO system_metrics_snapshots
      (database_size_bytes, database_max_bytes, blob_storage_bytes, blob_count,
       partner_count, company_count, user_count, active_user_count, product_count,
       document_count, audit_log_count, scan_event_count, invite_count, table_stats, blob_stats)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `,
    [
      dbSize.usedBytes,
      dbSize.maxBytes,
      blobStats?.available ? blobStats.totalBytes : null,
      blobStats?.available ? blobStats.totalCount : null,
      counts?.partner_count ?? 0,
      counts?.company_count ?? 0,
      counts?.user_count ?? 0,
      counts?.active_user_count ?? 0,
      counts?.product_count ?? 0,
      counts?.document_count ?? 0,
      counts?.audit_log_count ?? 0,
      counts?.scan_event_count ?? 0,
      counts?.invite_count ?? 0,
      tableStats ? JSON.stringify(tableStats) : null,
      blobStats ? JSON.stringify(blobStats) : null
    ]
  );
  cache.delete("latestSnapshot");
}

async function getLatestSnapshot() {
  return cached("latestSnapshot", 60000, async () =>
    queryOne(`SELECT * FROM system_metrics_snapshots ORDER BY taken_at DESC LIMIT 1`)
  );
}

async function getSnapshotSeries(days) {
  const params = [];
  let where = "";
  if (days) {
    params.push(days);
    where = "WHERE taken_at >= now() - make_interval(days => $1)";
  }
  return queryRows(
    `
    SELECT id, taken_at, database_size_bytes, database_max_bytes, blob_storage_bytes, blob_count,
           partner_count, company_count, user_count, active_user_count, product_count,
           document_count, audit_log_count, scan_event_count
    FROM system_metrics_snapshots
    ${where}
    ORDER BY taken_at ASC
  `,
    params
  );
}

async function getLastSnapshotAgeHours() {
  const row = await queryOne(`
    SELECT EXTRACT(EPOCH FROM (now() - MAX(taken_at))) / 60 AS age_minutes
    FROM system_metrics_snapshots
  `);
  const age = row?.age_minutes;
  return age == null ? null : Number(age) / 60;
}

// --- uurmetrics lezen/schrijven ---------------------------------------------------

// Meerdere function-instances schrijven naar dezelfde uurrij: tellers en sommen
// worden opgeteld, het maximum is het grootste, en de percentielen worden gewogen
// naar aantal requests samengevoegd (benadering, zo ook gelabeld in de UI).
async function persistHourlyMetrics(rows, bucketStart) {
  if (!rows.length) return;
  for (const row of rows) {
    await query(
      `
      INSERT INTO system_request_metrics_hourly AS h
        (bucket_start, scope, route, method, request_count, error_4xx_count, error_5xx_count,
         duration_sum_ms, duration_max_ms, p50_ms, p95_ms, p99_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (bucket_start, scope, route, method) DO UPDATE SET
        p50_ms = ROUND((COALESCE(h.p50_ms, 0)::numeric * h.request_count + COALESCE(EXCLUDED.p50_ms, 0) * EXCLUDED.request_count)
                       / NULLIF(h.request_count + EXCLUDED.request_count, 0)),
        p95_ms = ROUND((COALESCE(h.p95_ms, 0)::numeric * h.request_count + COALESCE(EXCLUDED.p95_ms, 0) * EXCLUDED.request_count)
                       / NULLIF(h.request_count + EXCLUDED.request_count, 0)),
        p99_ms = GREATEST(h.p99_ms, EXCLUDED.p99_ms),
        request_count = h.request_count + EXCLUDED.request_count,
        error_4xx_count = h.error_4xx_count + EXCLUDED.error_4xx_count,
        error_5xx_count = h.error_5xx_count + EXCLUDED.error_5xx_count,
        duration_sum_ms = h.duration_sum_ms + EXCLUDED.duration_sum_ms,
        duration_max_ms = GREATEST(h.duration_max_ms, EXCLUDED.duration_max_ms)
    `,
      [
        bucketStart,
        row.scope,
        String(row.route).slice(0, 200),
        row.method,
        row.requestCount,
        row.error4xx,
        row.error5xx,
        row.durationSumMs,
        row.durationMaxMs,
        row.p50Ms,
        row.p95Ms,
        row.p99Ms
      ]
    );
  }
}

async function getHourlyMetrics({ hours, scope }) {
  const params = [hours];
  let scopeWhere = "";
  if (scope) {
    params.push(scope);
    scopeWhere = "AND scope = $2";
  }
  return queryRows(
    `
    SELECT bucket_start, scope, route, method, request_count, error_4xx_count, error_5xx_count,
           duration_sum_ms, duration_max_ms, p50_ms, p95_ms, p99_ms
    FROM system_request_metrics_hourly
    WHERE bucket_start >= now() - make_interval(hours => $1) ${scopeWhere}
    ORDER BY bucket_start ASC
  `,
    params
  );
}

// Tijdserie over de uurdata, per uur of per dag geaggregeerd (SQL-side, compact).
async function getHourlySeries({ hours, scope, perDay = false }) {
  const params = [hours];
  let scopeWhere = "";
  if (scope) {
    params.push(scope);
    scopeWhere = "AND scope = $2";
  }
  const bucketExpr = perDay
    ? "(date_trunc('day', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')"
    : "bucket_start";
  const rows = await queryRows(
    `
    SELECT ${bucketExpr} AS bucket,
           SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx,
           SUM(duration_sum_ms) / NULLIF(SUM(request_count), 0) AS avg_ms,
           SUM(p95_ms::bigint * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms
    FROM system_request_metrics_hourly
    WHERE bucket_start >= now() - make_interval(hours => $1) ${scopeWhere}
    GROUP BY 1
    ORDER BY 1 ASC
  `,
    params
  );
  return rows.map((r) => ({
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
  const params = [hours];
  let scopeWhere = "";
  if (scope) {
    params.push(scope);
    scopeWhere = "AND scope = $2";
  }
  const rows = await queryRows(
    `
    SELECT scope, route, method,
           SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx,
           SUM(duration_sum_ms) / NULLIF(SUM(request_count), 0) AS avg_ms,
           MAX(duration_max_ms) AS max_ms,
           SUM(p95_ms::bigint * request_count) / NULLIF(SUM(request_count), 0) AS p95_ms,
           MAX(p99_ms) AS p99_ms
    FROM system_request_metrics_hourly
    WHERE bucket_start >= now() - make_interval(hours => $1) ${scopeWhere}
    GROUP BY scope, route, method
  `,
    params
  );
  return rows.map((r) => ({
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

// Requests/fouten sinds een tijdstip (voor de KPI "vandaag").
async function getRequestTotalsSince(sinceDate) {
  const row = await queryOne(
    `
    SELECT SUM(request_count) AS requests,
           SUM(error_4xx_count) AS errors4xx,
           SUM(error_5xx_count) AS errors5xx
    FROM system_request_metrics_hourly
    WHERE bucket_start >= $1
  `,
    [sinceDate]
  );
  return {
    requests: Number(row?.requests || 0),
    errors4xx: Number(row?.errors4xx || 0),
    errors5xx: Number(row?.errors5xx || 0)
  };
}

async function pruneOldMetrics({ hourlyRetentionDays, snapshotRetentionDays }) {
  await query(`DELETE FROM system_request_metrics_hourly WHERE bucket_start < now() - make_interval(days => $1)`, [
    hourlyRetentionDays
  ]);
  await query(`DELETE FROM system_metrics_snapshots WHERE taken_at < now() - make_interval(days => $1)`, [
    snapshotRetentionDays
  ]);
  // Verlopen sessies hebben geen functie meer (requireAuth weigert ze al).
  await query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`);
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
