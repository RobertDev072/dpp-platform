// Persistentie van de request-telemetrie op Vercel. Er is geen langlevend
// serverproces meer (geen setInterval-scheduler zoals op de Azure App Service):
// na een request controleert de instance of zijn laatste flush > FLUSH_INTERVAL_MS
// geleden is en telt dan zijn aggregaten op bij de uurrij in de database. De
// aanroeper geeft de belofte aan waitUntil(), zodat Vercel de function laat
// afronden nadat de response al verstuurd is.
//
// De zware dagelijkse taak (snapshot + opschonen) draait via Vercel Cron, zie
// /api/cron/daily (src/routes/cron.routes.js) en vercel.json.

const { SCHEDULE } = require("../config/monitoring");
const requestMetrics = require("./requestMetrics");

let lastFlushAt = Date.now();
let flushing = null;

async function flushNow() {
  const bucketStart = requestMetrics.pendingBucketStart();
  const rows = requestMetrics.drainHourRoutes();
  lastFlushAt = Date.now();
  if (!rows.length || !bucketStart) return;
  try {
    // Lazy require: houdt deze module licht en voorkomt een require-cyclus.
    await require("./collectors").persistHourlyMetrics(rows, bucketStart);
  } catch (error) {
    console.error("Monitoring: flush mislukt (telemetrie gaat verder):", error.message);
  }
}

// Geeft altijd een promise terug (eventueel al opgelost); nooit een fout.
function maybeFlush() {
  if (flushing) return flushing;
  const hourChanged =
    requestMetrics.pendingBucketStart() &&
    requestMetrics.pendingBucketStart().getTime() !== new Date(new Date().setUTCMinutes(0, 0, 0)).getTime();
  if (!hourChanged && Date.now() - lastFlushAt < SCHEDULE.flushIntervalMs) {
    return Promise.resolve();
  }
  flushing = flushNow().finally(() => {
    flushing = null;
  });
  return flushing;
}

module.exports = { maybeFlush, flushNow };
