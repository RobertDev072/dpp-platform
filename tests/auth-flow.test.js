const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

// Nep-Entra voor de gesimuleerde login-flow hieronder. Moet vóór het laden van de app
// staan: entraAuth.routes.js pakt getWebConfidentialClient bij het laden uit de module.
// Zo testen we onze eigen callback-logica (state, nonce, foutcodes, redirects) zonder
// echte tenant of netwerk. COOKIE_SECRET is nodig voor de gesigneerde state-cookie; een
// random waarde per testrun, geen secret in de code.
process.env.COOKIE_SECRET ||= crypto.randomBytes(32).toString("hex");
const msalClients = require("../src/services/msalClients");
const fakeEntra = { authUrlRequests: [], tokenRequests: [], claims: null, tokenError: null };
msalClients.getWebConfidentialClient = async () => ({
  async getAuthCodeUrl(authRequest) {
    fakeEntra.authUrlRequests.push(authRequest);
    return "https://login.example.test/authorize";
  },
  async acquireTokenByCode(tokenRequest) {
    fakeEntra.tokenRequests.push(tokenRequest);
    if (fakeEntra.tokenError) throw fakeEntra.tokenError;
    return { idTokenClaims: fakeEntra.claims };
  }
});

const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const { isEntraLoginConfigured } = require("../src/config/entra");
const {
  resolveEntraLogin,
  EntraLoginError,
  getHomePathForRole,
  getLoginErrorCode
} = require("../src/services/entraLogin.service");

const ENTRA_LOGIN_VARS = [
  "ENTRA_TENANT_NAME",
  "ENTRA_TENANT_ID",
  "ENTRA_WEB_CLIENT_ID",
  "ENTRA_WEB_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "ENTRA_POST_LOGOUT_REDIRECT_URI"
];

// Zet tijdelijk een (nep-)Entra-loginconfig; de waarden bereiken niets echts omdat de
// MSAL-client hierboven vervangen is. Geeft een functie terug die alles herstelt.
function enableFakeEntraLogin() {
  const previous = Object.fromEntries(ENTRA_LOGIN_VARS.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    ENTRA_TENANT_NAME: "dpptest",
    ENTRA_TENANT_ID: crypto.randomUUID(),
    ENTRA_WEB_CLIENT_ID: crypto.randomUUID(),
    ENTRA_WEB_CLIENT_SECRET: crypto.randomBytes(16).toString("hex"),
    ENTRA_REDIRECT_URI: "http://127.0.0.1/auth/redirect",
    ENTRA_POST_LOGOUT_REDIRECT_URI: "http://127.0.0.1/login.html"
  });
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function cookieFrom(response, name) {
  const match = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.split(";")[0] : null;
}

async function login(baseUrl, user) {
  return request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
}

// fetch zonder redirects te volgen, om de 302-doelen van de Entra-routes te controleren.
async function rawRequest(baseUrl, method, path, { form } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers: form ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  await response.text();
  return { status: response.status, location: response.headers.get("location") };
}

