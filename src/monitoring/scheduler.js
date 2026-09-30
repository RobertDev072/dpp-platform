// Monitoring-scheduler: draait in het app-proces zelf (geen extra Azure-resources,
// geen kosten). Twee taken:
// 1. Uurlijks: in-memory request-telemetrie wegschrijven naar SystemRequestMetricsHourly.
// 2. Dagelijks (zodra de laatste snapshot > 22 uur oud is): volledige metrics-snapshot
//    (DB-grootte, tabellen, tellingen, blob-opslag) + opschoning van oude data.
// Wordt uitsluitend gestart vanuit server.js - tests en scripts starten dus nooit
// per ongeluk timers of extra snapshots.

const { SCHEDULE } = require("../config/monitoring");
const requestMetrics = require("./requestMetrics");
const collectors = require("./collectors");

let started = false;

async function flushHourly() {
  try {
    const rows = requestMetrics.drainHourRoutes();
    if (!rows.length) return;
    // Bucket = het uur dat zojuist is afgesloten.
    const bucketStart = new Date();
    bucketStart.setUTCMinutes(0, 0, 0);
    bucketStart.setUTCHours(bucketStart.getUTCHours() - 1);
    await collectors.persistHourlyMetrics(rows, bucketStart);
  } catch (error) {
    console.error("Monitoring: uurflush mislukt (telemetrie gaat verder):", error.message);
  }
}

async function maybeSnapshot() {
  try {
    const ageHours = await collectors.getLastSnapshotAgeHours();
    if (ageHours != null && ageHours < SCHEDULE.snapshotMinAgeHours) return;
    await collectors.takeSnapshot();
    await collectors.pruneOldMetrics(SCHEDULE);
    console.log("Monitoring: dagelijkse metrics-snapshot vastgelegd.");
  } catch (error) {
    console.error("Monitoring: snapshot mislukt (volgende poging over een uur):", error.message);
  }
}

function start() {
  if (started) return;
  started = true;

  // Uurflush, gealigneerd op hele uren zodat de buckets netjes aansluiten.
  const msToNextHour = 3600000 - (Date.now() % 3600000);
  setTimeout(() => {
    flushHourly();
    setInterval(flushHourly, SCHEDULE.flushIntervalMs).unref();
  }, msToNextHour).unref();

  // Snapshot-check: bij het opstarten (na korte vertraging, zodat de app eerst
  // gewoon opstart) en daarna elk uur. De leeftijdscheck voorkomt dubbele
  // snapshots bij herstarts.
  setTimeout(maybeSnapshot, 90 * 1000).unref();
  setInterval(maybeSnapshot, SCHEDULE.snapshotCheckIntervalMs).unref();

  console.log("Monitoring-scheduler actief (uurflush + dagelijkse snapshot).");
}

module.exports = { start, flushHourly, maybeSnapshot };
