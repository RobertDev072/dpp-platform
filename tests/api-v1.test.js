const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// B2B-API /api/v1: API-sleutels (alleen beheerder, eenmalig zichtbaar, intrekbaar),
// publieke leesmethoden, schrijfmethoden alleen voor het eigen bedrijf met write-recht.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

function gtin13(prefix12) {
  let sum = 0;
  const padded = prefix12.padStart(13, "0");
  for (let i = 0; i < 13; i += 1) sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

async function call(baseUrl, method, path, { key, body } = {}) {
  const headers = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

test("B2B-API v1: sleutels, lezen, schrijven en tenantgrenzen", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const companyA = await createTestCompany("API A");
  const companyB = await createTestCompany("API B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const created = [];

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, userA.id, adminB.id], productIds: created });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieUserA = await login(baseUrl, userA);
  const cookieB = await login(baseUrl, adminB);
  const gtin = gtin13(`87${String(Date.now()).slice(-10)}`);
  let writeKeyA;
  let readKeyA;
  let writeKeyB;
  let dppId;

  await t.test("sleutels: alleen beheerder, eenmalig zichtbaar, gehasht opgeslagen", async () => {
    assert.equal((await request(baseUrl, "POST", "/api/company/api-keys", { cookie: cookieUserA, body: { name: "x" } })).status, 403);
    const w = await request(baseUrl, "POST", "/api/company/api-keys", { cookie: cookieA, body: { name: "ERP", scopes: "read write" } });
    assert.equal(w.status, 201);
    assert.match(w.data.key, /^vp_[a-z0-9]{8}_[A-Za-z0-9]{40}$/);
    writeKeyA = w.data.key;
    readKeyA = (await request(baseUrl, "POST", "/api/company/api-keys", { cookie: cookieA, body: { name: "Lezer" } })).data.key;
    writeKeyB = (await request(baseUrl, "POST", "/api/company/api-keys", { cookie: cookieB, body: { name: "B", scopes: "read write" } })).data.key;
    const list = await request(baseUrl, "GET", "/api/company/api-keys", { cookie: cookieA });
    assert.equal(list.data.length, 2);
    assert.ok(list.data.every((k) => !("key" in k) && !("key_hash" in k)), "lijst bevat nooit de sleutel of hash");
    const stored = (await pool.query("SELECT key_hash FROM dbo.apikeys WHERE company_id = $1", [companyA])).rows;
    assert.ok(stored.every((r) => r.key_hash !== writeKeyA && r.key_hash.length === 64));
  });

  await t.test("CreateDPP: write-recht vereist; zonder of met leessleutel geweigerd", async () => {
    assert.equal((await call(baseUrl, "POST", "/dpp", { body: { name: "X" } })).status, 401);
    assert.equal((await call(baseUrl, "POST", "/dpp", { key: "vp_aaaaaaaa_" + "a".repeat(40), body: { name: "X" } })).status, 401);
    assert.equal((await call(baseUrl, "POST", "/dpp", { key: readKeyA, body: { name: "X" } })).status, 403);
    const res = await call(baseUrl, "POST", "/dpp", {
      key: writeKeyA,
      body: { name: "API-stoel", gtin, language: "nl-NL", contentSpecificationIds: ["Verordening (EU) 2024/1781"], publish: true }
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.match(res.data.digitalProductPassportId, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(res.data.dppStatus, "Active");
    // UPI = https-URL op ons QR-domein met de GTIN erin (GS1 Digital Link, opent het paspoort).
    assert.equal(res.data.uniqueProductIdentifier, `${new URL(res.data.id).origin}/01/0${gtin}`);
    assert.equal(res.data.identifiers.gs1DigitalLink, `https://id.gs1.org/01/0${gtin}`);
    dppId = res.data.digitalProductPassportId;
    const row = (await pool.query("SELECT id, company_id FROM dbo.products WHERE public_id = $1", [dppId.slice(9)])).rows[0];
    created.push(row.id);
    assert.equal(row.company_id, companyA, "aangemaakt in het bedrijf van de sleutel");
    const audit = (await pool.query("SELECT metadata FROM dbo.auditlogs WHERE entity_type = 'Product' AND entity_id = $1", [String(row.id)])).rows;
    assert.ok(audit.some((a) => JSON.parse(a.metadata).via === "api"), "auditlog vermeldt de API");
  });

  await t.test("ReadDPPById: publiek, met urn:uuid of kale UUID", async () => {
    const a = await call(baseUrl, "GET", `/dpp/${encodeURIComponent(dppId)}`);
    assert.equal(a.status, 200);
    assert.equal(a.data.digitalProductPassportId, dppId);
    const b = await call(baseUrl, "GET", `/dpp/${dppId.slice(9).toUpperCase()}`);
    assert.equal(b.status, 200);
    assert.equal((await call(baseUrl, "GET", "/dpp/onzin")).status, 404);
  });

  await t.test("ReadDPPByProductId: op GTIN (ook 14 cijfers) en GS1 Digital Link", async () => {
    for (const productId of [gtin, `0${gtin}`, `https://id.gs1.org/01/0${gtin}`]) {
      const res = await call(baseUrl, "GET", `/dpp?productId=${encodeURIComponent(productId)}`);
      assert.equal(res.status, 200, productId);
      assert.equal(res.data.digitalProductPassportId, dppId);
    }
    assert.equal((await call(baseUrl, "GET", "/dpp?productId=00000000")).status, 404);
  });

  await t.test("ReadDPPIdsByProductIds: meerdere ID's, gepagineerd", async () => {
    const res = await call(baseUrl, "POST", "/dpp/search", { body: { productIds: [gtin, "4006381333931", dppId], pageSize: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.data.total, 2, "GTIN en urn:uuid vinden hetzelfde paspoort; onbekende GTIN niets");
    assert.equal(res.data.items.length, 1);
    assert.equal(res.data.pages, 2);
    assert.equal((await call(baseUrl, "POST", "/dpp/search", { body: { productIds: [] } })).status, 400);
  });

  await t.test("UpdateDPPById: eigen bedrijf ja, ander bedrijf 404", async () => {
    assert.equal((await call(baseUrl, "PATCH", `/dpp/${encodeURIComponent(dppId)}`, { key: writeKeyB, body: { brand: "Hack" } })).status, 404);
    const res = await call(baseUrl, "PATCH", `/dpp/${encodeURIComponent(dppId)}`, {
      key: writeKeyA,
      body: { brand: "Nordic", sustainability: { recycledMaterialPct: 35 }, compliance: { ceMarked: true } }
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.product.brand, "Nordic");
    assert.equal(res.data.sustainability.recycledMaterialPct, 35);
    assert.equal(res.data.compliance.ceMarked, true);
    // Tweede update van één veld laat de rest staan.
    const again = await call(baseUrl, "PATCH", `/dpp/${encodeURIComponent(dppId)}`, { key: writeKeyA, body: { sustainability: { recyclable: true } } });
    assert.equal(again.data.sustainability.recycledMaterialPct, 35);
    assert.equal(again.data.sustainability.recyclable, true);
  });

  await t.test("ReadDataElement en UpdateDataElement (ook meertalig)", async () => {
    const el = await call(baseUrl, "GET", `/dpp/${encodeURIComponent(dppId)}/elements/product.brand`);
    assert.equal(el.status, 200);
    assert.equal(el.data.value, "Nordic");
    assert.equal(el.data.dictionaryReference, "https://schema.org/brand");
    const upd = await call(baseUrl, "PUT", `/dpp/${encodeURIComponent(dppId)}/elements/product.name`, {
      key: writeKeyA,
      body: { value: [{ language: "nl-NL", value: "API-stoel" }, { language: "en-GB", value: "API chair" }] }
    });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    assert.equal(upd.data.type, "MultiLanguageDataElement");
    assert.deepEqual(upd.data.value.map((v) => v.language), ["nl-NL", "en-GB"]);
    assert.equal((await call(baseUrl, "PUT", `/dpp/${encodeURIComponent(dppId)}/elements/sustainability.recycledMaterialPct`, { key: writeKeyA, body: { value: "veel" } })).status, 400);
    assert.equal((await call(baseUrl, "PUT", `/dpp/${encodeURIComponent(dppId)}/elements/geheim.veld`, { key: writeKeyA, body: { value: 1 } })).status, 404);
  });

  await t.test("versies: elke API-wijziging is gearchiveerd; ?at= geeft de oude stand", async () => {
    const versions = await call(baseUrl, "GET", `/dpp/${encodeURIComponent(dppId)}`.replace("/dpp/", "/dpp/"));
    assert.equal(versions.status, 200);
    const list = await fetch(`${baseUrl}/api/dpp/${dppId.slice(9)}/versions`).then((r) => r.json());
    assert.ok(list.versions.length >= 4, `versies: ${list.versions.length}`);
    const first = await call(baseUrl, "GET", `/dpp/${encodeURIComponent(dppId)}?at=${encodeURIComponent(list.versions[0].createdAt)}`);
    assert.equal(first.status, 200);
    assert.equal(first.data.product.brand ?? null, null, "versie 1 had nog geen merk");
  });

  await t.test("DeleteDPPById: archiveert, paspoort blijft raadpleegbaar", async () => {
    assert.equal((await call(baseUrl, "DELETE", `/dpp/${encodeURIComponent(dppId)}`, { key: readKeyA })).status, 403);
    const res = await call(baseUrl, "DELETE", `/dpp/${encodeURIComponent(dppId)}`, { key: writeKeyA });
    assert.equal(res.status, 200);
    assert.equal(res.data.dppStatus, "Archived");
    const pub = await call(baseUrl, "GET", `/dpp/${encodeURIComponent(dppId)}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.data.dppStatus, "Archived");
  });

  await t.test("ingetrokken sleutel werkt direct niet meer", async () => {
    const list = await request(baseUrl, "GET", "/api/company/api-keys", { cookie: cookieA });
    const erp = list.data.find((k) => k.name === "ERP");
    assert.equal((await request(baseUrl, "DELETE", `/api/company/api-keys/${erp.id}`, { cookie: cookieB })).status, 404, "ander bedrijf");
    assert.equal((await request(baseUrl, "DELETE", `/api/company/api-keys/${erp.id}`, { cookie: cookieA })).status, 200);
    assert.equal((await call(baseUrl, "PATCH", `/dpp/${encodeURIComponent(dppId)}`, { key: writeKeyA, body: { brand: "x" } })).status, 401);
  });

  await t.test("documentatie: OpenAPI noemt alle methoden; JSON Schema bestaat", async () => {
    const doc = await call(baseUrl, "GET", "/openapi.json");
    assert.equal(doc.status, 200);
    const ops = Object.values(doc.data.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    for (const op of ["ReadDPPById", "ReadDPPByProductId", "ReadDPPIdsByProductIds", "CreateDPP", "UpdateDPPById", "DeleteDPPById", "ReadDataElement", "UpdateDataElement", "RegisterProductDPP"]) {
      assert.ok(ops.includes(op), op);
    }
    const schema = await call(baseUrl, "GET", "/schema/dpp.json");
    assert.ok(schema.data.required.includes("dppSchemaVersion"));
  });
});