test("auth flow: config, redirectTo, company-status, rate limits, Entra-foutredirects en dichte lokale login", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const cleanup = { companyIds: [], userIds: [] };

  // Direct registreren (vóór de setup), zodat een halverwege mislukte setup het
  // testproces niet laat hangen op een open server/pool.
  t.after(async () => {
    await cleanupTestData(cleanup);
    await stopTestServer(server);
    await sql.close();
  });

  const activeCompany = await createTestCompany("Auth Flow Active");
  const suspendedCompany = await createTestCompany("Auth Flow Suspended");
  cleanup.companyIds.push(activeCompany, suspendedCompany);
  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  cleanup.userIds.push(owner.id);
  const admin = await createTestUser({ companyId: activeCompany, role: "company_admin" });
  const viewer = await createTestUser({ companyId: activeCompany, role: "viewer" });
  const suspendedUser = await createTestUser({ companyId: suspendedCompany, role: "company_user" });

  await t.test("GET /api/auth/config geeft de loginmodus (lokaal zonder Entra-config)", async () => {
    const res = await request(baseUrl, "GET", "/api/auth/config");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.data), ["mode"]);
    assert.equal(res.data.mode, isEntraLoginConfigured() ? "entra" : "local");
  });

  await t.test("login geeft redirectTo per rol", async () => {
    const ownerRes = await login(baseUrl, owner);
    assert.equal(ownerRes.status, 200);
    assert.equal(ownerRes.data.redirectTo, "/admin/index.html");
    assert.equal(ownerRes.data.companyId, null);

    const adminRes = await login(baseUrl, admin);
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.data.redirectTo, "/app/index.html");
    assert.equal(adminRes.data.companyId, activeCompany);

    const viewerRes = await login(baseUrl, viewer);
    assert.equal(viewerRes.status, 200);
    assert.equal(viewerRes.data.redirectTo, "/app/index.html");
    assert.equal(viewerRes.data.password_hash, undefined);
  });

  await t.test("GET /login.html: met geldige sessie door naar de eigen omgeving, anders het formulier", async () => {
    // De loginpagina doet zelf geen /api/auth/me-check meer (die gaf anonieme bezoekers
    // een 401 in de console): de server stuurt een ingelogde gebruiker door.
    const getLogin = (cookie) =>
      fetch(`${baseUrl}/login.html`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : undefined });

    const anonymous = await getLogin();
    assert.equal(anonymous.status, 200);
    assert.match(await anonymous.text(), /id="local-form"/);

    const ownerSession = (await login(baseUrl, owner)).cookie;
    const ownerRes = await getLogin(ownerSession);
    assert.equal(ownerRes.status, 302);
    assert.equal(ownerRes.headers.get("location"), "/admin/index.html");
    assert.equal(ownerRes.headers.get("cache-control"), "no-store");

    const viewerRes = await getLogin((await login(baseUrl, viewer)).cookie);
    assert.equal(viewerRes.status, 302);
    assert.equal(viewerRes.headers.get("location"), "/app/index.html");

    // Onbekende of uitgelogde sessie: gewoon het formulier, geen fout.
    const bogus = await getLogin("dpp_session=bestaat-niet");
    assert.equal(bogus.status, 200);
    await bogus.text();
    await request(baseUrl, "POST", "/api/auth/logout", { cookie: ownerSession });
    const afterLogout = await getLogin(ownerSession);
    assert.equal(afterLogout.status, 200);
    await afterLogout.text();
  });

  await t.test("e-mail is hoofdletterongevoelig bij inloggen", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: `  ${viewer.email.toUpperCase()} `, password: viewer.password }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, viewer.id);
  });

  await t.test("/me bevat permissies en wordt niet gecachet", async () => {
    const loginRes = await login(baseUrl, viewer);
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: loginRes.cookie } });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(data.companyId, activeCompany);
    assert.ok(Array.isArray(data.permissions));
    assert.ok(data.permissions.includes("company:dashboard"));
  });

  await t.test("gebruiker van een gedeactiveerde company kan niet inloggen (generieke 401)", async () => {
    // Eerst inloggen terwijl de company nog actief is: die sessie moet daarna ook stoppen.
    const before = await login(baseUrl, suspendedUser);
    assert.equal(before.status, 200);

    await pool
      .request()
      .input("id", sql.Int, suspendedCompany)
      .query("UPDATE dbo.Companies SET status = 'suspended' WHERE id = @id");

    const res = await login(baseUrl, suspendedUser);
    assert.equal(res.status, 401);
    assert.equal(res.cookie, null);

    const wrongPassword = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: admin.email, password: "helemaal-verkeerd" }
    });
    // Zelfde melding als een fout wachtwoord: niets verraden over de company-status.
    assert.equal(res.data.error.message, wrongPassword.data.error.message);

    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: before.cookie });
    assert.equal(me.status, 401);
  });

  await t.test("Entra-login voor gebruiker van een gedeactiveerde company wordt geweigerd", async () => {
    const sub = crypto.randomBytes(16).toString("hex");
    await pool
      .request()
      .input("id", sql.Int, suspendedUser.id)
      .input("sub", sql.NVarChar(255), sub)
      .query("UPDATE dbo.Users SET entra_subject_id = @sub WHERE id = @id");

    await assert.rejects(
      () => resolveEntraLogin({ sub, email: suspendedUser.email }),
      (error) => error instanceof EntraLoginError && error.code === "COMPANY_INACTIVE"
    );
  });

  await t.test("Entra-foutcodes en startpagina's zijn vaste waarden", () => {
    assert.equal(getLoginErrorCode(new EntraLoginError("NO_LINKED_ACCOUNT", "x")), "no_account");
    assert.equal(getLoginErrorCode(new EntraLoginError("INACTIVE", "x")), "inactive");
    assert.equal(getLoginErrorCode(new EntraLoginError("COMPANY_INACTIVE", "x")), "inactive");
    assert.equal(getLoginErrorCode(new EntraLoginError("MISSING_SUB", "x")), "login_failed");
    assert.equal(getLoginErrorCode(new Error("AADSTS12345: iets met details")), "login_failed");
    assert.equal(getHomePathForRole("system_owner"), "/admin/index.html");
    assert.equal(getHomePathForRole("viewer"), "/app/index.html");
  });

  await t.test("Entra-routes redirecten naar /login.html?error=<code>, nooit JSON of ruwe tekst", async (st) => {
    if (isEntraLoginConfigured()) {
      st.skip("Entra is geconfigureerd in deze omgeving");
      return;
    }
    const getLogin = await rawRequest(baseUrl, "GET", "/auth/login");
    assert.equal(getLogin.status, 302);
    assert.equal(getLogin.location, "/login.html?error=login_failed");

    const postLogin = await rawRequest(baseUrl, "POST", "/auth/login", { form: { email: "iemand@example.com" } });
    assert.equal(postLogin.status, 302);
    assert.equal(postLogin.location, "/login.html?error=login_failed");

    const callback = await rawRequest(baseUrl, "POST", "/auth/redirect", {
      form: { error: "access_denied", error_description: "<script>alert(1)</script>" }
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.location, "/login.html?error=login_failed");

    // Zonder Entra hoeft een formulier nergens anders heen dan naar de eigen origin.
    const page = await fetch(`${baseUrl}/login.html`);
    await page.text();
    assert.match(page.headers.get("content-security-policy"), /(^|; )form-action 'self'(;|$)/);
  });

  await t.test("Entra-flow (gesimuleerd): login_hint, redirect per rol en foutcodes", async (st) => {
    if (isEntraLoginConfigured()) {
      st.skip("echte Entra-config aanwezig; de gesimuleerde flow draait alleen zonder");
      return;
    }
    const restoreEnv = enableFakeEntraLogin();
    st.after(restoreEnv);

    const config = await request(baseUrl, "GET", "/api/auth/config");
    assert.equal(config.data.mode, "entra");

    // Lokale login is in Entra-modus helemaal dicht: een bcrypt-wachtwoord zou Entra en de
    // MFA-policy omzeilen, ook voor de System Owner en een Company Admin met een oude
    // password_hash. Het antwoord is voor elk account gelijk (geen enumeratie).
    const localAttempts = [
      { email: owner.email, password: owner.password },
      { email: admin.email, password: admin.password },
      { email: owner.email, password: "helemaal-verkeerd" },
      { email: `onbekend-${crypto.randomBytes(4).toString("hex")}@example.com`, password: "x" },
      { email: "geen-email", password: "" }
    ];
    const localResponses = [];
    for (const body of localAttempts) {
      const res = await request(baseUrl, "POST", "/api/auth/login", { body });
      assert.equal(res.status, 404, `lokale login voor ${body.email} hoort dicht te zijn`);
      assert.equal(res.cookie, null, "geen sessie-cookie in Entra-modus");
      localResponses.push(res.data);
    }
    assert.equal(localResponses[0].error.code, "LOCAL_LOGIN_DISABLED");
    for (const data of localResponses) assert.deepEqual(data, localResponses[0]);

    // CSP3 toetst form-action ook tegen de 302 na de form-post: zonder de Entra-origin
    // blokkeert Chrome/Edge "Doorgaan" op /login.html.
    const page = await fetch(`${baseUrl}/login.html`);
    await page.text();
    assert.match(page.headers.get("content-security-policy"), /(^|; )form-action 'self' https:\/\/dpptest\.ciamlogin\.com(;|$)/);

    // Start de flow zoals /login.html dat doet (form-post met e-mail) en geef state,
    // nonce en de state-cookie terug voor de callback.
    async function startFlow(form) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString()
      });
      await response.text();
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "https://login.example.test/authorize");
      const authRequest = fakeEntra.authUrlRequests[fakeEntra.authUrlRequests.length - 1];
      return { authRequest, stateCookie: cookieFrom(response, "dpp_oauth_state") };
    }

    async function callback({ stateCookie, form }) {
      const response = await fetch(`${baseUrl}/auth/redirect`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(stateCookie ? { Cookie: stateCookie } : {})
        },
        body: new URLSearchParams(form).toString()
      });
      await response.text();
      return { status: response.status, location: response.headers.get("location"), response };
    }

    async function loginViaEntra(email, claimsOverride = {}) {
      const { authRequest, stateCookie } = await startFlow({ email });
      fakeEntra.claims = { sub: crypto.randomBytes(16).toString("hex"), email, nonce: authRequest.nonce, ...claimsOverride };
      return callback({ stateCookie, form: { code: "fake-code", state: authRequest.state } });
    }

    // login_hint: genormaliseerd e-mailadres uit de form-post; ongeldig -> geen hint.
    const withHint = await startFlow({ email: `  ${viewer.email.toUpperCase()} ` });
    assert.equal(withHint.authRequest.loginHint, viewer.email);
    assert.equal(withHint.authRequest.responseMode, "form_post");
    assert.equal(withHint.authRequest.codeChallengeMethod, "S256");
    assert.ok(withHint.stateCookie, "state-cookie wordt gezet");
    const withoutHint = await startFlow({ email: "geen-email" });
    assert.equal(withoutHint.authRequest.loginHint, undefined);

    // Succes: company-gebruiker -> /app, System Owner -> /admin, met sessie.
    const viewerLogin = await loginViaEntra(viewer.email);
    assert.equal(viewerLogin.status, 302);
    assert.equal(viewerLogin.location, "/app/index.html");
    const sessionCookie = cookieFrom(viewerLogin.response, "dpp_session");
    assert.ok(sessionCookie, "sessie-cookie gezet");
    assert.ok(fakeEntra.tokenRequests[fakeEntra.tokenRequests.length - 1].codeVerifier, "PKCE-verifier meegestuurd");
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.id, viewer.id);

    const ownerLogin = await loginViaEntra(owner.email);
    assert.equal(ownerLogin.location, "/admin/index.html");

    // De JIT-koppeling haalt het lokale wachtwoord weg: een Entra-account houdt geen
    // bcrypt-pad zonder MFA naast Entra (ook de gezaaide System Owner niet).
    const linkedHashes = await pool
      .request()
      .input("ownerId", sql.Int, owner.id)
      .input("viewerId", sql.Int, viewer.id)
      .query("SELECT password_hash, entra_subject_id FROM dbo.Users WHERE id IN (@ownerId, @viewerId)");
    assert.equal(linkedHashes.recordset.length, 2);
    for (const row of linkedHashes.recordset) {
      assert.ok(row.entra_subject_id, "account is gekoppeld");
      assert.equal(row.password_hash, null, "geen lokaal wachtwoord meer na de Entra-koppeling");
    }

    // Foutpaden: altijd een vaste code in de URL, nooit JSON of ruwe tekst.
    const unknown = await loginViaEntra(`onbekend-${crypto.randomBytes(4).toString("hex")}@example.com`);
    assert.equal(unknown.location, "/login.html?error=no_account");

    const missingSub = await loginViaEntra(viewer.email, { sub: undefined });
    assert.equal(missingSub.location, "/login.html?error=login_failed");

    // suspendedUser is eerder in deze test al aan een sub gekoppeld (resolveEntraLogin-test).
    const linkedSub = (
      await pool.request().input("id", sql.Int, suspendedUser.id).query("SELECT entra_subject_id FROM dbo.Users WHERE id = @id")
    ).recordset[0].entra_subject_id;
    const suspended = await loginViaEntra(suspendedUser.email, { sub: linkedSub });
    assert.equal(suspended.location, "/login.html?error=inactive");
    assert.equal(cookieFrom(suspended.response, "dpp_session"), null, "geen sessie voor een inactieve company");

    const wrongNonce = await loginViaEntra(viewer.email, { nonce: "iets-anders" });
    assert.equal(wrongNonce.location, "/login.html?error=state");

    const flow = await startFlow({ email: viewer.email });
    const wrongState = await callback({ stateCookie: flow.stateCookie, form: { code: "c", state: "verkeerd" } });
    assert.equal(wrongState.location, "/login.html?error=state");
    const noCookie = await callback({ form: { code: "c", state: flow.authRequest.state } });
    assert.equal(noCookie.location, "/login.html?error=state");

    const idpError = await callback({
      stateCookie: flow.stateCookie,
      form: { error: "access_denied", error_description: "AADSTS: geheime details" }
    });
    assert.equal(idpError.location, "/login.html?error=login_failed");

    fakeEntra.tokenError = new Error("AADSTS54005: code already redeemed");
    try {
      const tokenFailure = await loginViaEntra(viewer.email);
      assert.equal(tokenFailure.location, "/login.html?error=login_failed");
    } finally {
      fakeEntra.tokenError = null;
    }

    const entraAudit = await pool
      .request()
      .input("userId", sql.Int, viewer.id)
      .query("SELECT metadata FROM dbo.AuditLogs WHERE user_id = @userId AND action = 'login' AND metadata LIKE '%entra%'");
    assert.ok(entraAudit.recordset.length >= 1, "Entra-login wordt geaudit");
  });

  await t.test("rate limit: na 10 pogingen voor hetzelfde e-mailadres volgt 429", async () => {
    const email = `ratelimit-${crypto.randomBytes(6).toString("hex")}@example.com`;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email, password: "fout" } });
      assert.equal(res.status, 401, `poging ${attempt} hoort nog een gewone 401 te geven`);
    }

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.toUpperCase(), password: "fout" })
    });
    const data = await response.json();
    assert.equal(response.status, 429);
    assert.equal(data.error.code, "RATE_LIMITED");
    assert.ok(Number(response.headers.get("retry-after")) > 0);

    // Een ander account vanaf hetzelfde ip wordt niet meegeblokkeerd (en lokale login werkt
    // weer zodra de Entra-config uit de vorige subtest is teruggezet).
    const other = await login(baseUrl, admin);
    assert.equal(other.status, 200);
  });

  // Moet de laatste subtest blijven: daarna is 127.0.0.1 in dit proces een kwartier
  // geblokkeerd voor /api/auth/login.
  await t.test("rate limit per ip: veel verschillende e-mailadressen vanaf één ip -> 429", async () => {
    // Leeg wachtwoord -> goedkope 400 zonder bcrypt; telt toch mee, want de limiters staan
    // vóór de validatie. Elk adres maar één keer, dus de per-account-limiter (10) kan hier
    // nooit de 429 geven: dit is password spraying, niet brute force op één account.
    const prefix = `spray-${crypto.randomBytes(4).toString("hex")}`;
    let limited = null;
    let attempts = 0;
    while (!limited && attempts < 101) {
      attempts += 1;
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${prefix}-${attempts}@example.com`, password: "" })
      });
      const data = await response.json();
      if (response.status === 429) {
        limited = { data, retryAfter: Number(response.headers.get("retry-after")) };
      } else {
        assert.equal(response.status, 400, `poging ${attempts} hoort nog een gewone 400 te geven`);
      }
    }
    assert.ok(limited, "uiterlijk na 100 pogingen per ip volgt 429");
    assert.ok(attempts > 10, "de 429 komt van de ip-limiet, niet van de per-account-limiet");
    assert.equal(limited.data.error.code, "RATE_LIMITED");
    assert.ok(limited.retryAfter > 0);

    // Nu is ook een geldig account vanaf dit ip geblokkeerd; bcrypt draait niet meer.
    const blocked = await login(baseUrl, admin);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.cookie, null);
  });
});
