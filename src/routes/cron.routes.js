const crypto = require("crypto");
const express = require("express");
const { HttpError } = require("../middleware/errorHandler");
const { runDailyMaintenance } = require("../monitoring/scheduler");

const router = express.Router();

// Vercel Cron stuurt "Authorization: Bearer <CRON_SECRET>" mee (env-var in Vercel).
// Zonder geldige secret bestaat deze route voor de buitenwereld niet (404).
function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.get("authorization") || "");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

router.get("/daily", async (req, res, next) => {
  if (!isAuthorizedCron(req)) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  try {
    res.json({ ok: true, ...(await runDailyMaintenance()) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
