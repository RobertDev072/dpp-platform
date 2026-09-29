const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// "Verwijderen" is een soft delete (status = 'deleted', zie migratie 011): de rij en zijn
// audit-trail blijven bestaan, maar requireAuth accepteert alleen status = 'active', dus de
// gebruiker kan sowieso niet meer inloggen. Definitief verwijderen is voorbehouden aan de
// Platform Owner; een company_admin archiveert (omkeerbaar).

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("gebruiker verwijderen: owner-only, soft delete blokkeert login, admins archiveren", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyId = await createTestCompany("Delete Co");
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const admin = await createTestUser({ companyId, role: "company_admin" });
  const medewerker = await createTestUser({ companyId, role: "company_user" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [owner.id, admin.id, medewerker.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const ownerCookie = await login(baseUrl, owner);
  const adminCookie = await login(baseUrl, admin);

  await t.test("company_admin mag NIET definitief verwijderen (403), wel archiveren", async () => {
    const del = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: adminCookie,
      body: { status: "deleted" }
    });
    assert.equal(del.status, 403);

    const archive = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: adminCookie,
      body: { status: "archived" }
    });
    assert.equal(archive.status, 200);
    assert.equal(archive.data.status, "archived");

    const restore = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: adminCookie,
      body: { status: "active" }
    });
    assert.equal(restore.status, 200);
  });

  await t.test("platform_owner kan een medewerker definitief verwijderen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${medewerker.id}`, {
      cookie: ownerCookie,
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

  await t.test("verwijderde gebruikers verschijnen niet meer in de lijst", async () => {
    const res = await request(baseUrl, "GET", "/api/users", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    assert.ok(!res.data.some((u) => u.id === medewerker.id));
  });

  await t.test("de laatste actieve company_admin kan ook door de owner niet verwijderd worden", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${admin.id}`, {
      cookie: ownerCookie,
      body: { status: "deleted" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "LAST_COMPANY_ADMIN");
  });
});
