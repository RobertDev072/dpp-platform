const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const {
  createTestCompany,
  createTestUser,
  createTestProduct,
  cleanupTestData
} = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("tenant isolation: bedrijven, gebruikers en producten blijven gescheiden", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyA = await createTestCompany("Company A");
  const companyB = await createTestCompany("Company B");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });

  const productA = await createTestProduct({ companyId: companyA, name: "Product A" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [owner.id, adminA.id, adminB.id, viewerA.id],
      productIds: [productA]
    });
    await stopTestServer(server);
    await sql.close();
  });

  let ownerCookie;
  let adminACookie;
  let adminBCookie;
  let viewerACookie;

  await t.test("setup: alle testgebruikers kunnen inloggen", async () => {
    ownerCookie = await login(baseUrl, owner);
    adminACookie = await login(baseUrl, adminA);
    adminBCookie = await login(baseUrl, adminB);
    viewerACookie = await login(baseUrl, viewerA);
  });

  await t.test("company_admin mag /api/admin/companies niet benaderen", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/companies", { cookie: adminACookie });
    assert.equal(res.status, 403);
  });

  await t.test("system_owner mag /api/admin/companies wel benaderen", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/companies", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    assert.ok(res.data.some((c) => c.id === companyA));
    assert.ok(res.data.some((c) => c.id === companyB));
  });

  await t.test("company_admin B ziet product van company A niet in de lijst", async () => {
    const res = await request(baseUrl, "GET", "/api/products", { cookie: adminBCookie });
    assert.equal(res.status, 200);
    assert.ok(!res.data.some((p) => p.id === productA));
  });

  await t.test("company_admin B krijgt 404 (niet 403) bij direct opvragen van product A", async () => {
    const res = await request(baseUrl, "GET", `/api/products/${productA}`, { cookie: adminBCookie });
    assert.equal(res.status, 404);
  });

  await t.test("company_admin B kan product A niet wijzigen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/products/${productA}`, {
      cookie: adminBCookie,
      body: { name: "Gehackt" }
    });
    assert.equal(res.status, 404);
  });

  await t.test("company_admin A kan eigen product wel opvragen en wijzigen", async () => {
    const getRes = await request(baseUrl, "GET", `/api/products/${productA}`, { cookie: adminACookie });
    assert.equal(getRes.status, 200);

    const patchRes = await request(baseUrl, "PATCH", `/api/products/${productA}`, {
      cookie: adminACookie,
      body: { name: "Bijgewerkt product A" }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.name, "Bijgewerkt product A");
  });

  await t.test("viewer mag geen product aanmaken", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: viewerACookie,
      body: { name: "Nieuw product" }
    });
    assert.equal(res.status, 403);
  });

  await t.test("company_admin A ziet alleen users van company A", async () => {
    const res = await request(baseUrl, "GET", "/api/users", { cookie: adminACookie });
    assert.equal(res.status, 200);
    assert.ok(res.data.every((u) => u.company_id === companyA));
    assert.ok(!res.data.some((u) => u.id === adminB.id));
  });

  await t.test("company_admin A kan geen user van company B wijzigen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${adminB.id}`, {
      cookie: adminACookie,
      body: { status: "inactive" }
    });
    assert.equal(res.status, 404);
  });

  await t.test("company_admin kan geen system_owner aanmaken", async () => {
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: {
        email: `escalation-${Date.now()}@example.com`,
        password: "SomePassword123!",
        role: "system_owner"
      }
    });
    assert.equal(res.status, 403);
  });
});
