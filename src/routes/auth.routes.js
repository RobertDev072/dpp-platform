const express = require("express");
const { loginSchema } = require("../schemas/auth.schema");
const { validateBody } = require("../middleware/validate");
const { rateLimit } = require("../middleware/rateLimit");
const { getUserByEmail } = require("../repositories/users.repository");
const { verifyPassword, DUMMY_HASH } = require("../utils/password");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { isEntraLoginConfigured } = require("../config/entra");
const { getHomePathForRole } = require("../services/entraLogin.service");
const { ROLES } = require("../auth/permissions");

const router = express.Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Sleutel voor de per-account limiter. Begrensd in lengte: de body is door de client te
// kiezen en elke unieke sleutel kost geheugen in de in-memory limiter.
function loginAccountKey(req) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 256) : "";
  return `${req.ip}|${email}`;
}

// Per ip, ruim boven normaal gebruik: begrenst password spraying over veel e-mailadressen,
// de bcrypt-CPU per client en het aantal sleutels in de per-account-limiter hieronder
// (staat daarom vóór die limiter: een geblokkeerde client maakt geen nieuwe sleutels meer
// aan). Zelfde TRUST_PROXY-caveat als publicApiLimiter; in Entra-modus is dit endpoint
// helemaal dicht, dus een gedeeld proxy-ip raakt dan niemand.
const loginLimiterPerIp = rateLimit({ windowMs: LOGIN_WINDOW_MS, max: 100 });

// Per ip+e-mail: remt brute-force op één account, zonder dat een aanvaller (mits
// TRUST_PROXY goed staat) andermans account vanaf zijn eigen ip kan laten dichtlopen.
// Beide limiters staan vóór de validatie, zodat ook ongeldige pogingen tellen.
const loginLimiterPerAccount = rateLimit({ windowMs: LOGIN_WINDOW_MS, max: 10, keyFn: loginAccountKey });

// In Entra-modus is Entra de enige identity provider. Een lokaal bcrypt-wachtwoord zou
// Entra en de MFA-policy (Conditional Access) omzeilen, ook voor de System Owner, en
// oude password_hash-waarden (seed-script, accounts van vóór Entra) blijven in de database
// staan. Daarom gaat het endpoint dan volledig dicht, nog vóór limiter, DB en bcrypt: het
// antwoord hangt niet van het account af (geen enumeratie of timing-lek) en de modus is
// via /api/auth/config toch al publiek.
function requireLocalLoginMode(req, res, next) {
  if (isEntraLoginConfigured()) {
    next(new HttpError(404, "Lokale login is uitgeschakeld; log in via Entra", undefined, "LOCAL_LOGIN_DISABLED"));
    return;
  }
  next();
}

// Publiek: de loginpagina kiest hiermee tussen het Entra-formulier (alleen e-mail, daarna
// door naar Entra) en het lokale e-mail+wachtwoordformulier. Geen andere config-details.
router.get("/config", (req, res) => {
  res.json({ mode: isEntraLoginConfigured() ? "entra" : "local" });
});

// Volgorde telt: eerst de modus-check, dan per ip (vóór per account, zie boven).
const loginGuards = [requireLocalLoginMode, loginLimiterPerIp, loginLimiterPerAccount];

router.post("/login", ...loginGuards, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    // Draai bcrypt.compare altijd, ook als de gebruiker niet bestaat of Entra-only is
    // (geen password_hash): anders is het tijdsverschil een enumeratie-lek.
    const hashToCheck = user && user.password_hash ? user.password_hash : DUMMY_HASH;
    const passwordMatches = await verifyPassword(password, hashToCheck);

    // Company-check pas ná bcrypt en met dezelfde generieke 401: een gebruiker van een
    // gedeactiveerde company mag niet kunnen afleiden dat zijn wachtwoord wel klopte.
    const companyActive = Boolean(user) && (user.role === ROLES.SYSTEM_OWNER || user.company_status === "active");

    if (!user || !user.password_hash || user.status !== "active" || !companyActive || !passwordMatches) {
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      action: "login",
      entityType: "User",
      entityId: user.id
    });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      redirectTo: getHomePathForRole(user.role)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.sessionToken);
    clearSessionCookie(res);

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.id,
      action: "logout",
      entityType: "User",
      entityId: req.user.id
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(req.user);
});

module.exports = router;
