const express = require("express");
const {
  requireAuth,
  requireRole,
  denyIfImpersonating,
  createSession,
  destroySession,
  setSessionCookie,
  getUserForToken,
  SESSION_COOKIE_NAME
} = require("../middleware/auth");
const usersRepo = require("../repositories/users.repository");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { assertCompanyAccess } = require("../utils/tenant");
const { PLATFORM_OWNER_ROLES } = require("../utils/roles");

const router = express.Router();

const ORIG_SESSION_COOKIE = "dpp_session_orig";
const IMPERSONATION_DURATION_MS = 60 * 60 * 1000; // 1 uur, bewust kort

// LET OP: de letterlijke route /impersonate/stop moet vóór /impersonate/:userId
// geregistreerd staan, anders matcht Express "stop" als :userId en eindigt de
// aanvraag bij de verkeerde handler (403 voor de geïmpersoneerde gebruiker).
// Stopt impersonatie en herstelt de eigen sessie. Werkt alleen als het bewaarde
// originele token daadwerkelijk toebehoort aan degene die als impersonator op de
// huidige sessie geregistreerd staat - een gemanipuleerde cookie faalt hier.
router.post("/impersonate/stop", requireAuth, async (req, res, next) => {
  try {
    if (!req.user.impersonator) {
      next(new HttpError(400, "Er is geen impersonatie actief"));
      return;
    }

    const origToken = req.cookies?.[ORIG_SESSION_COOKIE];
    const origUser = origToken ? await getUserForToken(origToken) : null;
    if (!origUser || origUser.id !== req.user.impersonator.id) {
      next(new HttpError(403, "Originele sessie niet gevonden of ongeldig"));
      return;
    }

    await destroySession(req.sessionToken);

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.impersonator.id,
      impersonatorUserId: req.user.impersonator.id,
      action: "impersonate_stop",
      entityType: "User",
      entityId: req.user.id,
      metadata: { targetEmail: req.user.email }
    });

    res.cookie(SESSION_COOKIE_NAME, origToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
      path: "/"
    });
    res.clearCookie(ORIG_SESSION_COOKIE, { path: "/" });

    res.json({ restored: { id: origUser.id, email: origUser.email, role: origUser.role } });
  } catch (error) {
    next(error);
  }
});

// Start impersonatie: de Platform Owner mag iedereen impersoneren, een company_admin
// alleen company_admin/company_user-accounts binnen het eigen bedrijf (assertCompanyAccess
// hieronder) - nooit genest, nooit een platform_owner. De eigen sessie blijft bestaan; het
// originele token gaat in een tweede httpOnly-cookie (de server kent alleen hashes, dus dit
// is de enige veilige herstelroute).
router.post(
  "/impersonate/:userId",
  requireAuth,
  requireRole(...PLATFORM_OWNER_ROLES, "company_admin"),
  denyIfImpersonating,
  async (req, res, next) => {
  try {
    const targetId = Number(req.params.userId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      next(new HttpError(400, "Ongeldig gebruikers-id"));
      return;
    }
    if (targetId === req.user.id) {
      next(new HttpError(400, "Je kunt jezelf niet impersoneren"));
      return;
    }

    const target = await usersRepo.getUserById(targetId);
    if (!target || !["company_admin", "company_user"].includes(target.role)) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    if (req.user.role === "company_admin") {
      assertCompanyAccess(req.user, target.company_id);
    }
    if (target.status !== "active") {
      next(new HttpError(409, "Alleen actieve gebruikers kunnen geïmpersoneerd worden"));
      return;
    }

    const { token, expiresAt } = await createSession(target.id, {
      impersonatorUserId: req.user.id,
      durationMs: IMPERSONATION_DURATION_MS
    });

    // Origineel token bewaren om straks te kunnen herstellen.
    res.cookie(ORIG_SESSION_COOKIE, req.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      expires: new Date(Date.now() + 8 * 60 * 60 * 1000),
      path: "/"
    });
    setSessionCookie(res, token, expiresAt);

    await logAudit({
      companyId: target.company_id,
      userId: req.user.id,
      impersonatorUserId: req.user.id,
      action: "impersonate_start",
      entityType: "User",
      entityId: target.id,
      metadata: { targetEmail: target.email, expiresAt }
    });

    res.json({
      impersonating: { id: target.id, email: target.email, role: target.role, companyId: target.company_id },
      expiresAt
    });
  } catch (error) {
    next(error);
  }
});

// Diagnose voor de Platform Owner: welke Entra-configuratie draait er op deze
// omgeving. Alleen niet-geheime identifiers (tenant/client-id's); secrets worden
// uitsluitend als aanwezig/afwezig gerapporteerd.
router.get("/config-status", requireAuth, requireRole(...PLATFORM_OWNER_ROLES), (req, res) => {
  const { getEntraConfigDiagnostics } = require("../config/entra");
  res.json({
    entra: getEntraConfigDiagnostics(),
    appBaseUrl: process.env.APP_BASE_URL || null,
    qrBaseUrl: process.env.QR_BASE_URL || null
  });
});

module.exports = router;
