const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestUser, cleanupTestData } = require("./helpers/fixtures");

test("auth: login, /me, logout", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const userIds = [owner.id];

  t.after(async () => {
    await cleanupTestData({ userIds });
    await stopTestServer(server);
    await closePool();
  });

  await t.test("verkeerd wachtwoord geeft 401", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: owner.email, password: "verkeerd-wachtwoord" }
    });
    assert.equal(res.status, 401);
  });

  await t.test("onbekende e-mail geeft 401", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: "onbekend@example.com", password: "iets" }
    });
    assert.equal(res.status, 401);
  });

  await t.test("/me zonder cookie geeft 401", async () => {
    const res = await request(baseUrl, "GET", "/api/auth/me");
    assert.equal(res.status, 401);
  });

  let sessionCookie;

  await t.test("correcte login geeft 200 en zet sessie-cookie", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: owner.email, password: owner.password }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.email, owner.email);
    assert.equal(res.data.role, "platform_owner");
    assert.ok(res.cookie, "verwacht een Set-Cookie header");
    sessionCookie = res.cookie;
  });

  await t.test("/me met geldige cookie geeft de ingelogde gebruiker", async () => {
    const res = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, owner.id);
  });

  await t.test("login-actie wordt gelogd in AuditLogs", async () => {
    const result = await query("SELECT action FROM audit_logs WHERE user_id = $1 AND action = 'login' LIMIT 1", [owner.id]);
    assert.equal(result.rows.length, 1);
  });

  await t.test("logout maakt de sessie ongeldig", async () => {
    const logoutRes = await request(baseUrl, "POST", "/api/auth/logout", { cookie: sessionCookie });
    assert.equal(logoutRes.status, 204);

    const meRes = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
    assert.equal(meRes.status, 401);
  });
});
