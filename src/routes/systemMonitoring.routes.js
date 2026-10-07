// Observability-API voor de Platform Owner. Alles hier is strikt owner-only
// (server-side afgedwongen, niet alleen menu-verbergen): Partner Admins,
// Bedrijfsbeheerders en Medewerkers krijgen 403, anoniem 401. Er lekken nooit
// secrets: alle foutteksten zijn gesaneerd en configuratie wordt uitsluitend
// als aanwezig/afwezig gerapporteerd (zelfde principe als config-status).

const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { PLATFORM_OWNER_ROLES } = require("../utils/roles");
const { THRESHOLDS } = require("../config/monitoring");
const requestMetrics = require("../monitoring/requestMetrics");
const collectors = require("../monitoring/collectors");
const { runHealthChecks } = require("../monitoring/health");

const router = express.Router();

router.use(requireAuth, requireRole(...PLATFORM_OWNER_ROLES));

const PERIODS = { "1h": 1, "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90, "1y": 24 * 365 };

function parsePeriod(value, fallback = "24h") {
  return PERIODS[value] ? value : fallback;
}

router.get("/health", async (req, res, next) => {
  try {
    res.json(await runHealthChecks());
  } catch (error) {
    next(error);
  }
});

// Samenvatting: platformstatus + KPI-kaarten. Alles gecachet of uit snapshots -
// deze route is goedkoop genoeg voor auto-refresh (30-60s).
router.get("/overview", async (req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [health, dbSize, latestSnapshot, snapshots30, persistedToday] = await Promise.all([
      runHealthChecks(),
      collectors.getDatabaseSize().catch(() => ({ usedBytes: null, maxBytes: null })),
      collectors.getLatestSnapshot().catch(() => null),
      collectors.getSnapshotSeries(31).catch(() => []),
      collectors.getRequestTotalsSince(startOfDay).catch(() => ({ requests: 0, errors4xx: 0, errors5xx: 0 }))
    ]);

    const live = requestMetrics.getLiveSnapshot();

    // "Vandaag" = gepersisteerde uren + het lopende (nog niet geflushte) uur.
    const requestsToday = persistedToday.requests + live.currentHour.overall.count;
    const errorsToday =
      persistedToday.errors4xx + persistedToday.errors5xx +
      live.currentHour.overall.errors4xx + live.currentHour.overall.errors5xx;

    const dbGrowth30 = collectors.computeGrowth(snapshots30, "database_size_bytes");
    const blobGrowth30 = collectors.computeGrowth(snapshots30, "blob_storage_bytes");

    res.json({
      health,
      uptime: {
        processStartedAt: live.startedAt,
        processUptimeSeconds: live.uptimeSeconds,
        note: "Uptime van de function-instance die dit verzoek afhandelde (Vercel start en stopt instances naar behoefte). Externe beschikbaarheidsmeting is niet actief."
      },
      kpis: {
        requestsToday,
        errorsToday,
        errorRateTodayPct: requestsToday ? Math.round((errorsToday / requestsToday) * 10000) / 100 : 0,
        avgApiMs: live.currentHour.perScope.api.avgMs,
        p95ApiMs: live.currentHour.perScope.api.p95Ms,
        databaseBytes: dbSize.usedBytes,
        databaseMaxBytes: dbSize.maxBytes,
        databaseGrowth30dBytes: dbGrowth30 ? Math.round(dbGrowth30.deltaTotal) : null,
        blobBytes: latestSnapshot?.blob_storage_bytes ?? null,
        blobGrowth30dBytes: blobGrowth30 ? Math.round(blobGrowth30.deltaTotal) : null
      },
      monitoringSince: snapshots30.length ? snapshots30[0].taken_at : null,
      snapshotCount: snapshots30.length,
      thresholds: THRESHOLDS
    });
  } catch (error) {
    next(error);
  }
});

