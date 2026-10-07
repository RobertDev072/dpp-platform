// Monitoring-onderhoud op Vercel (serverless: geen langlopend proces, dus geen
// setInterval-timers). Twee mechanismen, beide zonder extra diensten of kosten:
// 1. Telemetrie wegschrijven: na een request kijkt afterRequest() of de in-memory
//    aggregaten van deze instance "rijp" zijn (elke paar minuten, of zodra er een
//    nieuw uur is begonnen) en schrijft ze dan op de achtergrond weg (waitUntil).
//    Elke instance schrijft zijn eigen deel; de leesqueries tellen dat op.
// 2. Dagelijks onderhoud: Vercel Cron roept /api/cron/daily aan (zie vercel.json en
//    routes/cron.routes.js) voor de metrics-snapshot en het opschonen van oude data.

const { SCHEDULE } = require("../config/monitoring");
const requestMetrics = require("./requestMetrics");
const collectors = require("./collectors");

let lastFlushAt = Date.now();
let flushing = false;

async function flushHourly() {
  try {
    const { rows, bucketStart } = requestMetrics.drainHourRoutes();
    if (!rows.length) return;
    await collectors.persistHourlyMetrics(rows, bucketStart);
  } catch (error) {
    console.error("Monitoring: telemetrie wegschrijven mislukt (telemetrie gaat verder):", error.message);
  }
}

function keepAliveUntilDone(promise) {
  try {
    require("@vercel/functions").waitUntil(promise);
  } catch {
    // Buiten Vercel (lokaal/tests) loopt de promise gewoon door in het proces.
  }
}

function afterRequest() {
  if (flushing) return;
  const due = Date.now() - lastFlushAt >= SCHEDULE.flushIntervalMs || requestMetrics.hourChanged();
  if (!due) return;
  flushing = true;
  const done = flushHourly().finally(() => {
    flushing = false;
    lastFlushAt = Date.now();
  });
  keepAliveUntilDone(done);
}

async function maybeSnapshot() {
  const ageHours = await collectors.getLastSnapshotAgeHours();
  if (ageHours != null && ageHours < SCHEDULE.snapshotMinAgeHours) return false;
  await collectors.takeSnapshot();
  return true;
}

// Aangeroepen door de dagelijkse cron. De leeftijdscheck voorkomt dubbele snapshots
// (bijv. als de cron opnieuw wordt geprobeerd of iemand net "Nu meten" deed).
async function runDailyMaintenance() {
  await flushHourly();
  const snapshotTaken = await maybeSnapshot();
  await collectors.pruneOldMetrics(SCHEDULE);
  return { snapshotTaken };
}

module.exports = { afterRequest, flushHourly, maybeSnapshot, runDailyMaintenance };
