const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

function suffix() {
  return crypto.randomBytes(4).toString("hex");
}

async function auditRows(pool, { companyId, action, entityType = "Company" }) {
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("action", sql.NVarChar(100), action)
    .input("entityType", sql.NVarChar(50), entityType)
    .query(`
      SELECT metadata FROM dbo.AuditLogs
      WHERE (company_id = @companyId OR @companyId IS NULL) AND action = @action AND entity_type = @entityType
      ORDER BY id
    `);
  return result.recordset.map((row) => (row.metadata ? JSON.parse(row.metadata) : null));
}

// Referentietelling rechtstreeks uit de DB: alleen source 'qr' is een QR-scan (§8).
async function qrScanCounts(pool) {
  const result = await pool.request().query(`
    SELECT COUNT_BIG(*) AS total,
           COALESCE(SUM(CASE WHEN scanned_at >= DATEADD(DAY, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END), 0) AS last30
    FROM dbo.ScanEvents
    WHERE source = 'qr'
  `);
  const [row] = result.recordset;
  return { total: Number(row.total), last30Days: Number(row.last30) };
}

// De scantelling is platformbreed en andere testbestanden voegen parallel scans toe of ruimen
// ze op. Een delta vóór/na zou daardoor flaky zijn; daarom vergelijken we binnen een "stil"
// venster: dezelfde telling vlak vóór en na het stats-verzoek, anders opnieuw proberen.
async function statsInQuietWindow(pool, baseUrl, cookie) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await qrScanCounts(pool);
    const res = await request(baseUrl, "GET", "/api/admin/stats", { cookie });
    assert.equal(res.status, 200);
    const after = await qrScanCounts(pool);
    if (before.total === after.total && before.last30Days === after.last30Days) {
      return { scans: res.data.scans, expected: after };
    }
    await delay(50);
  }
  throw new Error("scantelling bleef veranderen door parallelle tests");
}

