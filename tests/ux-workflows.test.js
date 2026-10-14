const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Nieuwe UX-workflows: categorie + compleetheid, document-IDOR, QR-reservering,
// bulkacties, Excel/CSV-import (chunks, hervatten, duplicaten), print/labels,
// zoeken, meldingen en Customer 360 - telkens inclusief tenant-isolatie.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200, `login ${user.email}`);
  return res.cookie;
}

async function binary(baseUrl, method, path, cookie, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer, headers: res.headers, json: () => JSON.parse(buffer.toString("utf8")) };
}

async function productCount(companyId) {
  const pool = await getPool();
  const r = await pool.request().input("c", sql.Int, companyId).query("SELECT COUNT(*) AS n FROM dbo.Products WHERE company_id = @c");
  return r.recordset[0].n;
}

test("UX-workflows: tenant-gebonden nieuwe functies", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("UX A");
  const companyB = await createTestCompany("UX B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, userA.id, adminB.id, owner.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const a = await login(baseUrl, adminA);
  const u = await login(baseUrl, userA);
  const b = await login(baseUrl, adminB);
  const o = await login(baseUrl, owner);

  let productA;
  let productB;

  await t.test("category_label: aanmaken, bijwerken, lezen; compleetheid 0-100 met 7 criteria", async () => {
    const created = await request(baseUrl, "POST", "/api/products", { cookie: a, body: { name: "Bank", categoryLabel: "Banken", sku: "UX-1" } });
    assert.equal(created.status, 201);
    assert.equal(created.data.category_label, "Banken");
    productA = created.data.id;

    let read = await request(baseUrl, "GET", `/api/products/${productA}`, { cookie: a });
    assert.equal(read.data.category_label, "Banken");
    assert.equal(read.data.checks.category, true);
    assert.equal(read.data.checks.identification, true);
    assert.equal(read.data.completeness, Math.floor((2 * 100) / 7));
    assert.equal(read.data.qr_status, "none");

    const patched = await request(baseUrl, "PATCH", `/api/products/${productA}`, { cookie: a, body: { categoryLabel: "Stoelen", description: "Mooi" } });
    assert.equal(patched.status, 200);
    read = await request(baseUrl, "GET", `/api/products/${productA}`, { cookie: a });
    assert.equal(read.data.category_label, "Stoelen");
    assert.equal(read.data.completeness, Math.floor((3 * 100) / 7));

    const list = await request(baseUrl, "GET", "/api/products?missing=documents", { cookie: a });
    assert.ok(list.data.items.some((p) => p.id === productA));
    assert.equal(list.data.items.find((p) => p.id === productA).completeness, read.data.completeness);

    const createdB = await request(baseUrl, "POST", "/api/products", { cookie: b, body: { name: "B-product", sku: "UX-1" } });
    productB = createdB.data.id;
  });

  await t.test("document verwijderen: ander product of andere tenant geeft 404 en laat het document staan", async () => {
    const docB = await request(baseUrl, "POST", `/api/products/${productB}/documents`, { cookie: b, body: { type: "pdf", title: "B-doc", storageUrl: "https://example.com/b.pdf" } });
    assert.equal(docB.status, 201);
    const second = await request(baseUrl, "POST", "/api/products", { cookie: a, body: { name: "Tweede" } });
    const docA2 = await request(baseUrl, "POST", `/api/products/${second.data.id}/documents`, {
      cookie: a,
      body: { type: "pdf", title: "A2", storageUrl: "https://example.com/a2.pdf", category: "certificate", validUntil: "2020-01-01" }
    });
    assert.equal(docA2.status, 201);
    assert.equal(docA2.data.category, "certificate");

    // Document van een ander product van hetzelfde bedrijf via de URL van productA.
    let res = await request(baseUrl, "DELETE", `/api/products/${productA}/documents/${docA2.data.id}`, { cookie: a });
    assert.equal(res.status, 404);
    // Document van een ander bedrijf.
    res = await request(baseUrl, "DELETE", `/api/products/${productA}/documents/${docB.data.id}`, { cookie: a });
    assert.equal(res.status, 404);
    res = await request(baseUrl, "DELETE", `/api/products/${productB}/documents/${docB.data.id}`, { cookie: a });
    assert.equal(res.status, 404, "product van andere tenant");
    const stillThere = await request(baseUrl, "GET", `/api/products/${productB}/documents`, { cookie: b });
    assert.equal(stillThere.data.length, 1);
    // PATCH op ander product mag ook niet.
    res = await request(baseUrl, "PATCH", `/api/products/${productA}/documents/${docA2.data.id}`, { cookie: a, body: { isPublic: true } });
    assert.equal(res.status, 404);
    // Eigen document wel.
    res = await request(baseUrl, "DELETE", `/api/products/${second.data.id}/documents/${docA2.data.id}`, { cookie: a });
    assert.equal(res.status, 200);
  });

  await t.test("QR: gereserveerd → 404, gepubliceerd → werkt, gearchiveerd → werkt, public_id ongewijzigd", async () => {
    const reserved = await request(baseUrl, "POST", `/api/products/${productA}/qr`, { cookie: a });
    assert.equal(reserved.status, 200);
    const publicId = reserved.data.public_id;
    assert.ok(publicId);
    assert.equal((await request(baseUrl, "GET", `/api/public/products/${publicId}`)).status, 404);
    const again = await request(baseUrl, "POST", `/api/products/${productA}/qr`, { cookie: a });
    assert.equal(again.data.public_id, publicId, "reserveren is idempotent");
    const png = await binary(baseUrl, "GET", `/api/products/${productA}/qr.png?size=1200`, a);
    assert.equal(png.status, 200);
    assert.equal(png.buffer.readUInt32BE(16), 1200, "PNG-breedte volgt ?size");

    const published = await request(baseUrl, "POST", `/api/products/${productA}/publish`, { cookie: a });
    assert.equal(published.data.public_id, publicId);
    assert.equal((await request(baseUrl, "GET", `/api/public/products/${publicId}`)).status, 200);
    const pub = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(pub.data.issuer.name.startsWith("UX A"), true);
    assert.equal(pub.data.company_id, undefined);

    await request(baseUrl, "DELETE", `/api/products/${productA}`, { cookie: a });
    const archived = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(archived.status, 200);
    assert.equal(archived.data.archived, true);

    // Andere tenant kan geen QR reserveren voor dit product.
    assert.equal((await request(baseUrl, "POST", `/api/products/${productA}/qr`, { cookie: b })).status, 404);
  });

  await t.test("bulkacties: tenant-gebonden, publiceren alleen compleet, filter-selectie", async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await request(baseUrl, "POST", "/api/products", { cookie: a, body: { name: `Bulk ${i}` } })).data.id);
    }
    // id van tenant B in de selectie wordt genegeerd.
    let res = await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: a, body: { action: "set_category", selection: { ids: [...ids, productB] }, category: "Bulkcat" } });
    assert.equal(res.status, 200);
    assert.equal(res.data.affected, 3);
    const bAfter = await request(baseUrl, "GET", `/api/products/${productB}`, { cookie: b });
    assert.equal(bAfter.data.category_label, null);

    res = await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: a, body: { action: "publish", selection: { ids } } });
    assert.equal(res.data.affected, 0, "incomplete producten worden niet gepubliceerd");
    res = await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: a, body: { action: "generate_qr", selection: { filter: { category: "Bulkcat" } } } });
    assert.equal(res.data.affected, 3);
    const resolve = await request(baseUrl, "POST", "/api/products/bulk/resolve", { cookie: a, body: { selection: { filter: { qr: "reserved" } } } });
    assert.ok(ids.every((id) => resolve.data.ids.includes(id)));
    assert.ok(!resolve.data.ids.includes(productB));
    res = await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: a, body: { action: "archive", selection: { ids } } });
    assert.equal(res.data.affected, 3);
    // companyId in de selectie bestaat niet: wordt door het schema geweigerd/genegeerd.
    res = await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: a, body: { action: "archive", selection: { filter: { companyId: companyB } } } });
    const bStill = await request(baseUrl, "GET", `/api/products/${productB}`, { cookie: b });
    assert.equal(bStill.data.status, "draft");
    // Platform Owner gebruikt deze bedrijfsroute niet.
    assert.equal((await request(baseUrl, "POST", "/api/products/bulk/actions", { cookie: o, body: { action: "archive", selection: { ids: [productB] } } })).status, 403);

    const exp = await binary(baseUrl, "POST", "/api/products/bulk/export", a, { selection: { ids } });
    assert.equal(exp.status, 200);
    const wb = XLSX.read(exp.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    assert.equal(rows.length, 4);
    assert.equal(rows[0][0], "product_name");
  });

  await t.test("import is verwijderd: geen API, geen oude routes (komt eventueel terug in versie 2)", async () => {
    for (const [method, path] of [
      ["GET", "/api/products/import"],
      ["POST", "/api/products/import"],
      ["GET", "/api/products/import/template.xlsx"],
      ["POST", "/api/products/import/1/validate"],
      ["POST", "/api/products/import/1/run"]
    ]) {
      for (const cookie of [a, u]) {
        const res = await request(baseUrl, method, path, { cookie });
        assert.ok([404, 405].includes(res.status), `${method} ${path} geeft ${res.status}`);
      }
    }
    // Testdata voor de volgende tests (voorheen via een import): 1.001 producten.
    const pool = await getPool();
    await pool.query(
      `INSERT INTO dbo.products (company_id, name, sku, status)
       SELECT $1, 'Groot ' || i, 'BIG-' || i, 'draft' FROM generate_series(0, 1000) AS i`,
      [companyA]
    );
    assert.equal((await productCount(companyA)) >= 1001, true);
  });

  await t.test("QR-ZIP: 1000 SVG / 500 PNG per bestand, 501 PNG geweigerd, tenant-isolatie; printen bestaat niet meer", async () => {
    const ids = (await request(baseUrl, "POST", "/api/products/bulk/resolve", { cookie: a, body: { selection: { filter: { q: "BIG-" } } } })).data.ids;
    assert.ok(ids.length >= 1001);
    // Producten van tenant A via tenant B: niets.
    const otherZip = await binary(baseUrl, "POST", "/api/qr/codes.zip", b, { ids: ids.slice(0, 5), format: "svg", generateMissing: true });
    assert.equal(otherZip.status, 400);

    const zip = await binary(baseUrl, "POST", "/api/qr/codes.zip", a, { ids: ids.slice(0, 20), format: "png", sizePx: 600, generateMissing: true });
    assert.equal(zip.status, 200);
    assert.equal(zip.buffer.subarray(0, 2).toString(), "PK");
    assert.equal(zip.headers.get("x-files-count"), "20");
    const svgZip = await binary(baseUrl, "POST", "/api/qr/codes.zip", a, { ids: ids.slice(0, 1000), format: "svg", generateMissing: true });
    assert.equal(svgZip.status, 200);
    assert.ok(svgZip.buffer.length < 4.5 * 1024 * 1024);
    assert.equal((await binary(baseUrl, "POST", "/api/qr/codes.zip", a, { ids: ids.slice(0, 501), format: "png" })).status, 400);
    for (const gone of ["/api/print/options", "/api/print/profiles"]) {
      assert.equal((await request(baseUrl, "GET", gone, { cookie: a })).status, 404, gone);
    }
  });

  await t.test("zoeken, meldingen, dashboard en QR-statistieken zijn tenant-gebonden", async () => {
    const searchA = await request(baseUrl, "GET", "/api/search?q=UX-1", { cookie: a });
    const productsA = searchA.data.groups.find((g) => g.type === "products");
    assert.ok(productsA.items.length >= 1);
    assert.ok(productsA.items.every((i) => i.href.startsWith("/company/products/")));
    assert.ok(!productsA.items.some((i) => i.id === productB));
    const searchB = await request(baseUrl, "GET", "/api/search?q=Groot", { cookie: b });
    assert.equal(searchB.data.groups.length, 0, "B ziet geen producten van A");
    assert.ok(!(await request(baseUrl, "GET", `/api/search?q=${adminB.email.slice(0, 10)}`, { cookie: u })).data.groups.some((g) => g.type === "users"), "medewerker ziet geen gebruikers");
    const ownerSearch = await request(baseUrl, "GET", "/api/search?q=UX%20A", { cookie: o });
    assert.ok(ownerSearch.data.groups.some((g) => g.type === "companies"));

    const overview = await request(baseUrl, "GET", "/api/dashboard/overview", { cookie: u });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.stats.total >= 1000);
    assert.equal(overview.data.scans.series.length, 30);
    assert.equal(overview.data.onboarding.steps.length, 5);
    assert.equal((await request(baseUrl, "GET", "/api/dashboard/overview", { cookie: o })).status, 403);
    const overviewB = await request(baseUrl, "GET", "/api/dashboard/overview?days=7", { cookie: b });
    assert.ok(overviewB.data.stats.total < 10);
    assert.equal(overviewB.data.scans.series.length, 7);

    const notes = await request(baseUrl, "GET", "/api/dashboard/notifications", { cookie: a });
    assert.equal(notes.status, 200);
    assert.ok(!notes.data.items.some((n) => n.id.startsWith("import:")), "geen importmeldingen meer");
    assert.equal((await request(baseUrl, "GET", "/api/dashboard/notifications", { cookie: o })).status, 200);

    const qrStats = await request(baseUrl, "GET", "/api/products/qr-stats", { cookie: a });
    assert.ok(qrStats.data.total >= 1);
    const docs = await request(baseUrl, "GET", "/api/company/documents?validity=expired", { cookie: a });
    assert.equal(docs.status, 200);
    assert.ok(Array.isArray(docs.data.items));
  });

  await t.test("Customer 360 alleen voor de Platform Owner", async () => {
    assert.equal((await request(baseUrl, "GET", `/api/admin/companies/${companyA}/overview`, { cookie: a })).status, 403);
    const res = await request(baseUrl, "GET", `/api/admin/companies/${companyA}/overview`, { cookie: o });
    assert.equal(res.status, 200);
    assert.ok(res.data.users.length >= 2);
    assert.equal(res.data.imports, undefined, "geen importgegevens meer");
    assert.equal(res.data.company.logo, undefined, "geen logo-blob in de response");
  });
});
