const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

// Batch- en itempaspoorten: eigen permanente id per batch/exemplaar, productgegevens van
// het model, GS1 Digital Link en -resolver, tenantgrenzen en permanentie.

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

const json = (baseUrl, path) => fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });

test("batch- en itempaspoorten", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const companyA = await createTestCompany("Items A");
  const companyB = await createTestCompany("Items B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const product = await createTestProduct({ companyId: companyA, name: "Fiets Delta" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieB = await login(baseUrl, adminB);
  const gtin = gtin13(`86${String(Date.now()).slice(-10)}`);
  let modelId;
  let batch;
  let item;

  await t.test("batch en exemplaren aanmaken; ongeldige serienummers geweigerd", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { gtin } });
    modelId = String((await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA })).data.public_id).toLowerCase();
    const b = await request(baseUrl, "POST", `/api/products/${product}/batches`, { cookie: cookieA, body: { batchNumber: "L2026-10", productionDate: "2026-10-01" } });
    assert.equal(b.status, 201);
    assert.match(String(b.data.public_id), /^[0-9a-f-]{36}$/);
    batch = b.data;

    assert.equal((await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { serials: ["met spatie"] } })).status, 400);
    assert.equal((await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieB, body: { serials: ["X1"] } })).status, 404, "ander bedrijf");
    const gen = await request(baseUrl, "POST", `/api/products/${product}/items`, {
      cookie: cookieA,
      body: { generate: { count: 3, prefix: "SN-", start: 7 }, batchId: batch.id }
    });
    assert.equal(gen.status, 201);
    assert.equal(gen.data.created, 3);
    const again = await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { serials: ["SN-00007", "SN-00010"] } });
    assert.equal(again.data.created, 1, "bestaand serienummer wordt overgeslagen");
    assert.deepEqual(again.data.skipped, ["SN-00007"]);
    const list = await request(baseUrl, "GET", `/api/products/${product}/items`, { cookie: cookieA });
    assert.equal(list.data.total, 4);
    item = list.data.items.find((i) => i.serial_number === "SN-00007");
    assert.ok(item.passportUrl.endsWith(`/p/${String(item.public_id).toUpperCase()}`));
  });

  await t.test("itempaspoort: eigen DPP-id, granularity item, GS1-link met lot en serienummer", async () => {
    const res = await json(baseUrl, `/api/dpp/${item.public_id}`);
    assert.equal(res.status, 200);
    const dpp = await res.json();
    assert.equal(dpp.digitalProductPassportId, `urn:uuid:${String(item.public_id).toLowerCase()}`);
    assert.equal(dpp.granularity, "item");
    assert.equal(dpp.uniqueProductIdentifier, `${new URL(dpp.id).origin}/01/0${gtin}/10/L2026-10/21/SN-00007`);
    assert.equal(dpp.identifiers.serialNumber, "SN-00007");
    assert.equal(dpp.identifiers.lotNumber, "L2026-10");
    assert.equal(dpp.identifiers.modelPassportId, modelId);
    assert.ok(dpp.product.name.startsWith("Fiets Delta"), "productgegevens van het model");
    assert.match(res.headers.get("link"), new RegExp(String(item.public_id).toUpperCase()));
  });

  await t.test("batchpaspoort en publieke paginagegevens", async () => {
    const dpp = await (await json(baseUrl, `/api/dpp/${batch.public_id}`)).json();
    assert.equal(dpp.granularity, "batch");
    assert.equal(dpp.uniqueProductIdentifier, `${new URL(dpp.id).origin}/01/0${gtin}/10/L2026-10`);
    const view = await (await fetch(`${baseUrl}/api/public/products/${String(item.public_id).toUpperCase()}`)).json();
    assert.equal(view.instance.granularity, "item");
    assert.equal(view.instance.serialNumber, "SN-00007");
    assert.equal(view.instance.productionDate, "2026-10-01");
  });

  await t.test("GS1-resolver en ReadDPPByProductId kiezen het meest specifieke paspoort", async () => {
    const resolve = async (link) => (await (await fetch(`${baseUrl}/api/v1/resolve?link=${encodeURIComponent(link)}`)).json()).digitalProductPassportId;
    assert.equal(await resolve(`/01/0${gtin}/21/SN-00007`), `urn:uuid:${String(item.public_id).toLowerCase()}`);
    assert.equal(await resolve(`/01/0${gtin}/10/L2026-10`), `urn:uuid:${String(batch.public_id).toLowerCase()}`);
    assert.equal(await resolve(`/01/0${gtin}`), `urn:uuid:${modelId}`);
    assert.equal(await resolve(`/01/0${gtin}/21/ONBEKEND`), `urn:uuid:${modelId}`, "onbekend serienummer → model");
    const byProduct = await (await json(baseUrl, `/api/v1/dpp?productId=${encodeURIComponent(`https://id.gs1.org/01/0${gtin}/21/SN-00008`)}`)).json();
    assert.equal(byProduct.identifiers.serialNumber, "SN-00008");
  });

  await t.test("scans van een exemplaar tellen bij het product", async () => {
    const before = Number((await pool.query("SELECT COUNT(*) FROM dbo.scanevents WHERE product_id = $1", [product])).rows[0].count);
    const res = await fetch(`${baseUrl}/api/scan/${item.public_id}`, {
      method: "POST",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone)", "Sec-Fetch-Site": "same-origin" }
    });
    assert.equal(res.status, 204);
    const after = Number((await pool.query("SELECT COUNT(*) FROM dbo.scanevents WHERE product_id = $1", [product])).rows[0].count);
    assert.equal(after, before + 1);
  });

  await t.test("gearchiveerd exemplaar blijft raadpleegbaar; QR en CSV werken; id permanent", async () => {
    const arch = await request(baseUrl, "PATCH", `/api/products/${product}/items/${item.id}`, { cookie: cookieA, body: { status: "archived" } });
    assert.equal(arch.status, 200);
    assert.equal((await json(baseUrl, `/api/dpp/${item.public_id}`)).status, 200);
    const qr = await fetch(`${baseUrl}/api/products/${product}/items/${item.id}/qr`, { headers: { Cookie: cookieA } });
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${baseUrl}/api/products/${product}/items/${item.id}/qr`, { headers: { Cookie: cookieB } })).status, 404);
    const csv = await (await fetch(`${baseUrl}/api/products/${product}/items/export.csv`, { headers: { Cookie: cookieA } })).text();
    assert.match(csv, /SN-00007;L2026-10;archived;.*\/p\/[0-9A-F-]{36};https:\/\/id\.gs1\.org\/01\//);
    await assert.rejects(pool.query("UPDATE dbo.productitems SET public_id = gen_random_uuid() WHERE id = $1", [item.id]), /permanent/);
    await assert.rejects(pool.query("UPDATE dbo.productbatches SET public_id = gen_random_uuid() WHERE id = $1", [batch.id]), /permanent/);
  });

  await t.test("concept-product: exemplaar is niet openbaar", async () => {
    const draft = await createTestProduct({ companyId: companyA, name: "Concept" });
    const res = await request(baseUrl, "POST", `/api/products/${draft}/items`, { cookie: cookieA, body: { serials: ["D1"] } });
    assert.equal(res.status, 201);
    const row = (await pool.query("SELECT public_id FROM dbo.productitems WHERE product_id = $1", [draft])).rows[0];
    assert.equal((await json(baseUrl, `/api/dpp/${row.public_id}`)).status, 404);
    await pool.query("DELETE FROM dbo.productitems WHERE product_id = $1", [draft]);
    await pool.query("DELETE FROM dbo.products WHERE id = $1", [draft]);
  });
});
