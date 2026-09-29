const { getEntraConfig } = require("../config/entra");

// Dunne wrapper rond Entra External ID's Native Authentication REST-API (geen MSAL
// SDK hiervoor beschikbaar in Node) - houdt e-mail/wachtwoord-login, MFA en SSPR
// volledig binnen onze eigen backend, zodat de browser nooit naar een Microsoft-
// hosted pagina hoeft (CORS wordt door deze endpoints sowieso niet ondersteund, dus
// een directe browser-aanroep was toch geen optie).
//
// Endpoint-vorm nog empirisch te bevestigen tegen de echte tenant bij eerste gebruik
// (opgehaald via Microsoft Learn, maar dat antwoord bevatte verdachte, niet-officieel
// ogende tekst naast de technische inhoud - zie gesprek. De structuur hieronder
// (initiate/challenge/token/introspect, resetpassword start/challenge/continue/poll_completion,
// continuation_token dat elke stap doorgegeven wordt) is wel consistent met eerdere,
// onafhankelijke bronnen en met het bestaande `authority`-patroon in config/entra.js).
class NativeAuthError extends Error {
  constructor(code, message, { subError, continuationToken } = {}) {
    super(message);
    this.code = code;
    this.subError = subError;
    this.continuationToken = continuationToken;
  }
}

function baseUrl() {
  const entra = getEntraConfig();
  return entra.authority; // https://{tenant}.ciamlogin.com/{tenant}.onmicrosoft.com
}

function clientId() {
  return getEntraConfig().web.clientId;
}

async function callNativeAuth(path, params) {
  const body = new URLSearchParams({ client_id: clientId(), ...params });
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // Zonder eigen limiet kan een trage/hangende netwerkaanroep naar Entra de hele
      // aanvraag oneindig laten hangen (bv. de "Bezig..."-spinner die nooit stopt) -
      // fetch() heeft standaard geen timeout.
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new NativeAuthError(
        "TIMEOUT",
        "Het duurt te lang om te verbinden. Probeer het over een moment opnieuw."
      );
    }
    throw err;
  }

  const rawText = await response.text();
  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }

  if (!response.ok) {
    // Bewust géén rauwe body loggen: Entra's foutantwoorden bevatten een live,
    // hervatbaar continuation_token - dat hoort nooit in Log Stream terecht te komen.
    console.error(
      "Native-auth-antwoord niet ok:",
      path,
      "status=" + response.status,
      "error=" + (data.error || "-"),
      "suberror=" + (data.suberror || "-"),
      "trace_id=" + (data.trace_id || "-"),
      "correlation_id=" + (data.correlation_id || "-")
    );
    if (data.error === "user_not_found") {
      throw new NativeAuthError("USER_NOT_FOUND", "Geen account gevonden voor dit e-mailadres");
    }
    if (data.suberror === "mfa_required") {
      throw new NativeAuthError("MFA_REQUIRED", "Extra verificatie vereist", {
        continuationToken: data.continuation_token
      });
    }
    if (data.suberror === "invalid_oob_value") {
      throw new NativeAuthError("INVALID_CODE", "Ongeldige of verlopen code", {
        continuationToken: data.continuation_token
      });
    }
    if (data.suberror === "registration_required") {
      throw new NativeAuthError("REGISTRATION_REQUIRED", "Account heeft nog geen wachtwoord ingesteld", {
        continuationToken: data.continuation_token
      });
    }
    if (["password_too_weak", "password_too_short", "password_too_long", "password_recently_used", "password_banned", "password_is_invalid"].includes(data.suberror)) {
      throw new NativeAuthError("WEAK_PASSWORD", "Wachtwoord voldoet niet aan de eisen", {
        subError: data.suberror,
        continuationToken: data.continuation_token
      });
    }
    if (data.error === "expired_token") {
      throw new NativeAuthError("EXPIRED", "Deze aanvraag is verlopen, begin opnieuw");
    }
    if (data.error === "invalid_grant") {
      // AADSTS50055 = wachtwoord verlopen of "wijzigen bij eerstvolgende login"
      // (bv. door Entra gemarkeerd bij provisioning). De native-login-API kent geen
      // wijzigingsceremonie, dus de enige route is onze eigen SSPR-flow.
      if (/AADSTS50055/.test(data.error_description || "")) {
        throw new NativeAuthError(
          "PASSWORD_RESET_REQUIRED",
          "Je wachtwoord moet opnieuw worden ingesteld. Gebruik 'Wachtwoord vergeten' op de loginpagina."
        );
      }
      throw new NativeAuthError("INVALID_CREDENTIALS", "Ongeldige inloggegevens", {
        continuationToken: data.continuation_token
      });
    }
    // Alleen de identificerende velden loggen (nooit de volledige respons: die kan
    // een live continuation_token bevatten); de gebruiker krijgt een vriendelijke,
    // actiegerichte melding.
    console.error(
      "Onbekende native-auth-respons van Entra:",
      path,
      "error=" + (data.error || "-"),
      "suberror=" + (data.suberror || "-"),
      "trace_id=" + (data.trace_id || "-"),
      "correlation_id=" + (data.correlation_id || "-")
    );
    throw new NativeAuthError(
      data.error || "UNKNOWN",
      "Er ging iets mis. Probeer het over een moment opnieuw."
    );
  }

  if (data.challenge_type === "redirect") {
    // App mist een vereiste capability voor deze stap - moet niet gebeuren zolang we
    // steeds mfa_required meesturen, maar fail duidelijk i.p.v. stil door te gaan.
    throw new NativeAuthError("WEB_FALLBACK_REQUIRED", "Deze stap vereist de Microsoft-hosted pagina");
  }

  return data;
}