router.get("/performance", async (req, res, next) => {
  try {
    const period = parsePeriod(req.query.period);
    const hours = PERIODS[period];
    const live = requestMetrics.getLiveSnapshot();

    // Korte periodes: fijne minuutresolutie uit memory; langere: uur-/dagdata uit DB.
    let series;
    if (period === "1h") {
      series = requestMetrics.getMinuteSeries(60);
    } else if (period === "24h") {
      series = await collectors.getHourlySeries({ hours });
    } else {
      series = await collectors.getHourlySeries({ hours, perDay: hours > 24 * 7 });
    }

    const endpoints = await collectors.getEndpointStats({ hours });
    // Lopende uur meenemen zodat "vandaag" niet leeg lijkt vlak na een flush.
    for (const r of live.currentHour.routes) {
      endpoints.push({
        scope: r.scope, route: r.route, method: r.method, requests: r.count,
        errors: r.errors4xx + r.errors5xx, errorRatePct: r.errorRatePct,
        avgMs: r.avgMs, maxMs: r.maxMs, p95Ms: r.p95Ms, p99Ms: r.p99Ms
      });
    }

    const byKey = new Map();
    for (const e of endpoints) {
      const key = `${e.scope}|${e.method}|${e.route}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...e });
      } else {
        const total = existing.requests + e.requests;
        existing.avgMs = total
          ? Math.round(((existing.avgMs || 0) * existing.requests + (e.avgMs || 0) * e.requests) / total)
          : null;
        existing.p95Ms = Math.max(existing.p95Ms || 0, e.p95Ms || 0) || null;
        existing.p99Ms = Math.max(existing.p99Ms || 0, e.p99Ms || 0) || null;
        existing.maxMs = Math.max(existing.maxMs || 0, e.maxMs || 0) || null;
        existing.requests = total;
        existing.errors += e.errors;
        existing.errorRatePct = total ? Math.round((existing.errors / total) * 10000) / 100 : 0;
      }
    }
    const merged = [...byKey.values()].filter((e) => e.requests > 0);

    const slowest = [...merged].sort((a, b) => (b.p95Ms || 0) - (a.p95Ms || 0)).slice(0, 10);
    const fastest = [...merged].filter((e) => e.requests >= 5).sort((a, b) => (a.p95Ms || 0) - (b.p95Ms || 0)).slice(0, 5);

    const scopes = {};
    for (const scope of ["api", "public", "page"]) {
      const rows = merged.filter((e) => e.scope === scope);
      const requests = rows.reduce((sum, e) => sum + e.requests, 0);
      const errors = rows.reduce((sum, e) => sum + e.errors, 0);
      scopes[scope] = {
        requests,
        errors,
        errorRatePct: requests ? Math.round((errors / requests) * 10000) / 100 : 0,
        avgMs: requests
          ? Math.round(rows.reduce((sum, e) => sum + (e.avgMs || 0) * e.requests, 0) / requests)
          : null,
        p95Ms: rows.length ? Math.max(...rows.map((e) => e.p95Ms || 0)) || null : null
      };
    }

    res.json({
      period,
      note: "Percentielen over langere periodes zijn gewogen samenvoegingen van uurlijkse metingen (benadering).",
      series,
      scopes,
      liveHour: live.currentHour.perScope,
      slowest,
      fastest,
      thresholds: { apiP95Ms: THRESHOLDS.apiP95Ms, publicP95Ms: THRESHOLDS.publicP95Ms, errorRatePct: THRESHOLDS.errorRatePct }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/database", async (req, res, next) => {
  try {
    const [size, perf, latestSnapshot, snapshots7, snapshots30] = await Promise.all([
      collectors.getDatabaseSize().catch(() => ({ usedBytes: null, maxBytes: null })),
      collectors.getDbPerformance(),
      collectors.getLatestSnapshot().catch(() => null),
      collectors.getSnapshotSeries(8).catch(() => []),
      collectors.getSnapshotSeries(31).catch(() => [])
    ]);

    // Tabelgroottes uit de laatste snapshot + groei per tabel t.o.v. 7/30 dagen terug.
    let tables = null;
    if (latestSnapshot?.table_stats) {
      const current = JSON.parse(latestSnapshot.table_stats);
      const parseOld = (row) => (row?.table_stats ? JSON.parse(row.table_stats) : null);
      const old7 = parseOld(snapshots7[0]);
      const old30 = parseOld(snapshots30[0]);
      const findBytes = (list, t) => list?.find((x) => x.table === t)?.bytes ?? null;
      const totalBytes = current.reduce((sum, t) => sum + t.bytes, 0);
      tables = current.map((t) => ({
        table: t.table,
        rows: t.rows,
        bytes: t.bytes,
        pctOfDatabase: totalBytes ? Math.round((t.bytes / totalBytes) * 1000) / 10 : null,
        growth7dBytes: findBytes(old7, t.table) != null ? t.bytes - findBytes(old7, t.table) : null,
        growth30dBytes: findBytes(old30, t.table) != null ? t.bytes - findBytes(old30, t.table) : null
      }));
    }

    const usedPct = size.usedBytes != null && size.maxBytes ? Math.round((size.usedBytes / size.maxBytes) * 1000) / 10 : null;

    res.json({
      sizeBytes: size.usedBytes,
      maxBytes: size.maxBytes,
      usedPct,
      freeBytes: size.usedBytes != null && size.maxBytes != null ? size.maxBytes - size.usedBytes : null,
      performance: perf,
      tables,
      tablesMeasuredAt: latestSnapshot?.taken_at ?? null,
      thresholds: { dbP95Ms: THRESHOLDS.dbP95Ms, dbCapacityPct: THRESHOLDS.dbCapacityPct }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/growth", async (req, res, next) => {
  try {
    const range = ["7d", "30d", "90d", "1y", "all"].includes(req.query.range) ? req.query.range : "30d";
    const days = { "7d": 7, "30d": 30, "90d": 90, "1y": 365, all: null }[range];

    const [series, size] = await Promise.all([
      collectors.getSnapshotSeries(days),
      collectors.getDatabaseSize().catch(() => ({ usedBytes: null, maxBytes: null }))
    ]);

    const [s1, s7, s30, s90] = await Promise.all([
      collectors.getSnapshotSeries(2),
      collectors.getSnapshotSeries(8),
      collectors.getSnapshotSeries(31),
      collectors.getSnapshotSeries(91)
    ]);

    const dbGrowth = {
      today: collectors.computeGrowth(s1, "database_size_bytes"),
      last7: collectors.computeGrowth(s7, "database_size_bytes"),
      last30: collectors.computeGrowth(s30, "database_size_bytes"),
      last90: collectors.computeGrowth(s90, "database_size_bytes")
    };
    const blobGrowth = {
      today: collectors.computeGrowth(s1, "blob_storage_bytes"),
      last7: collectors.computeGrowth(s7, "blob_storage_bytes"),
      last30: collectors.computeGrowth(s30, "blob_storage_bytes"),
      last90: collectors.computeGrowth(s90, "blob_storage_bytes")
    };

    // Prognose op de langste beschikbare betrouwbare trend (max 90 dagen).
    const trend = dbGrowth.last90 || dbGrowth.last30 || dbGrowth.last7;
    const blobTrend = blobGrowth.last90 || blobGrowth.last30 || blobGrowth.last7;
    const current = size.usedBytes;
    const latest = series.length ? series[series.length - 1] : null;
    const blobCurrent = latest?.blob_storage_bytes != null ? Number(latest.blob_storage_bytes) : null;

    const forecastFor = (value, growth) =>
      growth
        ? {
            in90d: collectors.forecast(value, growth.perDay, 90),
            in180d: collectors.forecast(value, growth.perDay, 180),
            in365d: collectors.forecast(value, growth.perDay, 365),
            perDayBytes: Math.round(growth.perDay),
            basedOnDays: Math.round(growth.days)
          }
        : null;

    const capacityDays = trend ? collectors.daysUntilCapacity(current, size.maxBytes, trend.perDay) : null;

    res.json({
      range,
      note: "Prognoses zijn trendberekeningen op basis van werkelijke snapshots; geen garantie.",
      monitoringSince: series.length ? series[0].taken_at : null,
      series: series.map((s) => ({
        timestamp: s.taken_at,
        databaseBytes: s.database_size_bytes != null ? Number(s.database_size_bytes) : null,
        blobBytes: s.blob_storage_bytes != null ? Number(s.blob_storage_bytes) : null,
        partners: s.partner_count,
        companies: s.company_count,
        users: s.user_count,
        products: s.product_count,
        documents: s.document_count,
        auditLogs: s.audit_log_count
      })),
      database: {
        currentBytes: current,
        maxBytes: size.maxBytes,
        growth: dbGrowth,
        forecast: forecastFor(current, trend),
        estimatedDaysUntilCapacity: capacityDays,
        capacityWarning: capacityDays != null && capacityDays <= THRESHOLDS.capacityForecastWarnDays
      },
      blobStorage: {
        currentBytes: blobCurrent,
        growth: blobGrowth,
        forecast: forecastFor(blobCurrent, blobTrend)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/storage", async (req, res, next) => {
  try {
    const [latestSnapshot, docBreakdown, snapshots30] = await Promise.all([
      collectors.getLatestSnapshot().catch(() => null),
      collectors.getDocumentStorageBreakdown().catch(() => null),
      collectors.getSnapshotSeries(31).catch(() => [])
    ]);

    let blob = null;
    if (latestSnapshot?.blob_stats) {
      const parsed = JSON.parse(latestSnapshot.blob_stats);
      blob = { ...parsed, measuredAt: latestSnapshot.taken_at };
    }

    const growth30 = collectors.computeGrowth(snapshots30, "blob_storage_bytes");

    res.json({
      blob,
      documentBreakdown: docBreakdown,
      documentBreakdownNote:
        "Verdeling per documenttype op basis van geregistreerde bestandsgroottes in de database (betrouwbaar). Productfoto's staan apart in de foto-container.",
      growth30dBytes: growth30 ? Math.round(growth30.deltaTotal) : null,
      avgFileBytes:
        blob?.available && blob.totalCount ? Math.round(blob.totalBytes / blob.totalCount) : null
    });
  } catch (error) {
    next(error);
  }
});

router.get("/usage", async (req, res, next) => {
  try {
    const [counts, scans, logins, growth, topScanned] = await Promise.all([
      collectors.getEntityCounts(),
      collectors.getScanStats(),
      collectors.getLoginStats(),
      collectors.getEntityGrowthThisMonth().catch(() => null),
      collectors.getTopScannedProducts().catch(() => [])
    ]);
    const live = requestMetrics.getLiveSnapshot();

    res.json({
      totals: {
        partners: counts.partner_count,
        companies: counts.company_count,
        users: counts.user_count,
        activeUsers: counts.active_user_count,
        products: counts.product_count,
        documents: counts.document_count,
        auditLogs: counts.audit_log_count,
        invites: counts.invite_count
      },
      growthLast30d: growth,
      qr: { scans: scans, topProductsLast30d: topScanned },
      logins,
      requestsSinceStart: live.totalsSinceStart.requests
    });
  } catch (error) {
    next(error);
  }
});

router.get("/errors", async (req, res, next) => {
  try {
    const live = requestMetrics.getLiveSnapshot();
    const hours = PERIODS[parsePeriod(req.query.period)];
    const series = await collectors.getHourlySeries({ hours });
    const totals = series.reduce(
      (acc, s) => ({ requests: acc.requests + s.requests, errors: acc.errors + s.errors }),
      { requests: 0, errors: 0 }
    );

    res.json({
      note: "Recente foutdetails komen uit het geheugen van de function-instance die dit verzoek afhandelde (op Vercel draaien er meerdere en ze worden regelmatig vervangen); aantallen per uur zijn blijvend opgeslagen.",
      recent: live.recentErrors,
      currentHour: {
        errors4xx: live.currentHour.overall.errors4xx,
        errors5xx: live.currentHour.overall.errors5xx
      },
      period: {
        requests: totals.requests,
        errors: totals.errors,
        errorRatePct: totals.requests ? Math.round((totals.errors / totals.requests) * 10000) / 100 : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/infra", async (req, res, next) => {
  try {
    // Deployment-info komt rechtstreeks uit de systeemvariabelen die Vercel aan elke
    // function meegeeft (geen build-info.json meer nodig). Commit-SHA ingekort.
    const sha = process.env.VERCEL_GIT_COMMIT_SHA || null;
    const build = sha || process.env.VERCEL_DEPLOYMENT_ID
      ? {
          commit: sha ? sha.slice(0, 7) : null,
          branch: process.env.VERCEL_GIT_COMMIT_REF || null,
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
          url: process.env.VERCEL_URL || null
        }
      : null;

    const memory = process.memoryUsage();
    const os = require("os");

    res.json({
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      nodeVersion: process.version,
      platform: process.env.VERCEL ? "Vercel" : "lokaal",
      region: process.env.VERCEL_REGION || null,
      note: "Proces- en geheugengegevens gelden voor de function-instance die dit verzoek afhandelde.",
      processUptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal
      },
      cpu: { loadAvg1m: os.loadavg()[0], cores: os.cpus().length },
      build
    });
  } catch (error) {
    next(error);
  }
});

// Handmatige snapshot ("Nu meten") - handig direct na ingebruikname, zodat de
// eerste meetpunten niet op de dagelijkse cyclus hoeven te wachten.
router.post("/snapshot", async (req, res, next) => {
  try {
    await collectors.takeSnapshot();
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
