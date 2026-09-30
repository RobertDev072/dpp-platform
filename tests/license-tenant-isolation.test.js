const test = require("node:test");
const assert = require("node:assert/strict");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

// Licenties zijn strikt per tenant: bedrijf A op zijn limiet mag bedrijf B (zelfde
// plan) nooit raken. Plus: productlimiet-afdwinging, verlopen-licentie-blokkade en
// de aangescherpte adminrechten (zelf-wijziging, admin-op-admin, promotie,
// reactivatie-seat-check).

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

test("licenties en adminrechten: per-tenant limieten, verlopen licentie en rolguards", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();

  // Plan met 2 gebruikers / 1 product.
  const planResult = await pool.request().query(`
    INSERT INTO dbo.Plans (name, max_users, max_products)
    OUTPUT INSERTED.id VALUES ('Test Krap Plan', 2, 1)
  `);
  const planId = planResult.recordset[0].id;

  const companyA = await createTestCompany("Licentie A");
  const companyB = await createTestCompany("Licentie B");
  for (const cid of [companyA, companyB]) {
    await pool.request().input("cid", sql.Int, cid).input("pid", sql.Int, planId)
      .query("UPDATE dbo.Companies SET plan_id = @pid WHERE id = @cid");
  }

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminA2 = await createTestUser({ companyId: companyA, role: "company_admin" });
  const medewerkerA = await createTestUser({ companyId: companyA, role: "company_user", }) ;
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const productA = await createTestProduct({ companyId: companyA });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [owner.id, adminA.id, adminA2.id, medewerkerA.id, adminB.id],
      productIds: [productA]
    });
    await pool.request().input("pid", sql.Int, planId).query("DELETE FROM dbo.Plans WHERE id = @pid");
    await stopTestServer(server);
    await sql.close();
  });

  const ownerCookie = await login(baseUrl, owner);
  const adminACookie = await login(baseUrl, adminA);
  const adminBCookie = await login(baseUrl, adminB);

  // --- Per-tenant productlimiet ---
  await t.test("bedrijf A op productlimiet (1/1) kan geen product meer aanmaken", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: adminACookie,
      body: { name: "Te veel" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "LICENSE_LIMIT_REACHED");
  });

  await t.test("bedrijf B (zelfde plan, eigen limiet) kan gewoon een product aanmaken", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: adminBCookie,
      body: { name: "Product B mag wel" }
    });
    assert.equal(res.status, 201);
  });

  // --- Eigen licentiegebruik zichtbaar, per bedrijf ---
  await t.test("company-licentie-endpoint toont het eigen (volle) verbruik van A", async () => {
    const res = await request(baseUrl, "GET", "/api/company/license", { cookie: adminACookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.products.used, 1);
    assert.equal(res.data.products.max, 1);
    assert.equal(res.data.status, "Limiet bereikt");
  });

  await t.test("owner-overzicht toont A en B elk met eigen verbruik", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/licenses/overview", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    const a = res.data.find((r) => r.companyId === companyA);
    const b = res.data.find((r) => r.companyId === companyB);
    assert.equal(a.products.used, 1);
    assert.equal(b.products.used, 1);
    assert.notEqual(a.status, undefined);
  });

  // --- Verlopen licentie blokkeert aanmaken, bestaande blijft werken ---
  await t.test("verlopen licentie blokkeert product- en gebruikersaanmaak met duidelijke code", async () => {
    await pool.request().input("cid", sql.Int, companyB)
      .query("UPDATE dbo.Companies SET license_end = DATEADD(day, -1, CAST(SYSUTCDATETIME() AS date)) WHERE id = @cid");

    const product = await request(baseUrl, "POST", "/api/products", {
      cookie: adminBCookie,
      body: { name: "Na verloop" }
    });
    assert.equal(product.status, 409);
    assert.equal(product.data.error.code, "LICENSE_EXPIRED");

    const user = await request(baseUrl, "POST", "/api/users", {
      cookie: adminBCookie,
      body: { email: `verlopen-${Date.now()}@example.com`, role: "company_user" }
    });
    assert.equal(user.status, 409);
    assert.equal(user.data.error.code, "LICENSE_EXPIRED");

    // Bestaande functionaliteit blijft werken: lijst opvragen kan gewoon.
    const lijst = await request(baseUrl, "GET", "/api/products", { cookie: adminBCookie });
    assert.equal(lijst.status, 200);
  });

  // --- Aangescherpte adminrechten ---
  await t.test("admin kan zijn eigen rol/status niet wijzigen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${adminA.id}`, {
      cookie: adminACookie,
      body: { status: "blocked" }
    });
    assert.equal(res.status, 403);
  });

  await t.test("admin kan een andere company_admin niet wijzigen", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${adminA2.id}`, {
      cookie: adminACookie,
      body: { role: "company_user" }
    });
    assert.equal(res.status, 403);
  });

  await t.test("admin mag een medewerker wél promoveren tot company_admin", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${medewerkerA.id}`, {
      cookie: adminACookie,
      body: { role: "company_admin" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.role, "company_admin");
    // Terugdraaien kan alleen door de owner (admin-op-admin is nu geblokkeerd).
    const terug = await request(baseUrl, "PATCH", `/api/users/${medewerkerA.id}`, {
      cookie: ownerCookie,
      body: { role: "company_user" }
    });
    assert.equal(terug.status, 200);
  });

  await t.test("reactiveren boven de seat-limiet geeft 409", async () => {
    // A heeft max 2 gebruikers; er zijn er nu 3 actief (adminA, adminA2, medewerkerA)
    // - dat mag historisch zo zijn, maar archiveren + herstellen mag er niet nóg een
    // bij laten komen zodra het maximum bereikt of overschreden is.
    const archiveer = await request(baseUrl, "PATCH", `/api/users/${medewerkerA.id}`, {
      cookie: ownerCookie,
      body: { status: "archived" }
    });
    assert.equal(archiveer.status, 200);

    const herstel = await request(baseUrl, "PATCH", `/api/users/${medewerkerA.id}`, {
      cookie: ownerCookie,
      body: { status: "active" }
    });
    assert.equal(herstel.status, 409);
    assert.equal(herstel.data.error.code, "LICENSE_LIMIT_REACHED");
  });
});
