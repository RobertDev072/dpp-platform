const test = require("node:test");
const assert = require("node:assert/strict");

// Cloudflare vóór het QR-domein: gebundelde scans via /api/edge/sync, de wachtrij voor het
// verversen van de cache na wijzigingen en intrekkingen, en het echte bezoekers-IP via
// CF-Connecting-IP (alleen met de geheime header). Zonder Cloudflare: alles lokaal.
const TOKEN = "test-edge-token-0123456789abcdefghijklmnopqrstuv";
process.env.EDGE_SYNC_TOKEN = TOKEN;
process.env.PUBLIC_RATE_LIMIT_PER_MINUTE = "3";

const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const edgeCache = require("../src/services/edgeCache.service");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

async function sync(baseUrl, body, token = TOKEN) {
  const response = await fetch(`${baseUrl}/api/edge/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: response.status === 200 ? await response.json() : null };
}

async function scanCount(productId) {
  const pool = await getPool();
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM dbo.scanevents WHERE product_id = $1", [productId]);
  return rows[0].n;
}

// Alle openstaande purges ophalen en bevestigen; geeft de paden terug.
async function drainPurges(baseUrl) {
  const paths = [];
  let ack = 0;
  for (;;) {
    const { data } = await sync(baseUrl, { ack });
    paths.push(...data.purge.paths);
    if (data.purge.purgeId === ack) return paths;
    ack = data.purge.purgeId;
  }
}

test("Cloudflare-rand: gebundelde scans, cache verversen, echt bezoekers-IP", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("Edge Cache");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const product = await createTestProduct({ companyId: company, name: "Edge Product" });
  const draft = await createTestProduct({ companyId: company, name: "Edge Concept" });

  t.after(async () => {
    const pool = await getPool();
    await pool.query("DELETE FROM dbo.edgecachepurges");
    await cleanupTestData({ companyIds: [company], userIds: [admin.id], productIds: [product, draft] });
    await stopTestServer(server);
    await sql.close();
  });

  const cookie = await login(baseUrl, admin);
  const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie });
  assert.equal(published.status, 200);
  const publicId = String(published.data.public_id).toLowerCase();
  await drainPurges(baseUrl);

  await t.test("sync zonder of met fout token bestaat niet (404)", async () => {
    assert.equal((await sync(baseUrl, {}, null)).status, 404);
    assert.equal((await sync(baseUrl, {}, `${TOKEN}x`)).status, 404);
    assert.equal((await sync(baseUrl, {}, "kort")).status, 404);
  });

  await t.test("gebundelde scans: één verzoek, alleen openbare paspoorten tellen, tijdstip van de scan", async () => {
    const before = await scanCount(product);
    const at = Date.now() - 30_000;
    const res = await sync(baseUrl, {
      events: [
        { publicId, ts: at, userAgent: "Mozilla/5.0 (iPhone)", referrer: null },
        { publicId: publicId.toUpperCase(), ts: at + 1000, userAgent: null, referrer: "https://example.com/" },
        { publicId: "00000000-0000-4000-8000-000000000000", ts: at, userAgent: null, referrer: null }
      ]
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.recorded, 2, "onbekende id telt niet");
    assert.equal(await scanCount(product), before + 2);
    const pool = await getPool();
    const { rows } = await pool.query("SELECT MIN(scanned_at) AS first FROM dbo.scanevents WHERE product_id = $1", [product]);
    assert.ok(Math.abs(new Date(rows[0].first).getTime() - at) < 1000, "scanned_at = tijdstip van de scan, niet van de bundel");
  });

  await t.test("ongeldige bundel wordt geweigerd (400), te groot ook", async () => {
    assert.equal((await sync(baseUrl, { events: [{ publicId: "geen-uuid", ts: Date.now() }] })).status, 400);
    const many = Array.from({ length: 501 }, () => ({ publicId, ts: Date.now() }));
    assert.equal((await sync(baseUrl, { events: many })).status, 400);
  });

  await t.test("terugvaloptie: POST /api/scan/:publicId telt direct (als de Worker niet draait)", async () => {
    const before = await scanCount(product);
    // Zoals een browser op de paspoortpagina de beacon stuurt (docs/scans.md).
    const browser = { "User-Agent": "Mozilla/5.0 (iPhone) Safari/604.1", "Sec-Fetch-Site": "same-origin" };
    const res = await fetch(`${baseUrl}/api/scan/${publicId}`, { method: "POST", headers: browser });
    assert.equal(res.status, 204);
    assert.equal(await scanCount(product), before + 1);
    // Zonder browserheader (script) telt het niet.
    await fetch(`${baseUrl}/api/scan/${publicId}`, { method: "POST", headers: { "User-Agent": "Mozilla/5.0 (Android) Chrome" } });
    assert.equal(await scanCount(product), before + 1);
    assert.equal((await fetch(`${baseUrl}/api/scan/00000000-0000-4000-8000-000000000000`, { method: "POST" })).status, 404);
  });

  await t.test("wijziging van een openbaar paspoort: cache verversen (hoofd- en kleine letters)", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Nieuwe tekst" } });
    const paths = await drainPurges(baseUrl);
    assert.deepEqual(paths.sort(), [`/p/${publicId.toUpperCase()}`, `/p/${publicId}`].sort());
  });

  await t.test("geen inhoudelijke wijziging: geen purge; bevestigde purges komen niet terug", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Nieuwe tekst" } });
    assert.deepEqual(await drainPurges(baseUrl), []);
  });

  await t.test("intrekking (archiveren): cache verversen, pagina toont daarna de melding", async () => {
    const res = await request(baseUrl, "DELETE", `/api/products/${product}`, { cookie });
    assert.ok(res.status === 200 || res.status === 204, `archiveren (status ${res.status})`);
    const paths = await drainPurges(baseUrl);
    assert.ok(paths.includes(`/p/${publicId}`), "ingetrokken paspoort uit de cache");
  });

  await t.test("concept dat nooit openbaar was: geen purge", async () => {
    await request(baseUrl, "PATCH", `/api/products/${draft}`, { cookie, body: { description: "Concept" } });
    assert.deepEqual(await drainPurges(baseUrl), []);
  });

  await t.test("bedrijfsnaam of logo gewijzigd: alle ooit openbare paspoorten van het bedrijf", async () => {
    const res = await request(baseUrl, "PATCH", "/api/company", { cookie, body: { name: "Edge Cache Nieuw" } });
    assert.equal(res.status, 200);
    const paths = await drainPurges(baseUrl);
    assert.ok(paths.includes(`/p/${publicId}`));
    assert.equal(paths.length, 2, "alleen het (ooit) gepubliceerde product, niet het concept");
  });

  await t.test("bezoekers-IP: CF-Connecting-IP alleen met de geheime header", async () => {
    // Testserver = loopback (niet gelimiteerd). Met geldige header telt het Cloudflare-IP:
    // limiet 3 per minuut per bezoeker, andere bezoekers hebben een eigen teller.
    const scan = (headers) => fetch(`${baseUrl}/api/scan/${publicId}`, { method: "POST", headers }).then((r) => r.status);
    const visitorA = { "X-Edge-Verify": TOKEN, "CF-Connecting-IP": "203.0.113.10" };
    for (let i = 0; i < 3; i++) assert.equal(await scan(visitorA), 204);
    assert.equal(await scan(visitorA), 429, "bezoeker A geremd");
    assert.equal(await scan({ "X-Edge-Verify": TOKEN, "CF-Connecting-IP": "203.0.113.11" }), 204, "bezoeker B niet");
    // Zonder (geldige) header wordt een verzonnen CF-Connecting-IP genegeerd.
    for (let i = 0; i < 5; i++) assert.equal(await scan({ "X-Edge-Verify": "fout", "CF-Connecting-IP": "203.0.113.12" }), 204);
  });

  await t.test("zonder EDGE_SYNC_TOKEN zet de app niets in de wachtrij", async () => {
    delete process.env.EDGE_SYNC_TOKEN;
    try {
      assert.equal(await edgeCache.queuePurge([publicId]), 0);
    } finally {
      process.env.EDGE_SYNC_TOKEN = TOKEN;
    }
    assert.deepEqual(await drainPurges(baseUrl), []);
  });
});
