const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
const { logAudit } = require("../src/utils/auditLog");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

const COMPLETE = {
  sku: "SKU-1",
  manufacturer: "Fabrikant BV",
  model: "M1",
  category: "Meubels",
  materials: "Hout",
  countryOfOrigin: "NL"
};

// public_id altijd gevuld: UQ_Products_PublicId uit 001 is een gewone UNIQUE-constraint en
// staat maar één NULL in de hele tabel toe (zou botsen met andere, gelijktijdige tests).
async function insertProduct(pool, companyId, { name, status = "draft", ...fields }) {
  const suffix = crypto.randomBytes(3).toString("hex");
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("name", sql.NVarChar(200), name === "" ? "" : `${name} ${suffix}`)
    .input("status", sql.NVarChar(20), status)
    .input("sku", sql.NVarChar(100), fields.sku ?? null)
    .input("manufacturer", sql.NVarChar(200), fields.manufacturer ?? null)
    .input("model", sql.NVarChar(150), fields.model ?? null)
    .input("category", sql.NVarChar(100), fields.category ?? null)
    .input("materials", sql.NVarChar(sql.MAX), fields.materials ?? null)
    .input("country", sql.NVarChar(100), fields.countryOfOrigin ?? null)
    .query(`
      INSERT INTO dbo.Products
        (company_id, name, status, sku, manufacturer, model, category, materials, country_of_origin, public_id)
      OUTPUT INSERTED.id
      VALUES (@companyId, @name, @status, @sku, @manufacturer, @model, @category, @materials, @country, NEWID())
    `);
  return result.recordset[0].id;
}

async function insertScans(pool, productId, daysAgoList, source = "qr") {
  for (const daysAgo of daysAgoList) {
    await pool
      .request()
      .input("productId", sql.Int, productId)
      .input("daysAgo", sql.Int, daysAgo)
      .input("source", sql.NVarChar(20), source)
      .query(`
        INSERT INTO dbo.ScanEvents (product_id, scanned_at, source)
        VALUES (@productId, DATEADD(day, -@daysAgo, SYSUTCDATETIME()), @source)
      `);
  }
}

