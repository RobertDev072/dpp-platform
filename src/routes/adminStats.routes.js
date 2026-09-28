const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/permissions");
const { getPlatformStats } = require("../repositories/platformStats.repository");
const { isEntraLoginConfigured, isEntraGraphConfigured } = require("../config/entra");
const { getPublicBaseUrl } = require("../utils/publicUrl");
const { INVITE_EXPIRY_HOURS } = require("../services/invitation.service");

// Gemount op /api/admin: deze router ziet ook alle /api/admin/*-verzoeken die de andere
// admin-routers niet afhandelden. Daarom auth PER ROUTE en geen router.use(requireAuth):
// anders zou een onbekend pad een 401 geven in plaats van de gewone 404.
const router = express.Router();

const platformManage = [requireAuth, requirePermission(PERMISSIONS.PLATFORM_MANAGE)];

// Gelijk aan SESSION_DURATION_MS in middleware/auth.js (daar niet geëxporteerd).
const SESSION_HOURS = 8;

router.get("/stats", ...platformManage, async (req, res, next) => {
  try {
    res.json(await getPlatformStats());
  } catch (error) {
    next(error);
  }
});

// Alleen of iets geconfigureerd is — nooit de waarden van secrets, client-ids of tenant-ids.
router.get("/settings", ...platformManage, (req, res) => {
  res.json({
    entraLoginConfigured: isEntraLoginConfigured(),
    entraGraphConfigured: isEntraGraphConfigured(),
    publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL),
    publicBaseUrl: getPublicBaseUrl(req),
    trustProxy: process.env.TRUST_PROXY === "true",
    nodeEnv: process.env.NODE_ENV || null,
    sessionHours: SESSION_HOURS,
    inviteExpiryHours: INVITE_EXPIRY_HOURS
  });
});

module.exports = router;
