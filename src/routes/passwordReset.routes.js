const express = require("express");
const { validateBody } = require("../middleware/validate");
const {
  startResetSchema,
  submitCodeSchema,
  submitPasswordSchema
} = require("../schemas/passwordReset.schema");
const nativeAuth = require("../services/nativeAuth.service");
const { HttpError } = require("../middleware/errorHandler");
const { resetLimiter } = require("../middleware/rateLimit");
const usersRepo = require("../repositories/users.repository");

const router = express.Router();

router.use(resetLimiter);

// Volledig publiek (geen requireAuth), zelfde stijl als inviteActivation.routes.js:
// dit is precies de "wachtwoord vergeten"-/eerste-wachtwoord-flow, die per definitie
// vóór het inloggen gebeurt. Elke stap is een dunne proxy naar Entra's SSPR-API -
// DPP slaat nergens een wachtwoord of continuation_token op.

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

    if (["succeeded", "completed"].includes(status) && req.body.email) {
      // Best-effort UX (geen beveiligingsgrens): na een geslaagde reset hoeft de
      // eerstvolgende login geen wijziging meer af te dwingen.
      await usersRepo.clearMustChangePasswordByEmail(req.body.email).catch(() => {});
    }

    res.json({ status });
  } catch (error) {
    if (mapNativeAuthError(error, next)) return;
    next(error);
  }
});

module.exports = router;
