const express = require("express");
const { validateBody } = require("../middleware/validate");
const {
  startResetSchema,
  submitCodeSchema,
  submitPasswordSchema
} = require("../schemas/passwordReset.schema");
const identity = require("../services/identity.service");
const { HttpError } = require("../middleware/errorHandler");
const { resetLimiter } = require("../middleware/rateLimit");
const { destroySessionsForUser } = require("../middleware/auth");
const usersRepo = require("../repositories/users.repository");
const { logAudit } = require("../utils/auditLog");
const { signToken, verifyToken } = require("../utils/signedToken");
const { getAppBaseUrl } = require("../utils/baseUrl");

const router = express.Router();

router.use(resetLimiter);

// "Wachtwoord vergeten" / eerste wachtwoord instellen, volledig publiek (vóór het
// inloggen). Supabase Auth stuurt een e-mail met een eenmalige code; DPP slaat
// nergens een wachtwoord of code op. Tussen de stappen gaat een kortlevend,
// door de server ondertekend token heen en weer (geen serverstatus nodig - past bij
// stateless Vercel Functions).
const START_TOKEN_TTL_MS = 30 * 60 * 1000;
const VERIFIED_TOKEN_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = Number(process.env.SUPABASE_OTP_LENGTH || 6);

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return null;
  return `${local.slice(0, 1)}***@${domain}`;
}

function expired() {
  return new HttpError(400, "Deze aanvraag is verlopen, begin opnieuw", undefined, "EXPIRED");
}

function assertConfigured() {
  if (!identity.isIdentityProviderConfigured()) {
    throw new HttpError(503, "Wachtwoordherstel is tijdelijk niet beschikbaar.", undefined, "AUTH_UNAVAILABLE");
  }
}

router.post("/start", validateBody(startResetSchema), async (req, res, next) => {
  try {
    assertConfigured();
    const email = req.body.email.trim().toLowerCase();
    try {
      await identity.startPasswordRecovery(email, { redirectTo: `${getAppBaseUrl(req)}/wachtwoord-vergeten` });
    } catch (error) {
      if (error instanceof identity.IdentityError && error.code === "RATE_LIMITED") {
        next(new HttpError(429, error.message, undefined, "RATE_LIMITED"));
        return;
      }
      if (!(error instanceof identity.IdentityError) || error.code !== "USER_NOT_FOUND") throw error;
      // Onbekend adres: bewust dezelfde respons, om niet te verklappen welke
      // e-mailadressen een account hebben.
    }
    res.json({
      continuationToken: signToken("password-reset-start", { email }, START_TOKEN_TTL_MS),
      codeLength: CODE_LENGTH,
      targetLabel: maskEmail(email)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/verify-code", validateBody(submitCodeSchema), async (req, res, next) => {
  try {
    const started = verifyToken(req.body.continuationToken, "password-reset-start");
    if (!started) {
      next(expired());
      return;
    }
    assertConfigured();

    let authUserId;
    try {
      ({ authUserId } = await identity.verifyRecoveryCode(started.email, req.body.code.trim()));
    } catch (error) {
      if (error instanceof identity.IdentityError) {
        const status = error.code === "RATE_LIMITED" ? 429 : 400;
        next(new HttpError(status, error.code === "RATE_LIMITED" ? error.message : "Ongeldige of verlopen code", undefined, error.code === "RATE_LIMITED" ? "RATE_LIMITED" : "INVALID_CODE"));
        return;
      }
      throw error;
    }

    res.json({
      continuationToken: signToken("password-reset-verified", { email: started.email, authUserId }, VERIFIED_TOKEN_TTL_MS)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/submit", validateBody(submitPasswordSchema), async (req, res, next) => {
  try {
    const verified = verifyToken(req.body.continuationToken, "password-reset-verified");
    if (!verified) {
      next(expired());
      return;
    }
    assertConfigured();

    try {
      await identity.setPassword(verified.authUserId, req.body.password);
    } catch (error) {
      if (error instanceof identity.IdentityError && error.code === "WEAK_PASSWORD") {
        next(new HttpError(400, error.message, { subError: "password_too_weak" }, "WEAK_PASSWORD"));
        return;
      }
      throw error;
    }

    // Na een geslaagde reset: geen gedwongen wijziging meer bij de volgende login, en
    // alle bestaande sessies van dit account zijn waardeloos (net als bij een reset
    // door een beheerder).
    const user = await usersRepo.getUserByAuthUserId(verified.authUserId);
    if (user) {
      await usersRepo.setMustChangePassword(user.id, false);
      await destroySessionsForUser(user.id);
      await logAudit({
        companyId: user.company_id,
        userId: user.id,
        action: "password_reset_self_service",
        entityType: "User",
        entityId: user.id
      });
    }

    res.json({ status: "completed" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
