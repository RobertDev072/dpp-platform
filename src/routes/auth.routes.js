const express = require("express");
const { loginSchema, mfaSchema, updateMeSchema } = require("../schemas/auth.schema");
const { updateUser } = require("../repositories/users.repository");
const { validateBody } = require("../middleware/validate");
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
const nativeAuth = require("../services/nativeAuth.service");
const { resolveEntraLogin, EntraLoginError } = require("../services/entraLogin.service");
const { loginIpLimiter, loginEmailLimiter, mfaLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Vloer voor de responstijd van mislukte logins: het lokale bcrypt-pad (~230ms) en
// het Entra-pad (2-3 netwerk-roundtrips) verschillen anders meetbaar in duur,
// waarmee een aanvaller zou kunnen aftasten welke e-mailadressen een Entra-account
// hebben. Met een vaste ondergrens is dat timingkanaal in de praktijk dichtgedrukt.
const FAILED_LOGIN_MIN_MS = 1200;

async function padFailedLogin(startedAt) {
  const remaining = FAILED_LOGIN_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

// Rondt een geslaagde Entra-native-auth-aanmelding (eerste factor of MFA) af tot een
// DPP-sessie: hergebruikt exact dezelfde JIT-koppeling en sessie-opzet als de
// bestaande browser-redirect-flow in entraAuth.routes.js.
async function finishEntraLogin(res, claims, via) {
  const user = await resolveEntraLogin({ sub: claims.sub, email: claims.email });
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);

  await logAudit({
    companyId: user.company_id,
    userId: user.id,
    action: "login",
    entityType: "User",
    entityId: user.id,
    metadata: { via }
  });

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id
  });
}

router.post("/login", loginIpLimiter, loginEmailLimiter, validateBody(loginSchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    if (user && user.password_hash) {
      // Bestaand bcrypt-pad (System Owner break-glass) - ongewijzigd.
      const passwordMatches = await verifyPassword(password, user.password_hash);

      if (user.status !== "active" || !passwordMatches) {
        await padFailedLogin(startedAt);
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
        companyId: user.company_id
      });
      return;
    }

    if (!user || user.status !== "active") {
      // Draai alsnog een bcrypt-vergelijking tegen een dummy-hash: voorkomt dat de
      // afwezigheid van deze stap zelf al een (grof) timing-enumeratielek wordt.
      await verifyPassword(password, DUMMY_HASH);
      await padFailedLogin(startedAt);
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    // Geen lokale hash + actieve user => Entra-beheerd account. Native Authentication,
    // volledig server-side, nooit een Microsoft-pagina te zien voor de gebruiker.
    try {
      const { continuationToken } = await nativeAuth.startPasswordSignIn({ email });
      const { claims } = await nativeAuth.submitPassword({ continuationToken, password });
      await finishEntraLogin(res, claims, "native-entra");
    } catch (err) {
      // Bewuste keuze: MFA_REQUIRED kan hier alleen uit submitPassword komen, dus
      // {mfaRequired:true} is uitsluitend bereikbaar mét een geldig wachtwoord -
      // dit is geen enumeratie-orakel (geverifieerd in de security-audit).
      if (err instanceof nativeAuth.NativeAuthError && err.code === "MFA_REQUIRED") {
        const { continuationToken, methods } = await nativeAuth.listMfaMethods({
          continuationToken: err.continuationToken
        });
        if (!methods.length) {
          await padFailedLogin(startedAt);
          next(new HttpError(401, "Geen MFA-methode geregistreerd voor dit account"));
          return;
        }
        const challenged = await nativeAuth.requestMfaCode({
          continuationToken,
          methodId: methods[0].id
        });
        res.json({
          mfaRequired: true,
          continuationToken: challenged.continuationToken,
          codeLength: challenged.codeLength
        });
        return;
      }
      if (err instanceof nativeAuth.NativeAuthError || err instanceof EntraLoginError) {
        await padFailedLogin(startedAt);
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

router.post("/login/mfa", mfaLimiter, validateBody(mfaSchema), async (req, res, next) => {
  try {
    const { continuationToken, code } = req.body;
    const { claims } = await nativeAuth.submitMfaCode({ continuationToken, code });
    await finishEntraLogin(res, claims, "native-entra-mfa");
  } catch (error) {
    if (error instanceof nativeAuth.NativeAuthError) {
      next(new HttpError(401, error.message));
      return;
    }
    if (error instanceof EntraLoginError) {
      next(new HttpError(401, error.message));
      return;
    }
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
