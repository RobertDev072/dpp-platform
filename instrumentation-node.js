// Alleen in de Node.js-runtime geladen (zie instrumentation.js): start de
// achtergrondtaken (telemetrie wegschrijven, dagelijks onderhoud) en zorgt voor een
// nette afsluiting bij een SIGTERM (Lambda stopt een omgeving, of een container stopt): eerst de laatste
// telemetrie wegschrijven en de databasepool sluiten.
import schedulerModule from "./src/monitoring/scheduler";
import dbModule from "./src/config/db";

const scheduler = schedulerModule;
const { close } = dbModule;

// Op Lambda bevriest het proces tussen verzoeken: timers zijn daar onbetrouwbaar. Het
// onderhoud komt dan elk uur via EventBridge (POST /api/internal/events); telemetrie
// wordt na verzoeken weggeschreven (scheduler.afterRequest).
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) scheduler.startBackgroundJobs();

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await scheduler.stopBackgroundJobs();
    await close();
  } catch {
    // Afsluiten mag nooit blijven hangen op een fout.
  }
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
