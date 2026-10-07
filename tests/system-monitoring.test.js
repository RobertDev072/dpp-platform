const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const requestMetrics = require("../src/monitoring/requestMetrics");

// Monitoring is exclusief voor de Platform Owner: elke rol daaronder krijgt 403,
// anoniem 401, en de publieke healthcheck geeft alleen "OK" zonder details.
// Plus: sanity-checks op de telemetrie zelf (routepatronen, sanitizing, geen secrets).

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

const MONITOR_PATHS = [
  "/api/admin/system/health",
  "/api/admin/system/overview",
  "/api/admin/system/performance",
  "/api/admin/system/database",
  "/api/admin/system/growth",
  "/api/admin/system/storage",
  "/api/admin/system/usage",
  "/api/admin/system/errors",
  "/api/admin/system/infra"
];

function assertNoSensitiveKeys(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSensitiveKeys(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      assert.ok(
        !/secret|password|connection[_-]?string|token|cookie|authorization/i.test(key),
        `verdachte sleutel '${key}' op ${path}`
      );
      assertNoSensitiveKeys(v, `${path}.${key}`);
    }
  }
}

test("systeemmonitoring: alleen Platform Owner, publieke health kaal, geen secrets", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const partnerCo = await createTestCompany("Monitor Partner");
  const klantCo = await createTestCompany("Monitor Klant");
  await query("UPDATE companies SET kind = 'partner' WHERE id = $1", [partnerCo]);

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const partner = await createTestUser({ companyId: partnerCo, role: "partner_admin" });
  const admin = await createTestUser({ companyId: klantCo, role: "company_admin" });
  const medewerker = await createTestUser({ companyId: klantCo, role: "company_user" });

  const snapshotIds = [];

  t.after(async () => {
    if (snapshotIds.length) {
      await query(`DELETE FROM system_metrics_snapshots WHERE id IN (${snapshotIds.join(",")})`);
    }
    await cleanupTestData({
      companyIds: [partnerCo, klantCo],
      userIds: [owner.id, partner.id, admin.id, medewerker.id]
    });
    await stopTestServer(server);
    await closePool();
  });

  await t.test("anonieme aanvraag krijgt 401 op alle monitoringroutes", async () => {
    for (const path of MONITOR_PATHS) {
      const res = await request(baseUrl, "GET", path, {});
      assert.equal(res.status, 401, `${path} zonder sessie hoort 401 te geven, kreeg ${res.status}`);
    }
  });

  await t.test("Partner Admin, Bedrijfsbeheerder en Medewerker krijgen overal 403", async () => {
    for (const user of [partner, admin, medewerker]) {
      const cookie = await login(baseUrl, user);
      for (const path of MONITOR_PATHS) {
        const res = await request(baseUrl, "GET", path, { cookie });
        assert.equal(res.status, 403, `${user.role} op ${path}: verwacht 403, kreeg ${res.status}`);
      }
      const snapshot = await request(baseUrl, "POST", "/api/admin/system/snapshot", { cookie });
      assert.equal(snapshot.status, 403);
    }
  });

  await t.test("Platform Owner krijgt overal 200 en de responses bevatten geen gevoelige sleutels", async () => {
    const cookie = await login(baseUrl, owner);
    for (const path of MONITOR_PATHS) {
      const res = await request(baseUrl, "GET", path, { cookie });
      assert.equal(res.status, 200, `${path}: verwacht 200, kreeg ${res.status}`);
      assertNoSensitiveKeys(res.data, path);
    }
  });

  await t.test("overview en performance leveren bruikbare, actuele telemetrie", async () => {
    const cookie = await login(baseUrl, owner);

    const overview = await request(baseUrl, "GET", "/api/admin/system/overview", { cookie });
    assert.equal(overview.status, 200);
    assert.ok(["ok", "degraded", "down"].includes(overview.data.health.overall));
    assert.equal(overview.data.health.components.email.status, "not_configured");
    assert.ok(overview.data.kpis.databaseBytes > 0);
    assert.ok(overview.data.kpis.requestsToday >= 1, "eigen requests horen geteld te zijn");

    const perf = await request(baseUrl, "GET", "/api/admin/system/performance?period=1h", { cookie });
    assert.equal(perf.status, 200);
    assert.equal(perf.data.series.length, 60);
    const loginRoute = perf.data.slowest
      .concat(perf.data.fastest)
      .find((e) => e.route.includes("/api/auth/login"));
    assert.ok(perf.data.liveHour.api.count >= 1);
    // Routepatronen bevatten nooit concrete id's.
    for (const e of perf.data.slowest) {
      assert.ok(!/\/\d+/.test(e.route), `route ${e.route} bevat een concreet id`);
    }
    assert.ok(loginRoute || perf.data.liveHour.api.count > 0);
  });

  await t.test("handmatige snapshot werkt voor de owner en database-info toont capaciteit", async () => {
    const cookie = await login(baseUrl, owner);

    const voor = await query("SELECT MAX(id) AS m FROM system_metrics_snapshots");
    const res = await request(baseUrl, "POST", "/api/admin/system/snapshot", { cookie });
    assert.equal(res.status, 201);
    const na = await query("SELECT MAX(id) AS m FROM system_metrics_snapshots");
    assert.ok(na.rows[0].m > (voor.rows[0].m || 0));
    snapshotIds.push(na.rows[0].m);

    const db = await request(baseUrl, "GET", "/api/admin/system/database", { cookie });
    assert.equal(db.status, 200);
    assert.ok(db.data.sizeBytes > 0);
    // Supabase kent geen harde maximale databasegrootte; alleen als
    // SUPABASE_DB_MAX_BYTES (plan-quotum) gezet is, is er een capaciteit.
    if (db.data.maxBytes != null) {
      assert.ok(db.data.maxBytes > db.data.sizeBytes);
      assert.ok(db.data.usedPct >= 0);
    }
    assert.ok(Array.isArray(db.data.tables) && db.data.tables.length > 0);
  });

  await t.test("publieke health geeft alleen OK, zonder details en zonder auth", async () => {
    const res = await request(baseUrl, "GET", "/api/health", {});
    assert.equal(res.status, 200);
    assert.equal(res.data, "OK");
  });

  await t.test("telemetrie normaliseert routes en saneert foutmeldingen", () => {
    assert.equal(requestMetrics.normalizePath("/api/products/123/documents/45?x=1"), "/api/products/:id/documents/:id");
    assert.equal(
      requestMetrics.normalizePath("/p/67937C90-1234-4ABC-9DEF-112233445566"),
      "/p/:guid"
    );
    assert.ok(requestMetrics.normalizePath("/activate?token=abc").indexOf("token=") === -1);
    const sanitized = requestMetrics.sanitizeErrorMessage(
      "Fout met Bearer abcdef1234567890abcdef1234567890abcdef1234567890 en meer\nstack..."
    );
    assert.ok(!sanitized.includes("abcdef1234567890"));
    assert.ok(!sanitized.includes("stack"));
  });
});
