const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

// COOKIE_SECRET hoort bij de Entra-loginconfig en wordt bij het laden van de app aan
// cookie-parser gegeven: daarom vóór het laden zetten. Random per testrun, geen secret in de code.
process.env.COOKIE_SECRET ||= crypto.randomBytes(32).toString("hex");

const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

const HSTS_VALUE = "max-age=31536000; includeSubDomains";

const ENTRA_LOGIN_VARS = [
  "ENTRA_TENANT_NAME",
  "ENTRA_TENANT_ID",
  "ENTRA_WEB_CLIENT_ID",
  "ENTRA_WEB_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "ENTRA_POST_LOGOUT_REDIRECT_URI"
];

// Tijdelijk een env var zetten (undefined = weghalen); geeft een herstelfunctie terug.
function withEnv(values) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

// Nep-Entra-config: GET /auth/logout bouwt alleen de end-session-URL, er gaat niets naar
// een echte tenant (geen MSAL-call in die route).
function enableFakeEntraLogin() {
  return withEnv({
    ENTRA_TENANT_NAME: "dpptest",
    ENTRA_TENANT_ID: crypto.randomUUID(),
    ENTRA_WEB_CLIENT_ID: crypto.randomUUID(),
    ENTRA_WEB_CLIENT_SECRET: crypto.randomBytes(16).toString("hex"),
    ENTRA_REDIRECT_URI: "http://127.0.0.1/auth/redirect",
    ENTRA_POST_LOGOUT_REDIRECT_URI: "http://127.0.0.1/login.html"
  });
}

async function rawGet(baseUrl, path, cookie) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : undefined });
}

test("shell-security: HSTS en de logout-route waar 'Uitloggen' op leunt", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyId = await createTestCompany("Shell Security");
  const admin = await createTestUser({ companyId, role: "company_admin" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [admin.id] });
    await stopTestServer(server);
    await sql.close();
  });

  await t.test("HSTS op pagina's, API-responses en 404's buiten development", async () => {
    const restore = withEnv({ NODE_ENV: "production" });
    try {
      for (const path of ["/login.html", "/api/auth/config", "/bestaat-niet"]) {
        const res = await rawGet(baseUrl, path);
        assert.equal(res.headers.get("strict-transport-security"), HSTS_VALUE, `HSTS op ${path}`);
        // De bestaande headers blijven naast HSTS staan.
        assert.ok(res.headers.get("content-security-policy"), `CSP op ${path}`);
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      }
    } finally {
      restore();
    }
  });

  await t.test("HSTS ook zonder NODE_ENV (fail-closed, net als de secure sessie-cookie)", async () => {
    const restore = withEnv({ NODE_ENV: undefined });
    try {
      const res = await rawGet(baseUrl, "/login.html");
      assert.equal(res.headers.get("strict-transport-security"), HSTS_VALUE);
    } finally {
      restore();
    }
  });

  await t.test("geen HSTS bij NODE_ENV=development (localhost niet aan https vastpinnen)", async () => {
    const restore = withEnv({ NODE_ENV: "development" });
    try {
      const res = await rawGet(baseUrl, "/login.html");
      assert.equal(res.headers.get("strict-transport-security"), null);
      assert.ok(res.headers.get("content-security-policy"));
    } finally {
      restore();
    }
  });

  await t.test("Entra-modus: GET /auth/logout beëindigt de DPP-sessie én stuurt naar Entra end-session", async () => {
    // Lokaal inloggen kan alleen zonder Entra-config (daarna is POST /api/auth/login dicht);
    // de modus wordt per request bepaald, dus daarna Entra aanzetten.
    const loginRes = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: admin.email, password: admin.password }
    });
    assert.equal(loginRes.status, 200);
    const sessionCookie = loginRes.cookie;
    assert.ok(sessionCookie);

    const restore = enableFakeEntraLogin();
    try {
      // layout.js kiest op basis hiervan voor de navigatie naar /auth/logout.
      const configRes = await request(baseUrl, "GET", "/api/auth/config");
      assert.deepEqual(configRes.data, { mode: "entra" });

      const res = await rawGet(baseUrl, "/auth/logout", sessionCookie);
      assert.equal(res.status, 302);
      const location = res.headers.get("location");
      assert.ok(
        location.startsWith("https://dpptest.ciamlogin.com/dpptest.onmicrosoft.com/oauth2/v2.0/logout?post_logout_redirect_uri="),
        `onverwachte redirect: ${location}`
      );
      assert.ok(location.endsWith(encodeURIComponent("http://127.0.0.1/login.html")));
      // Geen sessietoken in de redirect-URL.
      assert.ok(!location.includes(sessionCookie.split("=")[1]));

      // De UI doet in Entra-modus géén POST /api/auth/logout meer: deze route moet de
      // DPP-sessie dus zelf beëindigen.
      const meRes = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
      assert.equal(meRes.status, 401);

      const pool = await getPool();
      const audit = await pool
        .request()
        .input("userId", sql.Int, admin.id)
        .query("SELECT TOP 1 metadata FROM dbo.AuditLogs WHERE user_id = @userId AND action = 'logout' ORDER BY id DESC");
      assert.equal(audit.recordset.length, 1, "logout wordt geauditlogd");
      assert.match(audit.recordset[0].metadata || "", /entra/);

      // Ook zonder (of met een al ingetrokken) DPP-sessie moet de Entra SSO-sessie eindigen:
      // geen 401-pagina, maar altijd door naar end-session.
      for (const cookie of [undefined, sessionCookie]) {
        const again = await rawGet(baseUrl, "/auth/logout", cookie);
        assert.equal(again.status, 302);
        assert.ok(again.headers.get("location").startsWith("https://dpptest.ciamlogin.com/"));
      }
    } finally {
      restore();
    }
  });
});