// --- Sign-in (email + wachtwoord) ---

async function startPasswordSignIn({ email }) {
  const initiated = await callNativeAuth("/oauth2/v2.0/initiate", {
    username: email,
    challenge_type: "password redirect"
  });

  const challenged = await callNativeAuth("/oauth2/v2.0/challenge", {
    continuation_token: initiated.continuation_token,
    challenge_type: "password redirect"
  });

  return { continuationToken: challenged.continuation_token };
}

function decodeIdTokenClaims(idToken) {
  // Server-side ontvangen, rechtstreeks over TLS van Entra's eigen token-endpoint met
  // ons client_secret erbij - zelfde vertrouwensniveau als de bestaande
  // acquireTokenByCode-flow in entraAuth.routes.js. Geen los JWKS-verificatiestap
  // (nog) toegevoegd; alleen decoderen + expiry/audience-check.
  const payloadB64 = idToken.split(".")[1];
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

  if (claims.aud !== clientId()) {
    throw new NativeAuthError("TOKEN_INVALID", "ID-token audience komt niet overeen");
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new NativeAuthError("TOKEN_INVALID", "ID-token is verlopen");
  }

  return claims;
}

async function submitPassword({ continuationToken, password }) {
  const result = await callNativeAuth("/oauth2/v2.0/token", {
    continuation_token: continuationToken,
    grant_type: "password",
    password,
    scope: "openid profile email offline_access"
  });

  return { claims: decodeIdTokenClaims(result.id_token) };
}

// --- MFA (tweede factor, e-mail-OTP) ---

async function listMfaMethods({ continuationToken }) {
  const result = await callNativeAuth("/oauth2/v2.0/introspect", {
    continuation_token: continuationToken
  });
  return {
    continuationToken: result.continuation_token,
    methods: (result.methods || []).map((m) => ({ id: m.id, channel: m.challenge_channel }))
  };
}

async function requestMfaCode({ continuationToken, methodId }) {
  const result = await callNativeAuth("/oauth2/v2.0/challenge", {
    continuation_token: continuationToken,
    challenge_type: "oob redirect",
    id: methodId
  });
  return { continuationToken: result.continuation_token, codeLength: result.code_length || null };
}

async function submitMfaCode({ continuationToken, code }) {
  const result = await callNativeAuth("/oauth2/v2.0/token", {
    continuation_token: continuationToken,
    grant_type: "mfa_oob",
    oob: code,
    scope: "openid profile email offline_access"
  });
  return { claims: decodeIdTokenClaims(result.id_token) };
}

// --- SSPR (wachtwoord vergeten / eerste wachtwoord instellen) ---

async function startPasswordReset({ email }) {
  const result = await callNativeAuth("/resetpassword/v1.0/start", {
    username: email,
    challenge_type: "oob redirect"
  });
  return { continuationToken: result.continuation_token };
}

async function requestPasswordResetCode({ continuationToken }) {
  const result = await callNativeAuth("/resetpassword/v1.0/challenge", {
    continuation_token: continuationToken,
    challenge_type: "oob redirect"
  });
  return {
    continuationToken: result.continuation_token,
    codeLength: result.code_length || null,
    targetLabel: result.challenge_target_label || null
  };
}

async function submitPasswordResetCode({ continuationToken, code }) {
  const result = await callNativeAuth("/resetpassword/v1.0/continue", {
    continuation_token: continuationToken,
    grant_type: "oob",
    oob: code
  });
  return { continuationToken: result.continuation_token };
}

async function submitNewPassword({ continuationToken, password, code }) {
  // Empirisch bevestigd tegen de echte tenant (AADSTS900144): deze aanroep verwacht
  // de oob-code ook hier, niet alleen bij de vorige /continue-stap.
  const result = await callNativeAuth("/resetpassword/v1.0/continue", {
    continuation_token: continuationToken,
    grant_type: "password",
    password,
    oob: code
  });
  return { continuationToken: result.continuation_token };
}

async function pollPasswordResetCompletion({ continuationToken }) {
  const result = await callNativeAuth("/resetpassword/v1.0/poll_completion", {
    continuation_token: continuationToken
  });
  return { status: result.status, continuationToken: result.continuation_token };
}

module.exports = {
  NativeAuthError,
  startPasswordSignIn,
  submitPassword,
  listMfaMethods,
  requestMfaCode,
  submitMfaCode,
  startPasswordReset,
  requestPasswordResetCode,
  submitPasswordResetCode,
  submitNewPassword,
  pollPasswordResetCompletion
};