test("platformbeheer: bedrijven, plannen, statistieken, instellingen en audit", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();

  const existingCompany = await createTestCompany("Platform Co");
  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminX = await createTestUser({ companyId: existingCompany, role: "company_admin" });
  const viewerX = await createTestUser({ companyId: existingCompany, role: "viewer" });

  const companyIds = [existingCompany];
  const planIds = [];

  t.after(async () => {
    // Producten van deze companies ruimt cleanupTestData zelf op.
    await cleanupTestData({ companyIds, userIds: [owner.id, adminX.id, viewerX.id] });
    for (const id of planIds.map(Number).filter(Number.isInteger)) {
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Plans WHERE id = @id");
    }
    await stopTestServer(server);
    await sql.close();
  });

  // Bewust met public_id: UQ_Products_PublicId (001_init.sql) is een gewone UNIQUE constraint
  // en staat in SQL Server maar één NULL toe. Een draft zonder public_id zou botsen met
  // gelijktijdig draaiende testbestanden die ook een draft-product hebben.
  await pool
    .request()
    .input("companyId", sql.Int, existingCompany)
    .input("name", sql.NVarChar(200), `Platform Product ${suffix()}`)
    .query(`
      INSERT INTO dbo.Products (company_id, name, status, public_id)
      VALUES (@companyId, @name, 'draft', NEWID())
    `);

  let ownerCookie;
  let adminCookie;
  let viewerCookie;

  await t.test("setup: testgebruikers kunnen inloggen", async () => {
    ownerCookie = await login(baseUrl, owner);
    adminCookie = await login(baseUrl, adminX);
    viewerCookie = await login(baseUrl, viewerX);
  });

  const planName = `Platform Plan ${suffix()}`;
  let planId;
  let planB;

  await t.test("plannen: aanmaken, dubbele naam, validatie", async () => {
    const res = await request(baseUrl, "POST", "/api/admin/plans", {
      cookie: ownerCookie,
      body: { name: planName, description: "Voor tests", maxUsers: 3, maxProducts: 25 }
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    planId = res.data.id;
    planIds.push(planId);
    assert.equal(res.data.name, planName);
    assert.equal(res.data.max_users, 3);
    assert.equal(res.data.max_products, 25);
    assert.equal(res.data.is_active, true);
    assert.equal(res.data.company_count, 0);

    const duplicate = await request(baseUrl, "POST", "/api/admin/plans", {
      cookie: ownerCookie,
      body: { name: planName.toUpperCase(), maxUsers: 1, maxProducts: 1 }
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.error.code, "PLAN_NAME_IN_USE");

    const invalid = await request(baseUrl, "POST", "/api/admin/plans", {
      cookie: ownerCookie,
      body: { name: `Ongeldig ${suffix()}`, maxUsers: -1, maxProducts: 1.5 }
    });
    assert.equal(invalid.status, 400);

    const second = await request(baseUrl, "POST", "/api/admin/plans", {
      cookie: ownerCookie,
      body: { name: `Platform Plan B ${suffix()}`, maxUsers: 10, maxProducts: 100, isActive: false }
    });
    assert.equal(second.status, 201);
    assert.equal(second.data.is_active, false);
    planB = second.data.id;
    planIds.push(planB);

    const created = await auditRows(pool, { companyId: null, action: "create", entityType: "Plan" });
    assert.ok(created.some((m) => m && m.name === planName));
  });

  await t.test("plannen: wijzigen met audit, 404 voor onbekend id, geen DELETE", async () => {
    const res = await request(baseUrl, "PATCH", `/api/admin/plans/${planId}`, {
      cookie: ownerCookie,
      body: { maxUsers: 4, description: "" }
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.max_users, 4);
    assert.equal(res.data.description, null);

    const updates = await auditRows(pool, { companyId: null, action: "update", entityType: "Plan" });
    assert.ok(updates.some((m) => m && m.changes && m.changes.maxUsers && m.changes.maxUsers.from === 3 && m.changes.maxUsers.to === 4));

    assert.equal((await request(baseUrl, "PATCH", "/api/admin/plans/999999999", { cookie: ownerCookie, body: { maxUsers: 1 } })).status, 404);
    assert.equal((await request(baseUrl, "PATCH", "/api/admin/plans/abc", { cookie: ownerCookie, body: { maxUsers: 1 } })).status, 404);
    assert.equal((await request(baseUrl, "PATCH", `/api/admin/plans/${planId}`, { cookie: ownerCookie, body: {} })).status, 400);
    assert.equal((await request(baseUrl, "DELETE", `/api/admin/plans/${planId}`, { cookie: ownerCookie })).status, 404);

    const list = await request(baseUrl, "GET", "/api/admin/plans", { cookie: ownerCookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.some((p) => p.id === planId && typeof p.company_count === "number"));
  });

  let companyId;
  const companyName = `Groene Fietsen ${suffix()} B.V.`;

  await t.test("bedrijf aanmaken met alle velden; slug wordt afgeleid van de naam", async () => {
    const res = await request(baseUrl, "POST", "/api/admin/companies", {
      cookie: ownerCookie,
      body: {
        name: companyName,
        kvkNumber: "12345678",
        country: "Nederland",
        address: "Fietsstraat 1, Utrecht",
        contactName: "Fien Fiets",
        contactEmail: "fien@example.com",
        planId
      }
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    companyId = res.data.id;
    companyIds.push(companyId);

    assert.match(res.data.slug, /^groene-fietsen-[a-z0-9]+-b-v$/);
    assert.equal(res.data.kvk_number, "12345678");
    assert.equal(res.data.country, "Nederland");
    assert.equal(res.data.address, "Fietsstraat 1, Utrecht");
    assert.equal(res.data.contact_name, "Fien Fiets");
    assert.equal(res.data.contact_email, "fien@example.com");
    assert.equal(res.data.plan_id, planId);
    assert.equal(res.data.plan_name, planName);
    assert.equal(res.data.max_users, null);
    assert.equal(res.data.effective_max_users, 4);
    assert.equal(res.data.status, "active");

    // Zelfde naam nogmaals: nieuwe, unieke slug in plaats van een 409.
    const again = await request(baseUrl, "POST", "/api/admin/companies", { cookie: ownerCookie, body: { name: companyName } });
    assert.equal(again.status, 201);
    companyIds.push(again.data.id);
    assert.equal(again.data.slug, `${res.data.slug}-2`);

    // Expliciet gekozen, bezette slug blijft een 409.
    const explicit = await request(baseUrl, "POST", "/api/admin/companies", {
      cookie: ownerCookie,
      body: { name: "Andere naam", slug: res.data.slug }
    });
    assert.equal(explicit.status, 409);
  });

  await t.test("bedrijf aanmaken: validatie van plan, e-mail, maxUsers en status", async () => {
    const unknownPlan = await request(baseUrl, "POST", "/api/admin/companies", {
      cookie: ownerCookie,
      body: { name: `Zonder plan ${suffix()}`, planId: 999999999 }
    });
    assert.equal(unknownPlan.status, 400);
    assert.equal(unknownPlan.data.error.code, "PLAN_NOT_FOUND");

    for (const body of [
      { name: "x", contactEmail: "geen-email" },
      { name: "x", maxUsers: -1 },
      { name: "x", status: "verwijderd" },
      { name: "" },
      { name: "x", slug: "Geen Geldige Slug" }
    ]) {
      const res = await request(baseUrl, "POST", "/api/admin/companies", { cookie: ownerCookie, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  await t.test("bedrijvenlijst bevat plan, seats en tellingen", async () => {
    await pool.request().input("id", sql.Int, existingCompany).input("planId", sql.Int, planId).query(
      "UPDATE dbo.Companies SET plan_id = @planId WHERE id = @id"
    );

    const res = await request(baseUrl, "GET", "/api/admin/companies", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const row = res.data.find((c) => c.id === existingCompany);
    assert.ok(row);
    assert.equal(row.plan_name, planName);
    assert.equal(row.max_users, null);
    assert.equal(row.effective_max_users, 4);
    assert.equal(row.active_users, 2);
    assert.equal(row.admin_count, 1);
    assert.equal(row.product_count, 1);
    assert.equal(row.pending_invitations, 0);

    const plans = await request(baseUrl, "GET", "/api/admin/plans", { cookie: ownerCookie });
    assert.equal(plans.data.find((p) => p.id === planId).company_count, 2);
  });

  await t.test("bedrijfsdetail bevat seats, admins en invitations", async () => {
    const invite = await request(baseUrl, "POST", `/api/admin/companies/${existingCompany}/invitations`, {
      cookie: ownerCookie,
      body: { email: `detail-${suffix()}@example.com` }
    });
    assert.equal(invite.status, 201);

    const res = await request(baseUrl, "GET", `/api/admin/companies/${existingCompany}`, { cookie: ownerCookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.seats, {
      planId,
      planName,
      maxUsers: 4,
      activeUsers: 2,
      remainingSeats: 2
    });
    assert.equal(res.data.admins.length, 1);
    assert.deepEqual(Object.keys(res.data.admins[0]).sort(), ["email", "first_name", "id", "last_login_at", "last_name", "status"]);
    assert.equal(res.data.admins[0].email, adminX.email);
    assert.ok(res.data.admins[0].last_login_at, "last_login_at gezet na login");
    assert.equal(res.data.invitations.length, 1);
    assert.equal(res.data.invitations[0].status, "pending");
    assert.equal(res.data.invitations[0].token_hash, undefined);

    const list = await request(baseUrl, "GET", "/api/admin/companies", { cookie: ownerCookie });
    assert.equal(list.data.find((c) => c.id === existingCompany).pending_invitations, 1);

    assert.equal((await request(baseUrl, "GET", "/api/admin/companies/999999999", { cookie: ownerCookie })).status, 404);
    assert.equal((await request(baseUrl, "GET", "/api/admin/companies/abc", { cookie: ownerCookie })).status, 404);
    assert.equal((await request(baseUrl, "GET", "/api/admin/companies/-1", { cookie: ownerCookie })).status, 404);
  });

  await t.test("PATCH: plan- en seatwijziging krijgen eigen audit-acties", async () => {
    const res = await request(baseUrl, "PATCH", `/api/admin/companies/${companyId}`, {
      cookie: ownerCookie,
      body: { planId: planB, maxUsers: 7, contactName: "Frits Fiets", address: "" }
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.plan_id, planB);
    assert.equal(res.data.max_users, 7);
    assert.equal(res.data.effective_max_users, 7, "override gaat vóór het plan");
    assert.equal(res.data.contact_name, "Frits Fiets");
    assert.equal(res.data.address, null);

    assert.deepEqual(await auditRows(pool, { companyId, action: "plan_change" }), [{ from: planId, to: planB }]);
    assert.deepEqual(await auditRows(pool, { companyId, action: "seat_limit_change" }), [{ from: null, to: 7 }]);
    const updates = await auditRows(pool, { companyId, action: "update" });
    assert.deepEqual(updates, [{ fields: ["address", "contactName"] }]);
    assert.ok(!JSON.stringify(updates).includes("Frits"), "geen contactgegevens in de audit log");

    const reset = await request(baseUrl, "PATCH", `/api/admin/companies/${companyId}`, {
      cookie: ownerCookie,
      body: { maxUsers: null }
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.effective_max_users, 10, "terug naar de plan-limiet");

    const noop = await request(baseUrl, "PATCH", `/api/admin/companies/${companyId}`, {
      cookie: ownerCookie,
      body: { planId: planB }
    });
    assert.equal(noop.status, 200);
    assert.equal((await auditRows(pool, { companyId, action: "plan_change" })).length, 1, "geen audit zonder wijziging");

    const unknownPlan = await request(baseUrl, "PATCH", `/api/admin/companies/${companyId}`, {
      cookie: ownerCookie,
      body: { planId: 999999999 }
    });
    assert.equal(unknownPlan.status, 400);

    const empty = await request(baseUrl, "PATCH", `/api/admin/companies/${companyId}`, { cookie: ownerCookie, body: {} });
    assert.equal(empty.status, 400);

    const missing = await request(baseUrl, "PATCH", "/api/admin/companies/999999999", {
      cookie: ownerCookie,
      body: { name: "Bestaat niet" }
    });
    assert.equal(missing.status, 404);
  });

  await t.test("deactiveren blokkeert bestaande sessies van de gebruikers van dat bedrijf", async () => {
    const before = await request(baseUrl, "GET", "/api/auth/me", { cookie: adminCookie });
    assert.equal(before.status, 200);

    const res = await request(baseUrl, "PATCH", `/api/admin/companies/${existingCompany}`, {
      cookie: ownerCookie,
      body: { status: "suspended" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "suspended");
    assert.deepEqual(await auditRows(pool, { companyId: existingCompany, action: "deactivate" }), [
      { from: "active", to: "suspended" }
    ]);

    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie: adminCookie })).status, 401);
    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie: viewerCookie })).status, 401);

    // Docs §2: gebruikers van een niet-actieve company kunnen ook niet opnieuw inloggen.
    const loginWhileSuspended = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: adminX.email, password: adminX.password }
    });
    assert.equal(loginWhileSuspended.status, 401);

    const reactivate = await request(baseUrl, "PATCH", `/api/admin/companies/${existingCompany}`, {
      cookie: ownerCookie,
      body: { status: "active" }
    });
    assert.equal(reactivate.status, 200);
    assert.deepEqual(await auditRows(pool, { companyId: existingCompany, action: "activate" }), [
      { from: "suspended", to: "active" }
    ]);

    // Oude sessies blijven ingetrokken; opnieuw inloggen werkt wel.
    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie: adminCookie })).status, 401);
    adminCookie = await login(baseUrl, adminX);
    viewerCookie = await login(baseUrl, viewerX);
    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie: adminCookie })).status, 200);
  });

  await t.test("stats hebben de afgesproken vorm", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/stats", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    const s = res.data;
    const isCount = (value) => Number.isInteger(value) && value >= 0;

    assert.deepEqual(Object.keys(s).sort(), [
      "companies",
      "dpps",
      "invitations",
      "licenses",
      "products",
      "recentActivity",
      "recentCompanies",
      "scans",
      "users"
    ]);
    assert.ok(isCount(s.companies.total) && isCount(s.companies.active));
    assert.ok(s.companies.total >= 3);
    assert.ok(isCount(s.users.total) && isCount(s.users.active));
    assert.ok(isCount(s.licenses.activeLicenses) && isCount(s.licenses.totalSeats) && isCount(s.licenses.usedSeats));
    assert.ok(s.licenses.activeLicenses >= 2, "companies met plan tellen als licentie");
    for (const key of ["total", "draft", "review", "published", "archived"]) assert.ok(isCount(s.products[key]), key);
    assert.ok(s.products.total >= 1);
    assert.ok(isCount(s.dpps.published));
    assert.ok(isCount(s.scans.total) && isCount(s.scans.last30Days));
    assert.ok(isCount(s.invitations.pending) && s.invitations.pending >= 1);

    assert.ok(Array.isArray(s.recentCompanies) && s.recentCompanies.length <= 5);
    for (const c of s.recentCompanies) assert.deepEqual(Object.keys(c).sort(), ["created_at", "id", "name", "status"]);

    assert.ok(Array.isArray(s.recentActivity) && s.recentActivity.length >= 1 && s.recentActivity.length <= 10);
    for (const a of s.recentActivity) {
      assert.deepEqual(Object.keys(a).sort(), ["action", "actor_email", "company_name", "entity_id", "entity_type", "id", "timestamp"]);
      assert.equal(typeof a.id, "number");
    }
  });

  await t.test("stats: QR-scans tellen alleen source 'qr', geen webbezoeken of oude rijen", async () => {
    const scanCompany = await createTestCompany("Platform Scan Co");
    companyIds.push(scanCompany);
    const inserted = await pool
      .request()
      .input("companyId", sql.Int, scanCompany)
      .input("name", sql.NVarChar(200), `Scan Product ${suffix()}`)
      .query(`
        INSERT INTO dbo.Products (company_id, name, status, public_id, published_at)
        OUTPUT INSERTED.id, INSERTED.public_id
        VALUES (@companyId, @name, 'published', NEWID(), SYSUTCDATETIME())
      `);
    const productId = inserted.recordset[0].id;
    const publicId = String(inserted.recordset[0].public_id).toLowerCase();

    const sourcesOfProduct = async () => {
      const result = await pool
        .request()
        .input("productId", sql.Int, productId)
        .query("SELECT source FROM dbo.ScanEvents WHERE product_id = @productId ORDER BY id");
      return result.recordset.map((row) => row.source);
    };

    // Zonder ?src=qr: verversen, gedeelde link, voorvertoning "Publieke pagina" → source 'web'.
    for (const path of [
      `/api/public/dpp/${publicId}`,
      `/api/public/dpp/${publicId}`,
      `/api/public/dpp/${publicId}?src=web`
    ]) {
      assert.equal((await request(baseUrl, "GET", path)).status, 200, path);
    }
    // Rij van vóór migratie 004: geen source, dus niet als QR-scan te herkennen.
    await pool
      .request()
      .input("productId", sql.Int, productId)
      .query("INSERT INTO dbo.ScanEvents (product_id, source) VALUES (@productId, NULL)");
    assert.deepEqual(await sourcesOfProduct(), ["web", "web", "web", null]);

    // Met alleen deze vier niet-QR-rijen erbij moet de stats-telling gelijk blijven aan het
    // aantal qr-rijen; de oude query (alle rijen) zat er hier minstens 4 boven.
    const withoutQr = await statsInQuietWindow(pool, baseUrl, ownerCookie);
    assert.deepEqual(withoutQr.scans, withoutQr.expected);

    assert.equal((await request(baseUrl, "GET", `/api/public/dpp/${publicId}?src=qr`)).status, 200);
    assert.deepEqual(await sourcesOfProduct(), ["web", "web", "web", null, "qr"]);

    const withQr = await statsInQuietWindow(pool, baseUrl, ownerCookie);
    assert.deepEqual(withQr.scans, withQr.expected);
    assert.ok(withQr.scans.total >= 1 && withQr.scans.last30Days >= 1, "de QR-scan telt mee");
  });

  await t.test("settings tonen alleen configuratiestatus, geen secrets", async () => {
    const markers = {
      ENTRA_WEB_CLIENT_SECRET: `web-secret-${suffix()}`,
      ENTRA_GRAPH_CLIENT_SECRET: `graph-secret-${suffix()}`,
      ENTRA_WEB_CLIENT_ID: `web-client-${suffix()}`,
      ENTRA_TENANT_ID: `tenant-${suffix()}`
    };
    const saved = Object.fromEntries(Object.keys(markers).map((key) => [key, process.env[key]]));
    Object.assign(process.env, markers);

    let res;
    try {
      res = await request(baseUrl, "GET", "/api/admin/settings", { cookie: ownerCookie });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.data).sort(), [
      "entraGraphConfigured",
      "entraLoginConfigured",
      "inviteExpiryHours",
      "nodeEnv",
      "publicBaseUrl",
      "publicBaseUrlConfigured",
      "sessionHours",
      "trustProxy"
    ]);
    assert.equal(typeof res.data.entraLoginConfigured, "boolean");
    assert.equal(typeof res.data.entraGraphConfigured, "boolean");
    assert.equal(typeof res.data.publicBaseUrlConfigured, "boolean");
    assert.equal(typeof res.data.trustProxy, "boolean");
    assert.equal(res.data.sessionHours, 8);
    assert.equal(res.data.inviteExpiryHours, 72);
    assert.match(res.data.publicBaseUrl, /^https?:\/\//);

    const dump = JSON.stringify(res.data);
    for (const value of Object.values(markers)) assert.ok(!dump.includes(value), "geen secrets/ids in settings");
    for (const key of ["DB_PASSWORD", "COOKIE_SECRET", "DB_USER"]) {
      if (process.env[key]) assert.ok(!dump.includes(process.env[key]), `${key} lekt niet`);
    }
    assert.ok(!/secret|password|token|clientid|tenantid/i.test(Object.keys(res.data).join(",")));
  });

  await t.test("audit log: filters, paginering en geparste metadata", async () => {
    const filtered = await request(baseUrl, "GET", `/api/audit?companyId=${companyId}&action=plan_change`, {
      cookie: ownerCookie
    });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.total, 1);
    assert.equal(filtered.data.items.length, 1);
    const item = filtered.data.items[0];
    assert.deepEqual(Object.keys(item).sort(), [
      "action",
      "actor_email",
      "company_id",
      "company_name",
      "entity_id",
      "entity_type",
      "id",
      "metadata",
      "timestamp",
      "user_id"
    ]);
    assert.equal(item.company_id, companyId);
    assert.equal(item.company_name, companyName);
    assert.equal(item.actor_email, owner.email);
    assert.equal(item.user_id, owner.id);
    assert.deepEqual(item.metadata, { from: planId, to: planB });

    const byType = await request(baseUrl, "GET", "/api/audit?entityType=Plan&limit=500", { cookie: ownerCookie });
    assert.equal(byType.status, 200);
    assert.ok(byType.data.items.length >= 1 && byType.data.items.length <= 200, "limit wordt afgekapt op 200");
    assert.ok(byType.data.items.every((i) => i.entity_type === "Plan"));

    const page1 = await request(baseUrl, "GET", `/api/audit?companyId=${companyId}&limit=1`, { cookie: ownerCookie });
    const page2 = await request(baseUrl, "GET", `/api/audit?companyId=${companyId}&limit=1&offset=1`, { cookie: ownerCookie });
    assert.equal(page1.data.items.length, 1);
    assert.equal(page2.data.items.length, 1);
    assert.equal(page1.data.total, page2.data.total);
    assert.ok(page1.data.total >= 4);
    assert.notEqual(page1.data.items[0].id, page2.data.items[0].id);

    assert.equal((await request(baseUrl, "GET", "/api/audit?companyId=abc", { cookie: ownerCookie })).status, 400);
    assert.equal((await request(baseUrl, "GET", "/api/audit?limit=0", { cookie: ownerCookie })).status, 400);
    assert.equal((await request(baseUrl, "GET", "/api/audit?offset=-1", { cookie: ownerCookie })).status, 400);
  });

  await t.test("niet-System Owners krijgen overal 403; zonder login 401", async () => {
    const endpoints = [
      ["GET", "/api/admin/companies"],
      ["POST", "/api/admin/companies", { name: "Overname" }],
      ["GET", `/api/admin/companies/${existingCompany}`],
      ["PATCH", `/api/admin/companies/${existingCompany}`, { maxUsers: 1000 }],
      ["GET", `/api/admin/companies/${existingCompany}/invitations`],
      ["POST", `/api/admin/companies/${existingCompany}/invitations`, { email: `x-${suffix()}@example.com` }],
      ["GET", "/api/admin/invitations"],
      ["GET", "/api/admin/plans"],
      ["POST", "/api/admin/plans", { name: `Gratis ${suffix()}`, maxUsers: 1000, maxProducts: 1000 }],
      ["PATCH", `/api/admin/plans/${planId}`, { maxUsers: 1000 }],
      ["GET", "/api/admin/stats"],
      ["GET", "/api/admin/settings"],
      ["GET", "/api/audit"],
      ["GET", `/api/audit?companyId=${existingCompany}`]
    ];

    for (const cookie of [adminCookie, viewerCookie]) {
      for (const [method, path, body] of endpoints) {
        const res = await request(baseUrl, method, path, { cookie, body });
        assert.equal(res.status, 403, `${method} ${path} moet 403 geven`);
      }
    }
    for (const [method, path, body] of endpoints) {
      const res = await request(baseUrl, method, path, { body });
      assert.equal(res.status, 401, `${method} ${path} zonder login moet 401 geven`);
    }

    // De company is door geen van deze pogingen gewijzigd.
    const detail = await request(baseUrl, "GET", `/api/admin/companies/${existingCompany}`, { cookie: ownerCookie });
    assert.equal(detail.data.max_users, null);

    // Onbekende /api/admin-paden blijven een gewone 404 (stats-router doet auth per route).
    assert.equal((await request(baseUrl, "GET", "/api/admin/bestaat-niet")).status, 404);
  });
});
