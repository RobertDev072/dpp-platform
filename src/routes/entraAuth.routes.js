const crypto = require("crypto");
const express = require("express");
const { isEntraLoginConfigured, getEntraConfig } = require("../config/entra");
const { getWebConfidentialClient } = require("../services/msalClients");
const { setOAuthStateCookie, consumeOAuthStateCookie } = require("../utils/oauthState");
const { resolveEntraLogin, EntraLoginError } = require("../services/entraLogin.service");
const { createSession, destroySession, setSessionCookie, clearSessionCookie, requireAuth } = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();
const ENTRA_SCOPES = ["openid", "profile", "email"];

router.get("/login", async (req, res, next) => {
  try {
    if (!isEntraLoginConfigured()) {
      next(new HttpError(503, "Entra External ID-login is niet geconfigureerd"));
      return;
    }

    const entra = getEntraConfig();
    const client = await getWebConfidentialClient();

    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");

    setOAuthStateCookie(res, { state, nonce, codeVerifier });

    const authUrl = await client.getAuthCodeUrl({
      scopes: ENTRA_SCOPES,
      redirectUri: entra.redirectUri,
      responseMode: "form_post",
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod: "S256"
    });

    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
});

// Entra stuurt de authorization code terug via een auto-submittende HTML-form
// (response_mode=form_post), vandaar POST i.p.v. GET voor deze callback. Het pad
// (/auth/redirect) moet exact overeenkomen met de redirect URI in de app-registratie.
router.post("/redirect", async (req, res, next) => {
  try {
    if (!isEntraLoginConfigured()) {
      next(new HttpError(503, "Entra External ID-login is niet geconfigureerd"));
      return;
    }

    const { code, state: returnedState, error: oidcError, error_description: oidcErrorDescription } = req.body;
    const stored = consumeOAuthStateCookie(req, res);

    if (oidcError) {
      next(new HttpError(401, `Inloggen mislukt: ${oidcErrorDescription || oidcError}`));
      return;
    }

    if (!stored || !code || !returnedState || returnedState !== stored.state) {
      next(new HttpError(401, "Ongeldige of verlopen login-poging (state mismatch)"));
      return;
    }

    const entra = getEntraConfig();
    const client = await getWebConfidentialClient();

    const tokenResponse = await client.acquireTokenByCode({
      code,
      scopes: ENTRA_SCOPES,
      redirectUri: entra.redirectUri,
      codeVerifier: stored.codeVerifier
    });

    const claims = tokenResponse.idTokenClaims || {};

    // Nonce zit in het ID-token zelf (niet in de redirect-parameters) en moet
    // overeenkomen met de waarde die we bij /login hebben gegenereerd en opgeslagen.
    // Dit bindt het teruggekregen token aan déze specifieke login-poging.
    if (!stored.nonce || claims.nonce !== stored.nonce) {
      next(new HttpError(401, "Ongeldige of verlopen login-poging (nonce mismatch)"));
      return;
    }

    const user = await resolveEntraLogin({ sub: claims.sub, email: claims.email });

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      action: "login",
      entityType: "User",
      entityId: user.id,
      metadata: { via: "entra" }
    });

    res.redirect(user.role === "system_owner" ? "/admin/index.html" : "/company/index.html");
  } catch (error) {
    if (error instanceof EntraLoginError) {
      next(new HttpError(401, error.message));
      return;
    }
    next(error);
  }
});

router.get("/logout", requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.sessionToken);
    clearSessionCookie(res);

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.id,
      action: "logout",
      entityType: "User",
      entityId: req.user.id,
      metadata: { via: "entra" }
    });

    res.redirect(isEntraLoginConfigured() ? getEntraConfig().logoutEndpoint : "/login.html");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
