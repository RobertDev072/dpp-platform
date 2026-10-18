const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const continuity = require("../src/services/dppContinuity.service");

// Back-up-DPP-dienstverlener (replicatie van alle versies) en EU-register
// (RegisterProductDPP), getest tegen een nep-dienstverlener op localhost.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

function fakeProvider() {
  const calls = [];
  let failNext = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (failNext > 0) {
        failNext -= 1;
        res.writeHead(503).end("down");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ registrationId: "EU-REG-1" }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}`, fail: (n) => (failNext = n) })
    )
  );
}

test("continuïteit: replicatie naar back-up-dienstverlener en EU-register", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const provider = await fakeProvider();
  const company = await createTestCompany("Continuiteit");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const product = await createTestProduct({ companyId: company, name: "Lamp Orbit" });

  t.after(async () => {
    delete process.env.BACKUP_DPP_PROVIDER_URL;
    delete process.env.BACKUP_DPP_PROVIDER_TOKEN;
    delete process.env.EU_DPP_REGISTRY_URL;
    provider.server.close();
    await cleanupTestData({ companyIds: [company], userIds: [admin.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const cookie = await login(baseUrl, admin);
  const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie });
  const dppId = String(published.data.public_id).toLowerCase();
  await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Versie twee" } });

  await t.test("uitgeschakeld zonder configuratie: niets verstuurd", async () => {
    assert.deepEqual(await continuity.replicateVersions(), { enabled: false });
    assert.deepEqual(await continuity.processRegistrations(), { enabled: false });
    assert.equal(provider.calls.length, 0);
  });

  await t.test("ingeschakeld: hele historie in volgorde, met hashes en token", async () => {
    process.env.BACKUP_DPP_PROVIDER_URL = `${provider.url}/backup/`;
    process.env.BACKUP_DPP_PROVIDER_TOKEN = "test-token";
    await continuity.replicateVersions({ limit: 500 });
    const mine = provider.calls.filter((c) => c.url.startsWith(`/backup/passports/${dppId}/`));
    assert.deepEqual(mine.map((c) => c.url), [`/backup/passports/${dppId}/versions/1`, `/backup/passports/${dppId}/versions/2`]);
    assert.equal(mine[0].method, "PUT");
    assert.equal(mine[0].auth, "Bearer test-token");
    assert.match(mine[1].body.chainSha256, /^[0-9a-f]{64}$/);
    assert.equal(mine[1].body.previousChainSha256, mine[0].body.chainSha256);
    assert.equal(mine[1].body.passport.digitalProductPassportId, `urn:uuid:${dppId}`);
    // Tweede ronde: niets nieuws.
    const before = provider.calls.length;
    await continuity.replicateVersions({ limit: 500 });
    assert.equal(provider.calls.filter((c) => c.url.includes(dppId)).length, mine.length);
    assert.ok(provider.calls.length >= before);
  });

  await t.test("storing bij de dienstverlener: later opnieuw, zonder versies over te slaan", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Versie drie" } });
    provider.fail(1);
    await continuity.replicateVersions({ limit: 500 });
    const state = (await pool.query("SELECT attempts, last_error, next_attempt_at FROM dbo.dppreplicationstate WHERE product_id = $1", [product])).rows[0];
    assert.equal(state.attempts, 1);
    assert.match(state.last_error, /503/);
    await pool.query("UPDATE dbo.dppreplicationstate SET next_attempt_at = now() - interval '1 minute' WHERE product_id = $1", [product]);
    await continuity.replicateVersions({ limit: 500 });
    const v3 = provider.calls.filter((c) => c.url === `/backup/passports/${dppId}/versions/3`);
    assert.equal(v3.length, 2, "eerst mislukt, daarna gelukt");
    const status = await continuity.replicationStatus();
    assert.equal(status.enabled, true);
  });

  await t.test("RegisterProductDPP: wachtrij zonder register, versturen zodra ingesteld", async () => {
    const queued = await request(baseUrl, "POST", `/api/products/${product}/register`, { cookie });
    assert.equal(queued.status, 202);
    assert.equal(queued.data.status, "queued");
    assert.equal(queued.data.registryConfigured, false);
    process.env.EU_DPP_REGISTRY_URL = `${provider.url}/eu`;
    const result = await continuity.processRegistrations();
    assert.equal(result.registered, 1);
    const call = provider.calls.find((c) => c.url === "/eu/registrations");
    assert.equal(call.body.digitalProductPassportId, `urn:uuid:${dppId}`);
    assert.ok(call.body.passportUrl.endsWith(`/p/${dppId.toUpperCase()}`));
    const reg = await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie });
    assert.equal(reg.data.status, "registered");
    assert.equal(reg.data.registry_reference, "EU-REG-1");
    // Opnieuw aanmelden laat een geregistreerd paspoort geregistreerd.
    assert.equal((await request(baseUrl, "POST", `/api/products/${product}/register`, { cookie })).data.status, "registered");
  });

  await t.test("alleen HTTPS-endpoints (behalve localhost)", async () => {
    process.env.BACKUP_DPP_PROVIDER_URL = "http://voorbeeld.nl";
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Versie vier" } });
    await pool.query("UPDATE dbo.dppreplicationstate SET next_attempt_at = NULL WHERE product_id = $1", [product]);
    await continuity.replicateVersions({ limit: 500 });
    const state = (await pool.query("SELECT last_error FROM dbo.dppreplicationstate WHERE product_id = $1", [product])).rows[0];
    assert.match(state.last_error, /HTTPS/);
  });
});
