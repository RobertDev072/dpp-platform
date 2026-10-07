const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Impersonatie ("inloggen als"): de Platform Owner mag iedereen impersoneren, een
// company_admin alleen actieve company_admin/company_user-accounts binnen het eigen
// bedrijf. Nooit genest, volledig audit-gelogd met beide id's, en de eigen sessie is via
// de stop-route te herstellen.

function cookiesFrom(res, raw) {
  // request() geeft alleen de eerste Set-Cookie terug; voor impersonatie hebben we
  // beide cookies nodig. Deze helper haalt ze uit een rauwe fetch-response.
  const cookies = raw.headers.getSetCookie ? raw.headers.getSetCookie() : [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

test("impersonatie: volledige start/stop-cyclus met audit-logging", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyId = await createTestCompany("Impersonatie Co");
  const otherCompanyId = await createTestCompany("Andere Co");
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const admin = await createTestUser({ companyId, role: "company_admin" });
  const medewerker = await createTestUser({ companyId, role: "company_user" });
  const otherCompanyUser = await createTestUser({ companyId: otherCompanyId, role: "company_user" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyId, otherCompanyId],
      userIds: [owner.id, admin.id, medewerker.id, otherCompanyUser.id]
    });
    await stopTestServer(server);
  });

  // Log in als Platform Owner (rauwe fetch zodat we alle cookies kunnen zien).
  const loginRaw = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: owner.email, password: owner.password })
  });
  assert.equal(loginRaw.status, 200);
  const ownerCookie = cookiesFrom(null, loginRaw);

  let impersonationCookies;

  await t.test("start: owner impersoneert een company_admin en krijgt beide cookies", async () => {
    const raw = await fetch(`${baseUrl}/api/admin/impersonate/${admin.id}`, {
      method: "POST",
      headers: { Cookie: ownerCookie }
    });
    assert.equal(raw.status, 200);
    const data = await raw.json();
    assert.equal(data.impersonating.id, admin.id);

    const setCookies = raw.headers.getSetCookie();
    assert.ok(setCookies.some((c) => c.startsWith("dpp_session_orig=")), "verwacht dpp_session_orig-cookie");
    assert.ok(setCookies.some((c) => c.startsWith("dpp_session=")), "verwacht nieuwe dpp_session-cookie");
    impersonationCookies = setCookies.map((c) => c.split(";")[0]).join("; ");
  });

  await t.test("/me toont de geïmpersoneerde gebruiker mét impersonator-info", async () => {
    const res = await request(baseUrl, "GET", "/api/auth/me", { cookie: impersonationCookies });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, admin.id);
    assert.equal(res.data.impersonator.id, owner.id);
  });

  await t.test("genest impersoneren is geblokkeerd", async () => {
    const res = await request(baseUrl, "POST", `/api/admin/impersonate/${medewerker.id}`, {
      cookie: impersonationCookies
    });
    assert.equal(res.status, 403);
  });

  await t.test("status-/rolwijzigingen zijn geblokkeerd tijdens impersonatie", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: impersonationCookies,
      body: { status: "blocked" }
    });
    assert.equal(res.status, 403);
  });

  await t.test("audit-log bevat impersonate_start met beide id's", async () => {
    const pool = await getPool();
    const rows = await pool
      .request()
      .input("targetId", sql.NVarChar(50), String(admin.id))
      .query(`
        SELECT user_id, impersonator_user_id, action
        FROM dbo.AuditLogs
        WHERE action = 'impersonate_start' AND entity_type = 'User' AND entity_id = @targetId
        ORDER BY id DESC
        LIMIT 1
      `);
    assert.equal(rows.recordset.length, 1);
    assert.equal(rows.recordset[0].user_id, owner.id);
    assert.equal(rows.recordset[0].impersonator_user_id, owner.id);
  });

  await t.test("stop: eigen sessie wordt hersteld", async () => {
    const raw = await fetch(`${baseUrl}/api/admin/impersonate/stop`, {
      method: "POST",
      headers: { Cookie: impersonationCookies }
    });
    assert.equal(raw.status, 200);
    const data = await raw.json();
    assert.equal(data.restored.id, owner.id);
  });

  await t.test("stop met gemanipuleerde orig-cookie faalt", async () => {
    // Nieuwe impersonatiesessie starten...
    const raw = await fetch(`${baseUrl}/api/admin/impersonate/${admin.id}`, {
      method: "POST",
      headers: { Cookie: ownerCookie }
    });
    assert.equal(raw.status, 200);
    const setCookies = raw.headers.getSetCookie();
    const sessionOnly = setCookies.find((c) => c.startsWith("dpp_session=")).split(";")[0];
    // ...maar stoppen met een vervalste orig-cookie.
    const stopRaw = await fetch(`${baseUrl}/api/admin/impersonate/stop`, {
      method: "POST",
      headers: { Cookie: `${sessionOnly}; dpp_session_orig=vervalst-token` }
    });
    assert.equal(stopRaw.status, 403);
  });

  await t.test("company_admin mag een medewerker uit het eigen bedrijf impersoneren", async () => {
    const adminLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: admin.email, password: admin.password }
    });
    assert.equal(adminLogin.status, 200);
    const res = await request(baseUrl, "POST", `/api/admin/impersonate/${medewerker.id}`, {
      cookie: adminLogin.cookie
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.impersonating.id, medewerker.id);
  });

  await t.test("company_admin mag geen gebruiker van een ander bedrijf impersoneren (404, niet 403)", async () => {
    const adminLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: admin.email, password: admin.password }
    });
    assert.equal(adminLogin.status, 200);
    const res = await request(baseUrl, "POST", `/api/admin/impersonate/${otherCompanyUser.id}`, {
      cookie: adminLogin.cookie
    });
    assert.equal(res.status, 404);
  });

  await t.test("company_admin mag de Platform Owner niet impersoneren", async () => {
    const adminLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: admin.email, password: admin.password }
    });
    assert.equal(adminLogin.status, 200);
    const res = await request(baseUrl, "POST", `/api/admin/impersonate/${owner.id}`, {
      cookie: adminLogin.cookie
    });
    assert.equal(res.status, 404);
  });
});

after(async () => {
  await sql.close();
});
