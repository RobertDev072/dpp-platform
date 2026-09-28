const crypto = require("crypto");
const express = require("express");
const { isEntraLoginConfigured, getEntraConfig } = require("../config/entra");
const { getWebConfidentialClient } = require("../services/msalClients");
const { setOAuthStateCookie, consumeOAuthStateCookie } = require("../utils/oauthState");
const {
  resolveEntraLogin,
  EntraLoginError,
  getHomePathForRole,
  getLoginErrorCode
} = require("../services/entraLogin.service");
const { entraLoginHintSchema, entraCallbackSchema } = require("../schemas/auth.schema");
const {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  getUserForToken,
  setSessionCookie,
  clearSessionCookie
} = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");

const router = express.Router();
const ENTRA_SCOPES = ["openid", "profile", "email"];

// Alleen deze codes komen ooit in de URL; /login.html vertaalt ze naar een Nederlandse
// melding. Nooit de ruwe foutmelding van Entra/MSAL: die hoort niet in de adresbalk,
// browsergeschiedenis of access logs.
const LOGIN_ERROR_CODES = new Set(["login_failed", "no_account", "inactive", "state"]);

function redirectToLoginError(res, code) {
  const safeCode = LOGIN_ERROR_CODES.has(code) ? code : "login_failed";
  res.redirect(`/login.html?error=${safeCode}`);
}

// Gedeeld door GET (zonder hint) en POST (e-mail uit stap 1 van de loginpagina als
// login_hint, zodat de gebruiker het adres bij Entra niet opnieuw hoeft te typen).
async function startEntraLogin(req, res, loginHint) {
  if (!isEntraLoginConfigured()) {
    // Browsernavigatie: een JSON-foutpagina helpt niemand, terug naar de loginpagina.
    redirectToLoginError(res, "login_failed");
    return;
  }

  try {
    const entra = getEntraConfig();
    const client = await getWebConfidentialClient();

    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");

    const authUrl = await client.getAuthCodeUrl({
      scopes: ENTRA_SCOPES,
      redirectUri: entra.redirectUri,
      responseMode: "form_post",
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod: "S256",
      ...(loginHint ? { loginHint } : {})
    });

    setOAuthStateCookie(res, { state, nonce, codeVerifier });
    res.redirect(authUrl);
  } catch (error) {
    // Alleen de melding loggen: MSAL-fouten bevatten geen secrets, maar het volledige
    // error-object kan request-config (incl. client secret) meeslepen.
    console.error("Starten van Entra-login mislukt:", error.message);
    redirectToLoginError(res, "login_failed");
  }
}

router.get("/login", async (req, res) => {
  await startEntraLogin(req, res);
});

router.post("/login", async (req, res) => {
  // Ongeldig of ontbrekend e-mailadres is geen fout: dan zonder login_hint verder.
  const parsed = entraLoginHintSchema.safeParse(req.body || {});
  await startEntraLogin(req, res, parsed.success ? parsed.data.email : undefined);
});

// Entra stuurt de authorization code terug via een auto-submittende HTML-form
// (response_mode=form_post), vandaar POST i.p.v. GET voor deze callback. Het pad
// (/auth/redirect) moet exact overeenkomen met de redirect URI in de app-registratie.
// Elke fout eindigt als redirect naar /login.html?error=<code> (browsernavigatie).
router.post("/redirect", async (req, res) => {
  // Cookie altijd eerst consumeren (ook bij fouten): een state is maar één keer bruikbaar.
  const stored = consumeOAuthStateCookie(req, res);

  try {
    if (!isEntraLoginConfigured()) {
      redirectToLoginError(res, "login_failed");
      return;
    }

    const parsed = entraCallbackSchema.safeParse(req.body || {});
    if (!parsed.success) {
      redirectToLoginError(res, "login_failed");
      return;
    }
    const { code, state: returnedState, error: oidcError } = parsed.data;

    if (oidcError) {
      // Alleen de (korte, gestandaardiseerde) OIDC-foutcode loggen, niet de beschrijving.
      console.error("Entra-login geweigerd door identity provider:", oidcError);
      redirectToLoginError(res, "login_failed");
      return;
    }

    if (!stored || !code || !returnedState || returnedState !== stored.state) {
      redirectToLoginError(res, "state");
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
      redirectToLoginError(res, "state");
      return;
    }

    // resolveEntraLogin weigert ook inactieve/geblokkeerde accounts en gebruikers van een
    // niet-actieve company (EntraLoginError -> "inactive").
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

    res.redirect(getHomePathForRole(user.role));
  } catch (error) {
    if (!(error instanceof EntraLoginError)) {
      console.error("Entra-login mislukt:", error.message);
    }
    redirectToLoginError(res, getLoginErrorCode(error));
  }
});

// Bewust zonder requireAuth: ook met een al verlopen/ingetrokken DPP-sessie moet de browser
// door naar het Entra end-session endpoint, anders blijft de SSO-sessie bij ciamlogin.com
// leven en logt "Doorgaan" op een gedeeld apparaat de vorige gebruiker weer in.
router.get("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const user = token ? await getUserForToken(token) : null;

    if (token) {
      await destroySession(token);
    }
    clearSessionCookie(res);

    if (user) {
      await logAudit({
        companyId: user.companyId,
        userId: user.id,
        action: "logout",
        entityType: "User",
        entityId: user.id,
        metadata: { via: "entra" }
      });
    }

    res.redirect(isEntraLoginConfigured() ? getEntraConfig().logoutEndpoint : "/login.html");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
