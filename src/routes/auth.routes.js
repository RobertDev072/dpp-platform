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
const identity = require("../services/identity.service");
const { loginIpLimiter, loginEmailLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Vloer voor de responstijd van mislukte logins: het lokale bcrypt-pad (~230ms) en
// het Supabase Auth-pad (netwerk-roundtrip) verschillen anders meetbaar in duur,
// waarmee een aanvaller zou kunnen aftasten welke e-mailadressen een account
// hebben. Met een vaste ondergrens is dat timingkanaal in de praktijk dichtgedrukt.
const FAILED_LOGIN_MIN_MS = 1200;

async function padFailedLogin(startedAt) {
  const remaining = FAILED_LOGIN_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

// Vertaalt een mislukte wachtwoordcontrole bij Supabase Auth naar een HTTP-fout.
// Alles wat "fout wachtwoord/onbekend/geblokkeerd" betekent wordt één en dezelfde
// 401 (geen enumeratie); alleen echte storingen krijgen een eigen melding.
function identityFailure(err) {
  if (err.code === "RATE_LIMITED") {
    return new HttpError(429, err.message, undefined, "RATE_LIMITED");
  }
  if (err.code === "UNAVAILABLE" || err.code === "UNKNOWN") {
    return new HttpError(503, "Inloggen is tijdelijk niet mogelijk. Probeer het over een moment opnieuw.", undefined, "AUTH_UNAVAILABLE");
  }
  return new HttpError(401, "Ongeldige inloggegevens");
}

// Controleert het wachtwoord van een Supabase-account en of het Supabase-account
// echt bij dit DPP-account hoort. Gooit een HttpError bij falen.
async function verifySupabasePassword(user, email, password) {
  if (!identity.isIdentityProviderConfigured()) {
    console.error("Login geweigerd: account zonder lokaal wachtwoord, maar Supabase Auth is niet geconfigureerd.");
    throw new HttpError(503, "Inloggen is tijdelijk niet mogelijk. Probeer het over een moment opnieuw.", undefined, "AUTH_UNAVAILABLE");
  }
  let authUserId;
  try {
    ({ authUserId } = await identity.verifyPassword(email, password));
  } catch (err) {
    if (err instanceof identity.IdentityError) throw identityFailure(err);
    throw err;
  }
  if (!user.auth_user_id || user.auth_user_id !== authUserId) {
    throw new HttpError(401, "Ongeldige inloggegevens");
  }
}

function sessionResponse(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id
  };
}

router.post("/login", loginIpLimiter, loginEmailLimiter, validateBody(loginSchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    if (!user || user.status !== "active" || (!user.password_hash && !user.auth_user_id)) {
      // Draai alsnog een bcrypt-vergelijking tegen een dummy-hash: voorkomt dat de
      // afwezigheid van deze stap zelf al een (grof) timing-enumeratielek wordt.
      await verifyPassword(password, user?.password_hash || DUMMY_HASH);
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    if (user.password_hash) {
      // Lokaal (bcrypt) account: Platform Owner break-glass, of lokale ontwikkeling.
      if (!(await verifyPassword(password, user.password_hash))) {
        await padFailedLogin(startedAt);
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }
    } else {
      // Supabase Auth-account: volledig server-side, de browser praat nooit zelf
      // met Supabase.
      try {
        await verifySupabasePassword(user, email, password);
      } catch (err) {
        await padFailedLogin(startedAt);
        next(err);
        return;
      }
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
      entityId: user.id,
      metadata: { via: user.password_hash ? "lokaal" : "supabase" }
    });

    res.json(sessionResponse(user));
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

      if (!user || user.status !== "active" || (!user.password_hash && !user.auth_user_id)) {
        await verifyPassword(currentPassword, DUMMY_HASH);
        await padFailedLogin(startedAt);
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }

      if (user.password_hash) {
        // Lokaal account: huidig wachtwoord verifiëren en hash vervangen.
        const matches = await verifyPassword(currentPassword, user.password_hash);
        if (!matches) {
          await padFailedLogin(startedAt);
          next(new HttpError(401, "Ongeldige inloggegevens"));
          return;
        }
        await usersRepo.updatePasswordHash(user.id, await hashPassword(newPassword));
      } else {
        // Supabase-account: huidig (tijdelijk) wachtwoord bij Supabase verifiëren,
        // daarna het nieuwe wachtwoord via de Auth-admin-API zetten.
        try {
          await verifySupabasePassword(user, email, currentPassword);
        } catch (err) {
          await padFailedLogin(startedAt);
          next(err);
          return;
        }

        try {
          await identity.setPassword(user.auth_user_id, newPassword);
        } catch (err) {
          if (err instanceof identity.IdentityError && err.code === "WEAK_PASSWORD") {
            next(
              new HttpError(400, "Ongeldige invoer", {
                formErrors: [],
                fieldErrors: { newPassword: [err.message] }
              })
            );
            return;
          }
          if (err instanceof identity.IdentityError) {
            next(new HttpError(502, "Wachtwoord instellen is tijdelijk niet mogelijk. Probeer het opnieuw of neem contact op met de beheerder."));
            return;
          }
          throw err;
        }
      }

      await usersRepo.setMustChangePassword(user.id, false);

      const { token, expiresAt } = await createSession(user.id);
      setSessionCookie(res, token, expiresAt);

      await logAudit({
        companyId: user.company_id,
        userId: user.id,
        action: "change_password",
        entityType: "User",
        entityId: user.id,
        metadata: { via: user.password_hash ? "lokaal" : "supabase" }
      });

      res.json(sessionResponse(user));
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
