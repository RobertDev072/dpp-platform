const crypto = require("crypto");
const express = require("express");
const { SCHEDULE } = require("../config/monitoring");
const collectors = require("../monitoring/collectors");
const { pruneExpiredRateLimits } = require("../middleware/rateLimitStore");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Vercel Cron roept deze routes aan met "Authorization: Bearer <CRON_SECRET>"
// (zie vercel.json). Zonder (juiste) CRON_SECRET: 401, ook voor de owner - dit is
// geen gebruikersendpoint.
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const header = req.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    header.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  ) {
    next(new HttpError(401, "Niet geautoriseerd"));
    return;
  }
  next();
}

router.use(requireCronSecret);

// Dagelijks (vervangt de in-process scheduler van de App Service): metrics-snapshot
// (DB-grootte, tabellen, tellingen, opslag) en opschonen van oude meetdata,
// verlopen sessies en rate-limit-tellers. De leeftijdscheck voorkomt dubbele
// snapshots als Vercel de cron een keer herhaalt.
router.get("/daily", async (req, res, next) => {
  try {
    const ageHours = await collectors.getLastSnapshotAgeHours();
    let snapshot = "overgeslagen (recente snapshot aanwezig)";
    if (ageHours == null || ageHours >= SCHEDULE.snapshotMinAgeHours) {
      await collectors.takeSnapshot();
      snapshot = "vastgelegd";
    }
    await collectors.pruneOldMetrics(SCHEDULE);
    await pruneExpiredRateLimits();
    await require("../services/productImport.service").expireStaleJobs();
    res.json({ ok: true, snapshot });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
