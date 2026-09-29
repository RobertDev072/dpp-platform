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

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const medewerkerA = await createTestUser({ companyId: companyA, role: "company_user" });

  const productA = await createTestProduct({ companyId: companyA, name: "Product A" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [owner.id, adminA.id, adminB.id, medewerkerA.id],
      productIds: [productA]
    });
    await stopTestServer(server);
    await sql.close();
  });

  let ownerCookie;
  let adminACookie;
  let adminBCookie;
  let medewerkerACookie;

  await t.test("setup: alle testgebruikers kunnen inloggen", async () => {
    ownerCookie = await login(baseUrl, owner);
    adminACookie = await login(baseUrl, adminA);
    adminBCookie = await login(baseUrl, adminB);
    medewerkerACookie = await login(baseUrl, medewerkerA);
  });

  await t.test("company_admin mag /api/admin/companies niet benaderen", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/companies", { cookie: adminACookie });
    assert.equal(res.status, 403);
  });

  await t.test("platform_owner mag /api/admin/companies wel benaderen", async () => {
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

  await t.test("productmedewerker (company_user) mag wel een product aanmaken in eigen bedrijf", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: medewerkerACookie,
      body: { name: "Nieuw product van medewerker" }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.company_id, companyA);
  });

  await t.test("platform_owner mag geen product aanmaken (alleen-lezen toezicht)", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: ownerCookie,
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
      body: { status: "blocked" }
    });
    assert.equal(res.status, 404);
  });

  await t.test("niemand kan een platform_owner aanmaken via de API (schema weigert de rol)", async () => {
    for (const cookie of [adminACookie, ownerCookie]) {
      const res = await request(baseUrl, "POST", "/api/users", {
        cookie,
        body: {
          email: `escalation-${Date.now()}@example.com`,
          password: "SomePassword123!",
          role: "platform_owner"
        }
      });
      assert.equal(res.status, 400);
    }
  });

  await t.test("laatste actieve company_admin kan niet geblokkeerd worden", async () => {
    // adminB is de enige actieve admin van company B.
    const res = await request(baseUrl, "PATCH", `/api/users/${adminB.id}`, {
      cookie: ownerCookie,
      body: { status: "blocked" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "LAST_COMPANY_ADMIN");
  });

  await t.test("platform_owner-account is voor een company_admin onzichtbaar (404)", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${owner.id}`, {
      cookie: adminACookie,
      body: { firstName: "Hack" }
    });
    assert.equal(res.status, 404);
  });
});
