const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// "Verwijderen" is een soft delete (status = 'deleted', zie migratie 011): de rij en zijn
// audit-trail blijven bestaan, maar requireAuth accepteert alleen status = 'active', dus de
// gebruiker kan sowieso niet meer inloggen - onafhankelijk van of de (hier niet
// geconfigureerde) Entra-koppeling ook daadwerkelijk lukt te verwijderen.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("gebruiker verwijderen: soft delete blokkeert login en respecteert de last-admin-guard", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyId = await createTestCompany("Delete Co");
  const admin = await createTestUser({ companyId, role: "company_admin" });
  const medewerker = await createTestUser({ companyId, role: "company_user" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [admin.id, medewerker.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const adminCookie = await login(baseUrl, admin);

  await t.test("company_admin kan een medewerker uit het eigen bedrijf verwijderen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: adminCookie,
      body: { status: "deleted" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "deleted");
  });

  await t.test("een verwijderde gebruiker kan niet meer inloggen", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: medewerker.email, password: medewerker.password }
    });
    assert.equal(res.status, 401);
  });

  await t.test("de laatste actieve company_admin kan niet verwijderd worden", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${admin.id}`, {
      cookie: adminCookie,
      body: { status: "deleted" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "LAST_COMPANY_ADMIN");
  });
});
