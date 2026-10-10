// Achtergrondonderhoud in het langlopende Node-proces (ECS Fargate-taak). Geen aparte
// cron-dienst nodig:
// 1. Telemetrie wegschrijven: na een request kijkt afterRequest() of de in-memory
//    aggregaten van deze taak "rijp" zijn (elke paar minuten, of zodra er een nieuw
//    uur is begonnen) en schrijft ze dan weg. Elke taak schrijft zijn eigen deel; de
//    leesqueries tellen dat op. Een interval-timer vangt rustige periodes op.
// 2. Dagelijks onderhoud (metrics-snapshot, oude telemetrie opschonen, ontbrekende
//    paspoortversies aanvullen): een timer per taak, maar met een lease-lock in de
//    database (dbo.joblocks) zodat bij meerdere taken er precies één het werk doet.
//
// De timers worden gestart vanuit instrumentation.js (één keer per serverproces) en
// nooit in tests (daar roepen de tests de functies zelf aan).

const { SCHEDULE } = require("../config/monitoring");
const requestMetrics = require("./requestMetrics");
const collectors = require("./collectors");
const logger = require("../utils/logger");

const crypto = require("crypto");

const DAILY_LOCK_NAME = "daily-maintenance";
const DAILY_LOCK_LEASE_MINUTES = 30;
// Uniek per proces: alleen de houder kan zijn eigen lease vrijgeven.
const INSTANCE_ID = `${process.env.HOSTNAME || "local"}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

let lastFlushAt = Date.now();
let flushing = false;
let timers = [];

async function flushHourly() {
  try {
    const { rows, bucketStart } = requestMetrics.drainHourRoutes();
    if (!rows.length) return;
    await collectors.persistHourlyMetrics(rows, bucketStart);
  } catch (error) {
    logger.error("telemetry_flush_failed", { errorMessage: error.message });
  }
}

function afterRequest() {
  if (flushing) return;
  const due = Date.now() - lastFlushAt >= SCHEDULE.flushIntervalMs || requestMetrics.hourChanged();
  if (!due) return;
  flushing = true;
  flushHourly().finally(() => {
    flushing = false;
    lastFlushAt = Date.now();
  });
}

async function maybeSnapshot() {
  const ageHours = await collectors.getLastSnapshotAgeHours();
  if (ageHours != null && ageHours < SCHEDULE.snapshotMinAgeHours) return false;
  await collectors.takeSnapshot();
  return true;
}

// Voert fn uit onder een lease-lock; geeft null terug als een andere taak het werk
// al doet. Er wordt geen verbinding vastgehouden tijdens het werk.
async function withLease(name, leaseMinutes, fn) {
  const { getPool } = require("../config/db");
  const pool = await getPool();
  const acquired = await pool.query(
    `INSERT INTO dbo.joblocks (name, locked_until, locked_by)
     VALUES ($1, now() + make_interval(mins => $2), $3)
     ON CONFLICT (name) DO UPDATE
       SET locked_until = EXCLUDED.locked_until, locked_by = EXCLUDED.locked_by
       WHERE dbo.joblocks.locked_until < now()
     RETURNING name`,
    [name, leaseMinutes, INSTANCE_ID]
  );
  if (!acquired.rows.length) return null;
  try {
    return await fn();
  } finally {
    await pool
      .query("UPDATE dbo.joblocks SET locked_until = now() WHERE name = $1 AND locked_by = $2", [name, INSTANCE_ID])
      .catch(() => {});
  }
}

// De leeftijdscheck voorkomt dubbele snapshots (bijv. na een herstart of als iemand
// net "Nu meten" deed).
async function runDailyMaintenance() {
  const result = await withLease(DAILY_LOCK_NAME, DAILY_LOCK_LEASE_MINUTES, async () => {
    await flushHourly();
    const snapshotTaken = await maybeSnapshot();
    await collectors.pruneOldMetrics(SCHEDULE);
    // Compliance (EN 18221, archivering): gepubliceerde paspoorten zonder
    // vastgelegde versie (bijv. gepubliceerd vóór de invoering van het archief)
    // krijgen hun basisversie.
    const { backfillInitialVersions } = require("../services/passportArchive.service");
    const backfilled = await backfillInitialVersions({ limit: SCHEDULE.versionBackfillBatch });
    return { snapshotTaken, backfilledVersions: backfilled };
  });
  return result ?? { skipped: true };
}

function startBackgroundJobs() {
  if (timers.length) return;
  const flushTimer = setInterval(() => {
    flushHourly().finally(() => {
      lastFlushAt = Date.now();
    });
  }, SCHEDULE.flushIntervalMs);

  const maintenance = () =>
    runDailyMaintenance()
      .then((outcome) => logger.info("daily_maintenance", outcome))
      .catch((error) => logger.error("daily_maintenance_failed", { errorMessage: error.message }));
  // Eerste keer kort na het starten (de leeftijdscheck maakt dat goedkoop), daarna elk uur
  // kijken of de snapshot ouder is dan de drempel.
  const firstRun = setTimeout(maintenance, SCHEDULE.maintenanceInitialDelayMs);
  const maintenanceTimer = setInterval(maintenance, SCHEDULE.maintenanceCheckIntervalMs);

  timers = [flushTimer, firstRun, maintenanceTimer];
  // Timers houden het proces niet in leven: een SIGTERM van ECS sluit netjes af.
  for (const timer of timers) timer.unref?.();
}

// Bij afsluiten (SIGTERM van ECS): timers stoppen en de laatste telemetrie wegschrijven.
async function stopBackgroundJobs() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  await flushHourly();
}

module.exports = {
  afterRequest,
  flushHourly,
  maybeSnapshot,
  runDailyMaintenance,
  startBackgroundJobs,
  stopBackgroundJobs
};
