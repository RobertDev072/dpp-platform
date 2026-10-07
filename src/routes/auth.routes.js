const express = require("express");
const { loginSchema, updateMeSchema, changePasswordSchema } = require("../schemas/auth.schema");
const usersRepo = require("../repositories/users.repository");
const { updateUser, getUserByEmail } = usersRepo;
const { hashPassword, verifyPassword, DUMMY_HASH } = require("../utils/password");
const { validateBody } = require("../middleware/validate");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const nativeAuth = require("../services/nativeAuth.service");
const { isLegacyEntraConfigured } = require("../config/entra");
const { loginIpLimiter, loginEmailLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Vloer voor de responstijd van mislukte logins: het lokale bcrypt-pad (~230ms) en
// het Entra-overgangspad (2-3 netwerk-roundtrips) verschillen anders meetbaar in duur,
// waarmee een aanvaller zou kunnen aftasten welke e-mailadressen nog niet zijn
// overgezet. Met een vaste ondergrens is dat timingkanaal in de praktijk dichtgedrukt.
const FAILED_LOGIN_MIN_MS = 1200;

async function padFailedLogin(startedAt) {
  const remaining = FAILED_LOGIN_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

// Controleert het wachtwoord van een account. Normaal lokaal (bcrypt). Een account
// zonder lokale hash is nog in Entra aangemaakt: tijdens de overgangsfase wordt het
// wachtwoord daar één keer gecontroleerd en daarna als bcrypt-hash opgeslagen, zodat
// de gebruiker voortaan volledig lokaal inlogt (zie config/entra.js).
// Geeft "ok", "invalid" of "reset_required" terug.
async function checkPassword(user, password) {
  if (user.password_hash) {
    return (await verifyPassword(password, user.password_hash)) ? "ok" : "invalid";
  }

  if (!isLegacyEntraConfigured()) {
    await verifyPassword(password, DUMMY_HASH);
    return "invalid";
  }

  try {
    await nativeAuth.verifyPassword({ email: user.email, password });
  } catch (err) {
    if (err instanceof nativeAuth.NativeAuthError) {
      return err.code === "PASSWORD_RESET_REQUIRED" ? "reset_required" : "invalid";
    }
    throw err;
  }

  await usersRepo.updatePasswordHash(user.id, await hashPassword(password));
  user.password_hash = "migrated";
  await logAudit({
    companyId: user.company_id,
    userId: user.id,
    action: "password_migrated",
    entityType: "User",
    entityId: user.id,
    metadata: { from: "entra" }
  });
  return "ok";
}

router.post("/login", loginIpLimiter, loginEmailLimiter, validateBody(loginSchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    if (!user || user.status !== "active") {
      // Draai alsnog een bcrypt-vergelijking tegen een dummy-hash: voorkomt dat de
      // afwezigheid van deze stap zelf al een (grof) timing-enumeratielek wordt.
      await verifyPassword(password, DUMMY_HASH);
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    const outcome = await checkPassword(user, password);
    if (outcome === "reset_required") {
      // Alleen bereikbaar mét een geldig account (Entra herkende de gebruiker),
      // dus deze specifieke melding lekt geen accountbestaan.
      await padFailedLogin(startedAt);
      next(
        new HttpError(
          401,
          "Je wachtwoord moet opnieuw worden ingesteld. Gebruik 'Wachtwoord vergeten' of vraag je beheerder om een tijdelijk wachtwoord.",
          undefined,
          "PASSWORD_RESET_REQUIRED"
        )
      );
      return;
    }
    if (outcome !== "ok") {
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    if (user.must_change_password) {
      // Wachtwoord klopt, maar het is een tijdelijk wachtwoord: eerst een eigen
      // wachtwoord instellen (via /change-password), pas daarna een sessie.
      res.json({ mustChangePassword: true });
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
      companyId: user.company_id
    });
  } catch (error) {
    next(error);
  }
});

// Gedwongen wachtwoordwijziging: geverifieerd met het (tijdelijke) huidige wachtwoord,
// daarna direct ingelogd met het nieuwe. Geen sessie nodig - dit is precies de stap
// tussen "tijdelijk wachtwoord klopt" en "sessie aanmaken" in.
router.post(
  "/change-password",
  loginIpLimiter,
  loginEmailLimiter,
  validateBody(changePasswordSchema),
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const { email, currentPassword, newPassword } = req.body;
      const user = await getUserByEmail(email);

      if (!user || user.status !== "active") {
        await verifyPassword(currentPassword, DUMMY_HASH);
        await padFailedLogin(startedAt);
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }

      if ((await checkPassword(user, currentPassword)) !== "ok") {
        await padFailedLogin(startedAt);
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }

      await usersRepo.updatePasswordHash(user.id, await hashPassword(newPassword));
      await usersRepo.setMustChangePassword(user.id, false);

      const { token, expiresAt } = await createSession(user.id);
      setSessionCookie(res, token, expiresAt);

      await logAudit({
        companyId: user.company_id,
        userId: user.id,
        action: "change_password",
        entityType: "User",
        entityId: user.id
      });

      res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.company_id
      });
    } catch (error) {
      next(error);
    }
  }
);

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
  res.json(req.user);
});

// Eigen profiel bijwerken: alleen naamvelden (schema dwingt dat af).
router.patch("/me", requireAuth, validateBody(updateMeSchema), async (req, res, next) => {
  try {
    await updateUser(req.user.id, {
      firstName: req.body.firstName,
      lastName: req.body.lastName
    });

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.id,
      impersonatorUserId: req.user.impersonator?.id ?? null,
      action: "update_profile",
      entityType: "User",
      entityId: req.user.id
    });

    res.json({
      ...req.user,
      firstName: req.body.firstName ?? req.user.firstName,
      lastName: req.body.lastName ?? req.user.lastName
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
