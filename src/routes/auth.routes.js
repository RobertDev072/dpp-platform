const express = require("express");
const { loginSchema, mfaSchema } = require("../schemas/auth.schema");
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

const router = express.Router();

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

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    if (user && user.password_hash) {
      // Bestaand bcrypt-pad (System Owner break-glass) - ongewijzigd.
      const passwordMatches = await verifyPassword(password, user.password_hash);

      if (user.status !== "active" || !passwordMatches) {
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
      if (err instanceof nativeAuth.NativeAuthError && err.code === "MFA_REQUIRED") {
        const { continuationToken, methods } = await nativeAuth.listMfaMethods({
          continuationToken: err.continuationToken
        });
        if (!methods.length) {
          next(new HttpError(401, "Geen MFA-methode geregistreerd voor dit account"));
          return;
        }
        const challenged = await nativeAuth.requestMfaCode({
          continuationToken,
          methodId: methods[0].id
        });
        res.json({ mfaRequired: true, continuationToken: challenged.continuationToken });
        return;
      }
      if (err instanceof nativeAuth.NativeAuthError || err instanceof EntraLoginError) {
        next(new HttpError(401, "Ongeldige inloggegevens"));
        return;
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

router.post("/login/mfa", validateBody(mfaSchema), async (req, res, next) => {
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

module.exports = router;
