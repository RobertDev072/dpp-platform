const express = require("express");
const { HttpError } = require("../middleware/errorHandler");
const logger = require("../utils/logger");

// Interne taken op AWS Lambda. De Lambda Web Adapter stuurt een directe aanroep van de
// functie (geen HTTP-verzoek: EventBridge-planner of `aws lambda invoke` vanuit de
// uitrol-workflow) als POST naar dit pad (AWS_LWA_PASS_THROUGH_PATH).
//
// Afscherming, dubbel:
// 1. Alleen actief met INTERNAL_EVENTS_ENABLED=true (alleen op Lambda gezet).
// 2. De adapter zet x-amzn-request-context op elke aanroep: bij een HTTP-verzoek via de
//    Function URL een JSON-object (wordt hier geweigerd), bij een directe aanroep
//    (waarvoor IAM-rechten op de functie nodig zijn) de waarde "null".
// Daarnaast blokkeert de CloudFront-domeinrouter /api/internal/* voor bezoekers.
//
// Taken (body):
//   EventBridge-planner ({ "source": "aws.events", ... }) of { "task": "maintenance" }
//   { "task": "migrate" }
//   { "task": "backfill" }
//   { "task": "seed-owner", "email", "password", "firstName", "lastName" }

// Zelfde regel als in proxy.js (ESM, daar niet te importeren).
function isFunctionUrlRequest(requestContext) {
  if (!requestContext) return false;
  try {
    const parsed = JSON.parse(requestContext);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return true;
  }
}

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    if (process.env.INTERNAL_EVENTS_ENABLED !== "true" || isFunctionUrlRequest(req.get("x-amzn-request-context"))) {
      throw new HttpError(404, "Niet gevonden");
    }
    const body = req.body || {};
    const task = body.task || (body.source === "aws.events" ? "maintenance" : null);
    const started = Date.now();
    let result;

    switch (task) {
      case "maintenance": {
        const scheduler = require("../monitoring/scheduler");
        await scheduler.flushHourly();
        result = await scheduler.runDailyMaintenance();
        break;
      }
      case "migrate":
        result = await require("../db/migrator").runMigrations({ log: (line) => logger.info("migration", { line }) });
        break;
      case "backfill": {
        const { backfillInitialVersions } = require("../services/passportArchive.service");
        let total = 0;
        for (;;) {
          const created = await backfillInitialVersions({ limit: 500 });
          total += created;
          if (created < 500) break;
        }
        result = { backfilledVersions: total };
        break;
      }
      case "seed-owner": {
        const { seedSystemOwner } = require("../db/ownerSeed");
        const seeded = await seedSystemOwner({
          email: body.email,
          password: body.password,
          firstName: body.firstName || null,
          lastName: body.lastName || null
        });
        result = { created: seeded.created };
        break;
      }
      default:
        throw new HttpError(400, "Onbekende taak");
    }

    logger.info("internal_task", { task, durationMs: Date.now() - started });
    res.json({ ok: true, task, result });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logger.error("internal_task_failed", { errorMessage: error.message });
    }
    next(error);
  }
});

module.exports = router;
