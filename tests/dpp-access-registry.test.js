const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const registry = require("../src/services/registryRecord.service");

// Toegang per niveau tot machineleesbare paspoorten (publiek / professional / authority)
// en de registratiegegevens voor het EU DPP-register (UPI als https-URL, controles zoals
// het register ze doet, delen van max. 100, status vastleggen).

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

function dpp(baseUrl, publicId, token, path = "") {
  return fetch(`${baseUrl}/api/dpp/${publicId}${path}`, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: "manual"
  });
}

test("toegang per niveau en EU-registratiegegevens", async (t) => {
  const previousQrBase = process.env.QR_BASE_URL;
  process.env.QR_BASE_URL = "https://qr.example.test";
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const companyA = await createTestCompany("Toegang A");
  const companyB = await createTestCompany("Toegang B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const product = await createTestProduct({ companyId: companyA, name: "Accu Volta" });

  t.after(async () => {
    if (previousQrBase === undefined) delete process.env.QR_BASE_URL;
    else process.env.QR_BASE_URL = previousQrBase;
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id, userA.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieB = await login(baseUrl, adminB);
  const cookieUser = await login(baseUrl, userA);
  const gtin = "8712345678906";
  assert.equal((await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { gtin, model: "VOLTA-48" } })).status, 200);
  const docs = {};
  for (const [key, payload] of Object.entries({
    open: { isPublic: true },
    repair: { isPublic: false, accessLevel: "professional" },
    test: { isPublic: false, accessLevel: "authority" },
    intern: { isPublic: false }
  })) {
    const res = await request(baseUrl, "POST", `/api/products/${product}/documents`, {
      cookie: cookieA,
      body: { type: "pdf", title: `Doc ${key}`, storageUrl: `https://files.example.test/${key}.pdf`, ...payload }
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    docs[key] = res.data;
  }
  assert.equal(docs.repair.access_level, "professional");
  const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA });
  const publicId = String(published.data.public_id).toLowerCase();

  let professionalToken;
  let authorityToken;
  let tokenB;

  await t.test("tokens: alleen de bedrijfsbeheerder, token één keer zichtbaar", async () => {
    assert.equal((await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieUser, body: { name: "X", level: "professional" } })).status, 403);
    const pro = await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieA, body: { name: "Reparateur Jansen", level: "professional" } });
    assert.equal(pro.status, 201, JSON.stringify(pro.data));
    assert.match(pro.data.token, /^vpa_[a-z0-9]{8}_[A-Za-z0-9]{40}$/);
    professionalToken = pro.data.token;
    authorityToken = (await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieA, body: { name: "ILT", level: "authority" } })).data.token;
    tokenB = (await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieB, body: { name: "B", level: "authority" } })).data.token;
    const list = await request(baseUrl, "GET", "/api/company/access-tokens", { cookie: cookieA });
    assert.equal(list.data.length, 2);
    assert.ok(list.data.every((row) => row.token === undefined && !("token_hash" in row)), "geen token of hash in de lijst");
    // Altijd een vervaldatum: standaard 1 jaar, hooguit 2 jaar.
    const days = (new Date(pro.data.expires_at) - Date.now()) / 86400000;
    assert.ok(days > 364 && days < 366, `verloopt over ${days} dagen`);
    assert.equal((await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieA, body: { name: "X", level: "professional", expiresInDays: 731 } })).status, 400);
    assert.equal((await request(baseUrl, "POST", "/api/company/access-tokens", { cookie: cookieA, body: { name: "X", level: "professional", expiresInDays: null } })).status, 400);
  });

  const titles = (body) => body.documents.map((d) => d.title).sort();

  await t.test("publiek: alleen openbare documenten, gedeeld cachebaar", async () => {
    const res = await dpp(baseUrl, publicId);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accessLevel, "public");
    assert.deepEqual(titles(body), ["Doc open"]);
    assert.match(res.headers.get("cache-control"), /^public/);
    assert.match(res.headers.get("vary"), /Authorization/);
  });

  await t.test("professional ziet reparatiedocument, niet het autoriteitendocument; nooit gedeeld gecachet", async () => {
    const res = await dpp(baseUrl, publicId, professionalToken);
    const body = await res.json();
    assert.equal(body.accessLevel, "professional");
    assert.deepEqual(titles(body), ["Doc open", "Doc repair"]);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const repair = body.documents.find((d) => d.title === "Doc repair");
    assert.equal(repair.accessLevel, "professional");
    assert.ok(repair.url.includes(`/api/dpp/${publicId}/documents/${docs.repair.id}/file`));
  });

  await t.test("autoriteit ziet alle externe documenten, nooit de interne", async () => {
    const body = await (await dpp(baseUrl, publicId, authorityToken)).json();
    assert.equal(body.accessLevel, "authority");
    assert.deepEqual(titles(body), ["Doc open", "Doc repair", "Doc test"]);
  });

  await t.test("token van een ander bedrijf: publieke weergave; ongeldig token: 401", async () => {
    const body = await (await dpp(baseUrl, publicId, tokenB)).json();
    assert.equal(body.accessLevel, "public");
    assert.deepEqual(titles(body), ["Doc open"]);
    assert.equal((await dpp(baseUrl, publicId, `vpa_aaaaaaaa_${"a".repeat(40)}`)).status, 401);
    // Ook via de B2B-API: een vpa-token is geen ongeldige API-sleutel.
    const v1 = await fetch(`${baseUrl}/api/v1/dpp/${publicId}`, { headers: { Accept: "application/json", Authorization: `Bearer ${professionalToken}` } });
    assert.equal(v1.status, 200);
    assert.equal((await v1.json()).accessLevel, "professional");
  });

  await t.test("beperkt document downloaden: alleen met passend token", async () => {
    const path = `/documents/${docs.repair.id}/file`;
    assert.equal((await dpp(baseUrl, publicId, null, path)).status, 404);
    const ok = await dpp(baseUrl, publicId, professionalToken, path);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "https://files.example.test/repair.pdf");
    assert.equal((await dpp(baseUrl, publicId, professionalToken, `/documents/${docs.test.id}/file`)).status, 404);
    assert.equal((await dpp(baseUrl, publicId, authorityToken, `/documents/${docs.intern.id}/file`)).status, 404);
  });

  await t.test("logboek: wie wanneer wat opvroeg, alleen als het token meer gaf dan publiek", async () => {
    const list = await request(baseUrl, "GET", "/api/company/access-tokens", { cookie: cookieA });
    const pro = list.data.find((row) => row.access_level === "professional");
    let rows = [];
    for (let i = 0; i < 20 && rows.length < 2; i += 1) {
      rows = (await request(baseUrl, "GET", `/api/company/access-tokens/${pro.id}/log`, { cookie: cookieA })).data;
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
    }
    const kinds = rows.map((r) => r.resource);
    assert.ok(kinds.includes("passport") && kinds.includes("document"), JSON.stringify(rows));
    assert.ok(rows.every((r) => String(r.public_id).toLowerCase() === publicId));
    assert.ok(rows.every((r) => !("ip" in r) && !("user_agent" in r)), "geen IP of browser in het logboek");
    // Ander bedrijf ziet het logboek niet; token van B gaf alleen publiek → niets gelogd.
    assert.deepEqual((await request(baseUrl, "GET", `/api/company/access-tokens/${pro.id}/log`, { cookie: cookieB })).data, []);
    const ofB = (await pool.query("SELECT count(*) FROM dbo.dppaccesslog l JOIN dbo.dppaccesstokens t ON t.id = l.token_id WHERE t.company_id = $1", [companyB])).rows[0].count;
    assert.equal(Number(ofB), 0);
  });

  await t.test("ingetrokken token werkt niet meer", async () => {
    const list = await request(baseUrl, "GET", "/api/company/access-tokens", { cookie: cookieA });
    const pro = list.data.find((row) => row.access_level === "professional");
    assert.equal((await request(baseUrl, "DELETE", `/api/company/access-tokens/${pro.id}`, { cookie: cookieB })).status, 404);
    assert.equal((await request(baseUrl, "DELETE", `/api/company/access-tokens/${pro.id}`, { cookie: cookieA })).status, 200);
    assert.equal((await dpp(baseUrl, publicId, professionalToken)).status, 401);
  });

  await t.test("UPI: https-URL met de GTIN erin (GS1 Digital Link op het QR-domein)", async () => {
    const body = await (await dpp(baseUrl, publicId)).json();
    assert.equal(body.uniqueProductIdentifier, `https://qr.example.test/01/0${gtin}`);
    const reg = await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie: cookieA });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.status, "none");
    assert.deepEqual(
      { granularity: reg.data.record.granularity, upi: reg.data.record.upi, modelIdentifier: reg.data.record.modelIdentifier },
      { granularity: "model", upi: `https://qr.example.test/01/0${gtin}`, modelIdentifier: "VOLTA-48" }
    );
    assert.deepEqual(reg.data.issues, []);
  });

  await t.test("registratiegegevens: CSV per product, exemplaren met eigen UPI, delen van max. 100", async () => {
    const batch = await request(baseUrl, "POST", `/api/products/${product}/batches`, { cookie: cookieA, body: { batchNumber: "L7", productionDate: "2026-10-01" } });
    assert.equal(batch.status, 201, JSON.stringify(batch.data));
    const serials = Array.from({ length: 105 }, (_, i) => `S${String(i + 1).padStart(4, "0")}`);
    const items = await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { batchId: batch.data.id, serials } });
    assert.ok([200, 201].includes(items.status), JSON.stringify(items.data));

    const records = await registry.recordsForProduct({ id: product, public_id: publicId, gtin, model: "VOLTA-48" }, { qrBaseUrl: "https://qr.example.test", granularity: "item" });
    assert.equal(records.length, 105);
    assert.equal(records[0].upi, `https://qr.example.test/01/0${gtin}/10/L7/21/S0001`);
    assert.equal(records[0].batchIdentifier, "L7");
    assert.deepEqual(registry.validate(records), []);
    assert.deepEqual(registry.chunk(records).map((p) => p.length), [100, 5]);

    const one = await fetch(`${baseUrl}/api/products/${product}/registration/records?granularity=model`, { headers: { Cookie: cookieA } });
    assert.equal(one.status, 200);
    assert.match(one.headers.get("content-type"), /text\/csv/);
    const csv = await one.text();
    assert.match(csv, /^productGroup,granularity,upi,modelIdentifier,batchIdentifier,serialNumber,digitalProductPassportId\r\n/);
    assert.match(one.headers.get("content-disposition"), /filename="[A-Za-z0-9._-]+\.csv"/);

    const zip = await fetch(`${baseUrl}/api/products/${product}/registration/records?granularity=item`, { headers: { Cookie: cookieA } });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get("content-type"), "application/zip");
    const { unzipSync } = require("fflate");
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    assert.deepEqual(Object.keys(files).map((name) => name.replace(/^.*-deel-/, "")), ["001.csv", "002.csv"]);
  });

  await t.test("controles zoals het register: https, unieke UPI, toegestane bestandsnaam, doorverwijzing", async () => {
    const issues = registry.validate([
      { upi: "http://qr.example.test/p/1" },
      { upi: "https://qr.example.test/p/2" },
      { upi: "https://qr.example.test/p/2" },
      { upi: "https://qr.example.test:8443/p/3" }
    ]);
    assert.deepEqual(issues.map((i) => [i.index, i.code]), [[0, "INVALID_URL_FORMAT"], [2, "DUPLICATE_UPI"], [3, "UPI_INVALID"]]);
    assert.equal(registry.safeFileName("registratie van ../Accu Volta/48V"), "registratie-van-.-Accu-Volta-48V");
    assert.match(registry.safeFileName("a b/c\\d..e"), /^[A-Za-z0-9._-]+$/);
    assert.equal((await registry.checkResolvable("http://qr.example.test/p/1")).code, "INSECURE_REDIRECT");
  });

  await t.test("uitkomst uit het register vastleggen, met de paspoortversie", async () => {
    const counts = (await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie: cookieA })).data;
    assert.deepEqual([counts.itemCount, counts.batchCount], [105, 1], "kaart toont exemplaren als hoofdroute");
    assert.equal((await request(baseUrl, "PATCH", `/api/products/${product}/registration`, { cookie: cookieA, body: { status: "registered" } })).status, 400);
    assert.equal((await request(baseUrl, "PATCH", `/api/products/${product}/registration`, { cookie: cookieA, body: { status: "" } })).status, 400, "geen status = niets opslaan");
    const rejected = await request(baseUrl, "PATCH", `/api/products/${product}/registration`, {
      cookie: cookieA,
      body: { status: "rejected", correlationId: "corr-1", errorCode: "SEMANTIC_UNAVAILABLE", errorMessage: "Semantic validation failed due to its unavailability." }
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
    assert.equal(rejected.data.status, "rejected");
    assert.equal(rejected.data.error_code, "SEMANTIC_UNAVAILABLE");
    const ok = await request(baseUrl, "PATCH", `/api/products/${product}/registration`, {
      cookie: cookieUser,
      body: { status: "registered", registryUri: "urn:eu:dpp:registry:123" }
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.status, "registered");
    assert.equal(ok.data.registry_uri, "urn:eu:dpp:registry:123");
    assert.equal(ok.data.correlation_id, "corr-1", "correlation ID blijft bewaard");
    assert.equal(ok.data.error_code, null);
    assert.equal(ok.data.upi, `https://qr.example.test/01/0${gtin}`);
    const latest = (await pool.query("SELECT max(version_number) AS n FROM dbo.passportversions WHERE product_id = $1", [product])).rows[0].n;
    assert.equal(ok.data.version_number, latest);
    // Ander bedrijf kan niets zien of wijzigen.
    assert.equal((await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie: cookieB })).status, 404);
  });
});
