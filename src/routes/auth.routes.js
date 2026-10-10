const express = require("express");
const {
  loginSchema,
  updateMeSchema,
  changePasswordSchema,
  mfaVerifySchema,
  mfaEnableSchema,
  mfaDisableSchema
} = require("../schemas/auth.schema");
const mfa = require("../services/mfa.service");
const usersRepo = require("../repositories/users.repository");
const { updateUser, getUserByEmail } = usersRepo;
const { hashPassword, verifyPassword, DUMMY_HASH } = require("../utils/password");
const { validateBody } = require("../middleware/validate");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  denyIfImpersonating
} = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { loginIpLimiter, loginEmailLimiter, mfaLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Vloer voor de responstijd van mislukte logins: zo verschillen "onbekend account",
// "geblokkeerd account" en "verkeerd wachtwoord" niet meetbaar in duur, en kan een
// aanvaller via timing niet aftasten welke e-mailadressen bestaan.
const FAILED_LOGIN_MIN_MS = 1200;

async function padFailedLogin(startedAt) {
  const remaining = FAILED_LOGIN_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

// Controleert het wachtwoord van een account (lokaal, bcrypt). Een account zonder
// lokale hash (nog nooit een wachtwoord ingesteld) kan niet inloggen: een beheerder
// geeft het dan een tijdelijk wachtwoord. Geeft "ok" of "invalid" terug.
async function checkPassword(user, password) {
  if (user.password_hash) {
    return (await verifyPassword(password, user.password_hash)) ? "ok" : "invalid";
  }
  await verifyPassword(password, DUMMY_HASH);
  return "invalid";
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
    if (outcome !== "ok") {
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    if (user.must_change_password) {
      // Wachtwoord klopt, maar het is een tijdelijk wachtwoord: eerst een eigen
      // wachtwoord instellen (via /change-password), pas daarna een sessie. Met MFA
      // vraagt die stap ook de code (mfaRequired).
      res.json({ mustChangePassword: true, mfaRequired: Boolean(user.mfa_enabled_at) });
      return;
    }

    if (user.mfa_enabled_at) {
      // Tweede stap: nog geen sessie, alleen een kortlevend ondertekend ticket.
      res.json({ mfaRequired: true, mfaTicket: mfa.createTicket(user.id) });
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

      if (user.mfa_enabled_at) {
        const method = await verifySecondFactor(user, { code: req.body.mfaCode, recoveryCode: req.body.recoveryCode });
        if (!method) {
          await padFailedLogin(startedAt);
          next(new HttpError(401, "Ongeldige verificatiecode", undefined, "MFA_INVALID"));
          return;
        }
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

// --- tweestapsverificatie ---------------------------------------------------------

// Controleert een TOTP-code (eenmalig per tijdstap) of een herstelcode (eenmalig).
// Geeft "totp" / "recovery_code" terug, of null.
async function verifySecondFactor(user, { code, recoveryCode }) {
  if (!user.mfa_secret_enc) return null;
  if (code) {
    const step = mfa.verifyTotp(mfa.decryptSecret(user.mfa_secret_enc), code, { lastStep: user.mfa_last_step });
    return step != null && (await usersRepo.consumeMfaStep(user.id, step)) ? "totp" : null;
  }
  if (recoveryCode) {
    const hash = mfa.hashRecoveryCode(recoveryCode);
    const hashes = JSON.parse(user.mfa_recovery_hashes || "[]");
    if (!hashes.includes(hash)) return null;
    return (await usersRepo.consumeRecoveryCode(user.id, user.mfa_recovery_hashes, hash)) ? "recovery_code" : null;
  }
  return null;
}

router.post("/mfa/verify", mfaLimiter, validateBody(mfaVerifySchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const userId = mfa.readTicket(req.body.ticket);
    const user = userId ? await usersRepo.getMfaState(userId) : null;
    if (!user || user.status !== "active" || user.must_change_password) {
      await padFailedLogin(startedAt);
      next(new HttpError(401, "De verificatie is verlopen. Log opnieuw in.", undefined, "MFA_TICKET_INVALID"));
      return;
    }
    const method = await verifySecondFactor(user, req.body);
    if (!method) {
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige verificatiecode", undefined, "MFA_INVALID"));
      return;
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      action: "login",
      entityType: "User",
      entityId: user.id,
      metadata: { mfa: method }
    });
    res.json({ id: user.id, email: user.email, role: user.role, companyId: user.company_id });
  } catch (error) {
    next(error);
  }
});

router.get("/mfa", requireAuth, async (req, res, next) => {
  try {
    const state = await usersRepo.getMfaState(req.user.id);
    res.json({
      enabled: Boolean(state?.mfa_enabled_at),
      enabledAt: state?.mfa_enabled_at || null,
      recoveryCodesRemaining: state?.mfa_recovery_hashes ? JSON.parse(state.mfa_recovery_hashes).length : 0
    });
  } catch (error) {
    next(error);
  }
});

// Stap 1 van inschakelen: nieuw geheim (nog niet actief) + QR-code voor de app.
router.post("/mfa/setup", requireAuth, denyIfImpersonating, async (req, res, next) => {
  try {
    const state = await usersRepo.getMfaState(req.user.id);
    if (state?.mfa_enabled_at) throw new HttpError(409, "Tweestapsverificatie staat al aan");
    const secret = mfa.generateSecret();
    await usersRepo.setPendingMfaSecret(req.user.id, mfa.encryptSecret(secret));
    const uri = mfa.otpauthUri(secret, req.user.email);
    const qrDataUrl = await require("qrcode").toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 220 });
    res.set("Cache-Control", "no-store");
    res.json({ secret, otpauthUri: uri, qrDataUrl });
  } catch (error) {
    next(error);
  }
});

// Stap 2: eerste code bevestigen; pas dan staat MFA aan. Herstelcodes worden één
// keer getoond.
router.post("/mfa/enable", requireAuth, denyIfImpersonating, mfaLimiter, validateBody(mfaEnableSchema), async (req, res, next) => {
  try {
    const state = await usersRepo.getMfaState(req.user.id);
    if (!state?.mfa_pending_secret_enc) throw new HttpError(409, "Start de koppeling opnieuw");
    const step = mfa.verifyTotp(mfa.decryptSecret(state.mfa_pending_secret_enc), req.body.code);
    if (step == null) {
      throw new HttpError(400, "Ongeldige code. Controleer de tijd op je telefoon en probeer opnieuw.", undefined, "MFA_INVALID");
    }
    const { codes, hashes } = mfa.generateRecoveryCodes();
    if (!(await usersRepo.enableMfa(req.user.id, { recoveryHashes: hashes, step }))) {
      throw new HttpError(409, "Start de koppeling opnieuw");
    }
    await logAudit({ companyId: req.user.companyId, userId: req.user.id, action: "mfa_enable", entityType: "User", entityId: req.user.id });
    res.set("Cache-Control", "no-store");
    res.json({ enabled: true, recoveryCodes: codes });
  } catch (error) {
    next(error);
  }
});

router.post("/mfa/disable", requireAuth, denyIfImpersonating, mfaLimiter, validateBody(mfaDisableSchema), async (req, res, next) => {
  try {
    const state = await usersRepo.getMfaState(req.user.id);
    if (!state?.mfa_enabled_at) throw new HttpError(409, "Tweestapsverificatie staat niet aan");
    const passwordOk = Boolean(state.password_hash) && (await verifyPassword(req.body.password, state.password_hash));
    const method = passwordOk ? await verifySecondFactor(state, req.body) : null;
    if (!method) throw new HttpError(401, "Wachtwoord of code klopt niet", undefined, "MFA_INVALID");
    await usersRepo.disableMfa(req.user.id);
    await logAudit({ companyId: req.user.companyId, userId: req.user.id, action: "mfa_disable", entityType: "User", entityId: req.user.id });
    res.json({ enabled: false });
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
