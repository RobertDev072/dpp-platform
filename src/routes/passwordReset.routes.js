const express = require("express");
const { validateBody } = require("../middleware/validate");
const {
  startResetSchema,
  submitCodeSchema,
  submitPasswordSchema
} = require("../schemas/passwordReset.schema");
const nativeAuth = require("../services/nativeAuth.service");
const { isLegacyEntraConfigured } = require("../config/entra");
const { HttpError } = require("../middleware/errorHandler");
const { resetLimiter } = require("../middleware/rateLimit");
const usersRepo = require("../repositories/users.repository");
const { hashPassword } = require("../utils/password");
const { logAudit } = require("../utils/auditLog");

const router = express.Router();

router.use(resetLimiter);

// Zelfservice "wachtwoord vergeten" bestaat alleen tijdens de Entra-overgangsfase
// (Entra verstuurt de verificatiecode per e-mail; VeriPasso heeft bewust geen eigen
// e-mailverzending). Daarna: wachtwoordreset via de beheerder (tijdelijk wachtwoord).
router.use((req, res, next) => {
  if (!isLegacyEntraConfigured()) {
    next(
      new HttpError(
        503,
        "Wachtwoord herstellen via e-mail is niet beschikbaar. Vraag je beheerder om een tijdelijk wachtwoord.",
        undefined,
        "SELF_SERVICE_RESET_UNAVAILABLE"
      )
    );
    return;
  }
  next();
});

// Volledig publiek (geen requireAuth), zelfde stijl als inviteActivation.routes.js.
// Elke stap is een dunne proxy naar Entra's SSPR-API - DPP slaat nergens een
// continuation_token op.

function mapNativeAuthError(error, next) {
  if (error instanceof nativeAuth.NativeAuthError) {
    next(new HttpError(400, error.message, { subError: error.subError }, error.code));
    return true;
  }
  return false;
}

router.post("/start", validateBody(startResetSchema), async (req, res, next) => {
  try {
    const started = await nativeAuth.startPasswordReset({ email: req.body.email });
    const challenged = await nativeAuth.requestPasswordResetCode({
      continuationToken: started.continuationToken
    });
    res.json({
      continuationToken: challenged.continuationToken,
      codeLength: challenged.codeLength,
      targetLabel: challenged.targetLabel
    });
  } catch (error) {
    if (error instanceof nativeAuth.NativeAuthError && error.code === "USER_NOT_FOUND") {
      // Bewust geen 404: niet verklappen of een e-mailadres bestaat. De gebruiker ziet
      // altijd "als dit adres bekend is, is er een code verstuurd".
      res.json({ continuationToken: null });
      return;
    }
    if (mapNativeAuthError(error, next)) return;
    next(error);
  }
});

router.post("/verify-code", validateBody(submitCodeSchema), async (req, res, next) => {
  try {
    const result = await nativeAuth.submitPasswordResetCode({
      continuationToken: req.body.continuationToken,
      code: req.body.code
    });
    res.json({ continuationToken: result.continuationToken });
  } catch (error) {
    if (mapNativeAuthError(error, next)) return;
    next(error);
  }
});

// Neemt een bij Entra geslaagde reset over als lokaal wachtwoord. Het e-mailadres in
// de body is NIET te vertrouwen (de continuation_token zegt niet van wie hij is), dus
// eerst bij Entra bevestigen dat precies dit adres met precies dit nieuwe wachtwoord
// inlogt. Pas dan wordt de lokale hash gezet.
async function adoptResetPassword(email, password) {
  if (!email) return;
  const user = await usersRepo.getUserByEmail(email);
  if (!user || user.status !== "active") return;
  try {
    await nativeAuth.verifyPassword({ email: user.email, password });
  } catch {
    return;
  }
  await usersRepo.updatePasswordHash(user.id, await hashPassword(password));
  await usersRepo.setMustChangePassword(user.id, false);
  await logAudit({
    companyId: user.company_id,
    userId: user.id,
    action: "password_migrated",
    entityType: "User",
    entityId: user.id,
    metadata: { from: "entra-sspr" }
  });
}

router.post("/submit", validateBody(submitPasswordSchema), async (req, res, next) => {
  try {
    await nativeAuth.submitNewPassword({
      continuationToken: req.body.continuationToken,
      password: req.body.password,
      code: req.body.code
    });

    // Wachtwoordwijziging kan een fractie vertraagd zijn aan Entra's kant - kort
    // pollen i.p.v. de frontend hiermee te belasten.
    let status = "pending";
    for (let attempt = 0; attempt < 5 && status === "pending"; attempt += 1) {
      const polled = await nativeAuth.pollPasswordResetCompletion({
        continuationToken: req.body.continuationToken
      });
      status = polled.status;
      if (status === "pending") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (["succeeded", "completed"].includes(status)) {
      await adoptResetPassword(req.body.email, req.body.password).catch((error) => {
        console.error("Wachtwoord overnemen na Entra-reset mislukt:", error.message);
      });
    }

    res.json({ status });
  } catch (error) {
    if (mapNativeAuthError(error, next)) return;
    next(error);
  }
});

module.exports = router;