test("eigen company: dashboard, rapportages, instellingen en audit blijven binnen de eigen company", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const cleanup = { companyIds: [], userIds: [], productIds: [], planIds: [] };

  // Direct registreren (vóór de setup): faalt de setup halverwege, dan worden server en
  // pool toch gesloten en blijft het testproces niet hangen.
  t.after(async () => {
    await cleanupTestData(cleanup);
    for (const id of cleanup.planIds) {
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Plans WHERE id = @id");
    }
    await stopTestServer(server);
    await sql.close();
  });

  const planResult = await pool
    .request()
    .input("name", sql.NVarChar(100), `Portal Plan ${crypto.randomBytes(3).toString("hex")}`)
    .query(`INSERT INTO dbo.Plans (name, max_users, max_products) OUTPUT INSERTED.id VALUES (@name, 5, 50)`);
  const planId = planResult.recordset[0].id;
  cleanup.planIds.push(planId);

  const companyA = await createTestCompany("Portal A");
  const companyB = await createTestCompany("Portal B");
  cleanup.companyIds.push(companyA, companyB);
  await pool
    .request()
    .input("id", sql.Int, companyA)
    .input("planId", sql.Int, planId)
    .query("UPDATE dbo.Companies SET plan_id = @planId, kvk_number = '12345678' WHERE id = @id");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  cleanup.userIds.push(owner.id);
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });
  const managerA = await createTestUser({ companyId: companyA, role: "product_manager" });
  const blockedA = await createTestUser({ companyId: companyA, role: "company_user" });
  await pool.request().input("id", sql.Int, blockedA.id).query("UPDATE dbo.Users SET status = 'blocked' WHERE id = @id");
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });

  // Company A: 1 compleet concept, 1 incompleet concept, 1 in review (mist materials),
  // 1 gepubliceerd (compleet), 1 gearchiveerd (incompleet, telt niet als "incompleet").
  const completeDraft = await insertProduct(pool, companyA, { name: "Compleet", ...COMPLETE });
  const incompleteDraft = await insertProduct(pool, companyA, { name: "Incompleet", category: "Lampen" });
  const reviewMissing = await insertProduct(pool, companyA, {
    name: "Review",
    status: "review",
    ...COMPLETE,
    materials: "   "
  });
  const published = await insertProduct(pool, companyA, { name: "Gepubliceerd", status: "published", ...COMPLETE });
  const archived = await insertProduct(pool, companyA, { name: "Archief", status: "archived" });
  const productB = await insertProduct(pool, companyB, { name: "Van B", status: "published", ...COMPLETE });

  await insertScans(pool, published, [0, 0, 1, 5, 40]);
  // Gewone paginabezoeken (gedeelde link) en rijen zonder bron tellen niet als QR-scan.
  await insertScans(pool, published, [0, 3], "web");
  await insertScans(pool, published, [0], null);
  await insertScans(pool, completeDraft, [2]);
  await insertScans(pool, productB, [0, 0, 0, 0, 0, 0, 0]);

  await logAudit({ companyId: companyA, userId: adminA.id, action: "update", entityType: "Product", entityId: published });
  await logAudit({ companyId: companyA, userId: owner.id, action: "plan_change", entityType: "Company", entityId: companyA });
  await logAudit({ companyId: companyB, userId: adminB.id, action: "update", entityType: "Product", entityId: productB });

  const ownerCookie = await login(baseUrl, owner);
  const adminCookie = await login(baseUrl, adminA);
  const viewerCookie = await login(baseUrl, viewerA);
  const managerCookie = await login(baseUrl, managerA);
  const adminBCookie = await login(baseUrl, adminB);

  await t.test("system owner heeft geen eigen company: 403 op alle /api/company-routes", async () => {
    for (const [method, path] of [
      ["GET", "/api/company"],
      ["GET", "/api/company/dashboard"],
      ["GET", "/api/company/reports"],
      ["GET", "/api/company/audit"]
    ]) {
      const res = await request(baseUrl, method, path, { cookie: ownerCookie });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    const patch = await request(baseUrl, "PATCH", "/api/company", { cookie: ownerCookie, body: { country: "BE" } });
    assert.equal(patch.status, 403);
  });

  await t.test("zonder login: 401", async () => {
    const res = await request(baseUrl, "GET", "/api/company");
    assert.equal(res.status, 401);
  });

  await t.test("GET /api/company geeft de eigen company met plan en seats", async () => {
    const res = await request(baseUrl, "GET", "/api/company", { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.id, companyA);
    assert.equal(res.data.kvk_number, "12345678");
    assert.equal(res.data.status, "active");
    assert.equal(res.data.plan.id, planId);
    assert.deepEqual(res.data.seats, { maxUsers: 5, activeUsers: 3, remainingSeats: 2 });
    for (const key of ["name", "country", "address", "contact_name", "contact_email"]) {
      assert.ok(key in res.data, `veld ${key} ontbreekt`);
    }

    const other = await request(baseUrl, "GET", "/api/company", { cookie: adminBCookie });
    assert.equal(other.data.id, companyB);
    assert.equal(other.data.plan, null);
  });

  await t.test("dashboard telt alleen de eigen company", async () => {
    const res = await request(baseUrl, "GET", "/api/company/dashboard", { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.users, { total: 4, active: 3, inactive: 0, blocked: 1 });
    assert.deepEqual(res.data.seats, { maxUsers: 5, activeUsers: 3, remainingSeats: 2 });
    assert.deepEqual(res.data.products, { total: 5, draft: 2, review: 1, published: 1, archived: 1 });
    assert.deepEqual(res.data.scans, { total: 6, last30Days: 5 });

    assert.ok(res.data.recentActivity.length >= 2);
    assert.ok(
      !res.data.recentActivity.some((item) => item.entity_type === "Product" && item.entity_id === String(productB)),
      "audit van company B lekt niet"
    );
    const ownerEntry = res.data.recentActivity.find((item) => item.action === "plan_change");
    assert.equal(ownerEntry.actor_type, "platform");
    assert.equal(ownerEntry.actor_email, null, "e-mailadres van de System Owner wordt niet getoond");
  });

  await t.test("viewer ziet het dashboard (zonder recente activiteit) maar geen instellingen/audit/rapportages", async () => {
    const company = await request(baseUrl, "GET", "/api/company", { cookie: viewerCookie });
    assert.equal(company.status, 200);
    const dashboard = await request(baseUrl, "GET", "/api/company/dashboard", { cookie: viewerCookie });
    assert.equal(dashboard.status, 200);
    assert.deepEqual(dashboard.data.recentActivity, []);

    const settings = await request(baseUrl, "PATCH", "/api/company", { cookie: viewerCookie, body: { country: "BE" } });
    assert.equal(settings.status, 403);
    const audit = await request(baseUrl, "GET", "/api/company/audit", { cookie: viewerCookie });
    assert.equal(audit.status, 403);
    const reports = await request(baseUrl, "GET", "/api/company/reports", { cookie: viewerCookie });
    assert.equal(reports.status, 403);
  });

  await t.test("product manager mag rapportages zien, maar geen audit of instellingen", async () => {
    const reports = await request(baseUrl, "GET", "/api/company/reports", { cookie: managerCookie });
    assert.equal(reports.status, 200);
    const audit = await request(baseUrl, "GET", "/api/company/audit", { cookie: managerCookie });
    assert.equal(audit.status, 403);
    const settings = await request(baseUrl, "PATCH", "/api/company", { cookie: managerCookie, body: { country: "BE" } });
    assert.equal(settings.status, 403);
    const dashboard = await request(baseUrl, "GET", "/api/company/dashboard", { cookie: managerCookie });
    assert.deepEqual(dashboard.data.recentActivity, []);
  });

  await t.test("rapportages: per status, per categorie, scans per dag, top en incompleet", async () => {
    const res = await request(baseUrl, "GET", "/api/company/reports", { cookie: adminCookie });
    assert.equal(res.status, 200);
    const data = res.data;

    assert.deepEqual(data.productsByStatus, [
      { status: "draft", count: 2 },
      { status: "review", count: 1 },
      { status: "published", count: 1 },
      { status: "archived", count: 1 }
    ]);

    const meubels = data.productsByCategory.find((row) => row.category === "Meubels");
    assert.equal(meubels.count, 3, "gearchiveerde producten tellen niet mee per categorie");
    assert.equal(data.productsByCategory.find((row) => row.category === "Lampen").count, 1);

    assert.equal(data.scansByDay.length, 30);
    assert.match(data.scansByDay[0].date, /^\d{4}-\d{2}-\d{2}$/);
    const totalInSeries = data.scansByDay.reduce((sum, day) => sum + day.count, 0);
    assert.equal(totalInSeries, 5, "alleen scans van de eigen company in de laatste 30 dagen");
    assert.equal(data.scansByDay[data.scansByDay.length - 1].count, 2, "vandaag: 2 scans");

    assert.equal(data.topProducts[0].id, published);
    assert.equal(data.topProducts[0].scans, 5);
    assert.ok(!data.topProducts.some((row) => row.id === productB));

    const incompleteIds = data.incomplete.map((row) => row.id);
    assert.ok(incompleteIds.includes(incompleteDraft));
    assert.ok(incompleteIds.includes(reviewMissing));
    assert.ok(!incompleteIds.includes(completeDraft));
    assert.ok(!incompleteIds.includes(published));
    assert.ok(!incompleteIds.includes(archived), "gearchiveerd telt niet als incompleet");
    assert.deepEqual(data.incomplete.find((row) => row.id === reviewMissing).missing, ["materials"]);
    assert.deepEqual(data.incomplete.find((row) => row.id === incompleteDraft).missing, [
      "sku",
      "manufacturer",
      "model",
      "materials",
      "countryOfOrigin"
    ]);
  });

  await t.test("company admin werkt adres/land/contact bij; audit 'update' zonder waarden", async () => {
    const res = await request(baseUrl, "PATCH", "/api/company", {
      cookie: adminCookie,
      body: { address: "Straat 1, Utrecht", country: "NL", contactName: "Jan", contactEmail: "Contact@Example.com" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.address, "Straat 1, Utrecht");
    assert.equal(res.data.country, "NL");
    assert.equal(res.data.contact_name, "Jan");
    assert.equal(res.data.contact_email, "contact@example.com");

    const audit = await pool
      .request()
      .input("companyId", sql.Int, companyA)
      .query(`
        SELECT TOP 1 user_id, metadata FROM dbo.AuditLogs
        WHERE company_id = @companyId AND entity_type = 'Company' AND action = 'update'
        ORDER BY id DESC
      `);
    assert.equal(audit.recordset[0].user_id, adminA.id);
    const metadata = JSON.parse(audit.recordset[0].metadata);
    assert.deepEqual(metadata.fields.sort(), ["address", "contactEmail", "contactName", "country"]);
    assert.ok(!audit.recordset[0].metadata.includes("Utrecht"));

    const clear = await request(baseUrl, "PATCH", "/api/company", { cookie: adminCookie, body: { contactName: "" } });
    assert.equal(clear.status, 200);
    assert.equal(clear.data.contact_name, null);

    const invalid = await request(baseUrl, "PATCH", "/api/company", {
      cookie: adminCookie,
      body: { contactEmail: "geen-email" }
    });
    assert.equal(invalid.status, 400);
  });

  await t.test("PATCH /api/company kan naam, plan, maxUsers en status niet wijzigen", async () => {
    const before = (
      await pool
        .request()
        .input("id", sql.Int, companyA)
        .query("SELECT name, plan_id, max_users, status, kvk_number, country FROM dbo.Companies WHERE id = @id")
    ).recordset[0];

    for (const body of [
      { name: "Nieuwe naam" },
      { planId: null },
      { maxUsers: 999 },
      { status: "archived" },
      { kvkNumber: "99999999" },
      { country: "BE", name: "Stiekem ook de naam" }
    ]) {
      const res = await request(baseUrl, "PATCH", "/api/company", { cookie: adminCookie, body });
      assert.equal(res.status, 400, `body ${JSON.stringify(body)} moet geweigerd worden`);
    }

    const after = (
      await pool
        .request()
        .input("id", sql.Int, companyA)
        .query("SELECT name, plan_id, max_users, status, kvk_number, country FROM dbo.Companies WHERE id = @id")
    ).recordset[0];
    assert.deepEqual(after, before, "er is niets (half) opgeslagen");
  });

  await t.test("audit: alleen eigen company, met paginering en actiefilter", async () => {
    const res = await request(baseUrl, "GET", "/api/company/audit?limit=2&offset=0", { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.items.length, 2);
    assert.ok(res.data.total >= 4);

    const all = await request(baseUrl, "GET", "/api/company/audit?limit=200", { cookie: adminCookie });
    assert.equal(all.data.items.length, all.data.total);
    const isProductB = (item) => item.entity_type === "Product" && item.entity_id === String(productB);
    assert.ok(!all.data.items.some(isProductB));

    const filtered = await request(baseUrl, "GET", "/api/company/audit?action=plan_change", { cookie: adminCookie });
    assert.equal(filtered.status, 200);
    assert.ok(filtered.data.items.length >= 1);
    assert.ok(filtered.data.items.every((item) => item.action === "plan_change"));

    const bad = await request(baseUrl, "GET", "/api/company/audit?limit=abc", { cookie: adminCookie });
    assert.equal(bad.status, 400);
    const injection = await request(baseUrl, "GET", "/api/company/audit?action=x'%20OR%201=1--", { cookie: adminCookie });
    assert.equal(injection.status, 400);

    // Een companyId in de query verandert de scope niet.
    const otherScope = await request(baseUrl, "GET", `/api/company/audit?companyId=${companyB}`, { cookie: adminCookie });
    assert.ok(!otherScope.data.items.some(isProductB));

    const bRes = await request(baseUrl, "GET", "/api/company/audit", { cookie: adminBCookie });
    assert.ok(bRes.data.items.some(isProductB));
    assert.ok(!bRes.data.items.some((item) => item.entity_type === "Product" && item.entity_id === String(published)));
  });
});
