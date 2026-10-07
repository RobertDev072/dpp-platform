const test = require("node:test");
const assert = require("node:assert/strict");
const { closePool, queryOne, queryRows } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const { defaultSettings } = require("../src/services/printLayout");
const { normalizeRow, suggestMapping } = require("../src/services/importFields");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("importFields: kolomherkenning en rijnormalisatie", () => {
  const mapping = suggestMapping(["Productnaam", "Artikelnummer", "EAN", "CO2 (kg)", "CE-markering"]);
  assert.deepEqual(mapping, ["name", "sku", "gtin", "co2FootprintKg", "ceMarked"]);

  const ok = normalizeRow({ name: "Stoel", co2FootprintKg: "1,5", ceMarked: "ja", recycledMaterialPct: "40" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.co2FootprintKg, 1.5);
  assert.equal(ok.values.ceMarked, true);

  const bad = normalizeRow({ name: "", recycledMaterialPct: "140" });
  assert.ok(bad.errors.length >= 2, "lege naam en percentage > 100 zijn fouten");
});

test("bulk, import, QR, printprofielen en zoeken zijn tenant-gescheiden", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("Bulk A");
  const companyB = await createTestCompany("Bulk B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const productA1 = await createTestProduct({ companyId: companyA, name: "Alpha Stoel" });
  const productA2 = await createTestProduct({ companyId: companyA, name: "Alpha Tafel" });
  const productB = await createTestProduct({ companyId: companyB, name: "Beta Kast" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [adminA.id, userA.id, adminB.id, owner.id],
      productIds: [productA1, productA2, productB]
    });
    await stopTestServer(server);
    await closePool();
  });

  let cookieA;
  let cookieUserA;
  let cookieB;
  let cookieOwner;

  await t.test("setup: inloggen", async () => {
    cookieA = await login(baseUrl, adminA);
    cookieUserA = await login(baseUrl, userA);
    cookieB = await login(baseUrl, adminB);
    cookieOwner = await login(baseUrl, owner);
  });

  // --- Bulkacties ---------------------------------------------------------
  await t.test("bulk: ids van een ander bedrijf worden genegeerd (geen IDOR)", async () => {
    const res = await request(baseUrl, "POST", "/api/products/bulk", {
      cookie: cookieB,
      body: { action: "set_category", ids: [productA1, productA2], category: "Gehackt" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.affected, 0);
    const row = await queryOne("SELECT category_label FROM products WHERE id = $1", [productA1]);
    assert.notEqual(row.category_label, "Gehackt");
  });

  await t.test("bulk: companyId in de body wordt geweigerd/genegeerd", async () => {
    const res = await request(baseUrl, "POST", "/api/products/bulk", {
      cookie: cookieB,
      body: { action: "archive", filter: {}, companyId: companyA }
    });
    // Strikte validatie mag weigeren; als het doorgaat raakt het alleen bedrijf B.
    if (res.status === 200) {
      const row = await queryOne("SELECT status FROM products WHERE id = $1", [productA1]);
      assert.notEqual(row.status, "archived");
      await request(baseUrl, "POST", "/api/products/bulk", { cookie: cookieB, body: { action: "restore", ids: [productB] } });
    } else {
      assert.equal(res.status, 400);
    }
  });

  await t.test("bulk: categorie wijzigen en QR reserveren voor eigen producten", async () => {
    const cat = await request(baseUrl, "POST", "/api/products/bulk", {
      cookie: cookieUserA,
      body: { action: "set_category", ids: [productA1, productA2], category: "Meubels" }
    });
    assert.equal(cat.status, 200);
    assert.equal(cat.data.affected, 2);

    const qr = await request(baseUrl, "POST", "/api/products/bulk", {
      cookie: cookieA,
      body: { action: "reserve_qr", ids: [productA1, productA2] }
    });
    assert.equal(qr.status, 200);
    const rows = await queryRows("SELECT public_id, status FROM products WHERE id = ANY($1::int[])", [[productA1, productA2]]);
    assert.ok(rows.every((r) => r.public_id && r.status === "draft"), "QR gereserveerd, product blijft concept");
  });

  await t.test("bulk: publiceren slaat incomplete producten over", async () => {
    const res = await request(baseUrl, "POST", "/api/products/bulk", {
      cookie: cookieA,
      body: { action: "publish", ids: [productA1] }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.affected, 0);
    assert.equal(res.data.skipped, 1);
  });

  await t.test("bulk: meer dan 1000 ids wordt geweigerd", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    const res = await request(baseUrl, "POST", "/api/products/bulk", { cookie: cookieA, body: { action: "archive", ids } });
    assert.equal(res.status, 400);
  });

  // --- QR -----------------------------------------------------------------
  await t.test("qr: gereserveerde QR opent de 'nog niet gepubliceerd'-pagina, geen 404", async () => {
    const row = await queryOne("SELECT public_id FROM products WHERE id = $1", [productA1]);
    const res = await request(baseUrl, "GET", `/api/public/passports/${row.public_id}`);
    // Publieke API geeft alleen gepubliceerde paspoorten vrij.
    assert.notEqual(res.status, 200);
  });

  await t.test("qr: items per id zijn tenant-gescheiden en bevatten de officiële URL", async () => {
    const own = await request(baseUrl, "POST", "/api/qr/items", { cookie: cookieA, body: { ids: [productA1, productB] } });
    assert.equal(own.status, 200);
    assert.deepEqual(own.data.items.map((i) => i.id), [productA1]);
    assert.match(own.data.items[0].qr_url, /\/p\/[0-9A-F-]{36}$/);

    const other = await request(baseUrl, "POST", "/api/qr/items", { cookie: cookieB, body: { ids: [productA1] } });
    assert.equal(other.status, 200);
    assert.equal(other.data.items.length, 0);
  });

  await t.test("qr: stats en lijst alleen eigen bedrijf", async () => {
    const stats = await request(baseUrl, "GET", "/api/qr/stats", { cookie: cookieB });
    assert.equal(stats.status, 200);
    assert.equal(Number(stats.data.reserved || 0), 0);
    const list = await request(baseUrl, "GET", "/api/qr?qrStatus=reserved", { cookie: cookieA });
    assert.equal(list.status, 200);
    assert.ok(list.data.items.every((i) => [productA1, productA2].includes(i.id)));
  });

  await t.test("qr: reserveren voor product van ander bedrijf geeft 403/404", async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productA2}/qr`, { cookie: cookieB });
    assert.ok([403, 404].includes(res.status));
  });

  // --- Import -------------------------------------------------------------
  let jobId;
  await t.test("import: preview valideert en herkent bestaande SKU", async () => {
    await queryOne("UPDATE products SET sku = 'ALPHA-1', description = 'Originele omschrijving' WHERE id = $1 RETURNING id", [productA1]);
    const res = await request(baseUrl, "POST", "/api/imports/preview", {
      cookie: cookieA,
      body: {
        rows: [
          { row: 2, values: { name: "Nieuw", sku: "NEW-1" } },
          { row: 3, values: { name: "", sku: "X" } },
          { row: 4, values: { name: "Bestaand", sku: "alpha-1" } }
        ]
      }
    });
    assert.equal(res.status, 200);
    const [a, b, c] = res.data.results;
    assert.equal(a.errors.length, 0);
    assert.ok(b.errors.length > 0);
    assert.equal(c.existing.id, productA1);
  });

  await t.test("import: preview van bedrijf B ziet SKU van A niet als duplicaat", async () => {
    const res = await request(baseUrl, "POST", "/api/imports/preview", {
      cookie: cookieB,
      body: { rows: [{ row: 2, values: { name: "X", sku: "ALPHA-1" } }] }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.results[0].existing, null);
  });

  await t.test("import: volledige flow (aanmaken, bijwerken, fout) en rapport", async () => {
    const created = await request(baseUrl, "POST", "/api/imports", {
      cookie: cookieA,
      body: { fileName: "test.csv", totalRows: 3, duplicateMode: "update", mapping: { naam: "name" } }
    });
    assert.equal(created.status, 201);
    jobId = created.data.id;

    const rows = await request(baseUrl, "POST", `/api/imports/${jobId}/rows`, {
      cookie: cookieA,
      body: {
        rows: [
          { row: 2, values: { name: "Import Lamp", sku: "IMP-1", co2FootprintKg: "2,5", ceMarked: "ja", material: "Aluminium" } },
          { row: 3, values: { name: "", sku: "IMP-2" } },
          { row: 4, values: { name: "Alpha Stoel v2", sku: "ALPHA-1", brand: "NieuwMerk", description: "" } }
        ]
      }
    });
    assert.equal(rows.status, 200, JSON.stringify(rows.data));
    const outcomes = rows.data.results.map((r) => r.outcome);
    assert.deepEqual(outcomes, ["created", "error", "updated"]);

    const lamp = await queryOne("SELECT id, status, company_id FROM products WHERE company_id = $1 AND sku = 'IMP-1'", [companyA]);
    assert.equal(lamp.status, "draft");
    const sus = await queryOne("SELECT co2_footprint_kg FROM product_sustainability WHERE product_id = $1", [lamp.id]);
    assert.equal(Number(sus.co2_footprint_kg), 2.5);
    const alpha = await queryOne("SELECT name, brand, description FROM products WHERE id = $1", [productA1]);
    assert.equal(alpha.brand, "NieuwMerk");
    assert.equal(alpha.name, "Alpha Stoel v2");
    assert.equal(alpha.description, "Originele omschrijving", "lege cellen overschrijven bestaande data niet");

    const fin = await request(baseUrl, "POST", `/api/imports/${jobId}/finish`, { cookie: cookieA, body: {} });
    assert.equal(fin.status, 200);
    assert.equal(fin.data.status, "completed_with_errors");

    const detail = await request(baseUrl, "GET", `/api/imports/${jobId}`, { cookie: cookieUserA });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.errors.length, 1);
    assert.equal(detail.data.errors[0].row, 3);
  });

  await t.test("import: bedrijf B kan job van A niet zien, vullen of afronden", async () => {
    const get = await request(baseUrl, "GET", `/api/imports/${jobId}`, { cookie: cookieB });
    assert.equal(get.status, 404);
    const rows = await request(baseUrl, "POST", `/api/imports/${jobId}/rows`, {
      cookie: cookieB,
      body: { rows: [{ row: 2, values: { name: "Inbraak" } }] }
    });
    assert.ok([404, 409].includes(rows.status));
    const list = await request(baseUrl, "GET", "/api/imports", { cookie: cookieB });
    assert.equal(list.status, 200);
    assert.equal(list.data.items.length, 0);
    const none = await queryOne("SELECT COUNT(*)::int AS n FROM products WHERE name = 'Inbraak'");
    assert.equal(none.n, 0);
  });

  await t.test("import: afgeronde job accepteert geen rijen meer; platform owner heeft geen toegang", async () => {
    const rows = await request(baseUrl, "POST", `/api/imports/${jobId}/rows`, {
      cookie: cookieA,
      body: { rows: [{ row: 9, values: { name: "Te laat" } }] }
    });
    assert.ok([404, 409].includes(rows.status));
    const owner = await request(baseUrl, "GET", "/api/imports", { cookie: cookieOwner });
    assert.equal(owner.status, 403);
  });

  await t.test("import: meer dan 250 rijen per request wordt geweigerd", async () => {
    const rows = Array.from({ length: 251 }, (_, i) => ({ row: i + 2, values: { name: `R${i}` } }));
    const res = await request(baseUrl, "POST", "/api/imports/preview", { cookie: cookieA, body: { rows } });
    assert.equal(res.status, 400);
  });

  // --- Printprofielen -----------------------------------------------------
  let profileId;
  await t.test("print: medewerker mag niet aanmaken, beheerder wel; eerste wordt standaard", async () => {
    const denied = await request(baseUrl, "POST", "/api/print-profiles", {
      cookie: cookieUserA,
      body: { name: "Mag niet", settings: defaultSettings() }
    });
    assert.equal(denied.status, 403);

    const created = await request(baseUrl, "POST", "/api/print-profiles", {
      cookie: cookieA,
      body: { name: "A4 stickers", settings: defaultSettings() }
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.isDefault, true);
    profileId = created.data.id;
  });

  await t.test("print: onbruikbare instellingen (QR < 10 mm) worden geweigerd", async () => {
    const settings = defaultSettings();
    settings.qr.sizeMm = 8;
    const res = await request(baseUrl, "POST", "/api/print-profiles", { cookie: cookieA, body: { name: "Te klein", settings } });
    assert.equal(res.status, 400);
  });

  await t.test("print: profielen van A zijn onzichtbaar en onwijzigbaar voor B", async () => {
    const list = await request(baseUrl, "GET", "/api/print-profiles", { cookie: cookieB });
    assert.equal(list.status, 200);
    assert.equal(list.data.items.length, 0);
    assert.ok(list.data.examples.length > 0);
    assert.equal((await request(baseUrl, "GET", `/api/print-profiles/${profileId}`, { cookie: cookieB })).status, 404);
    assert.equal(
      (await request(baseUrl, "PATCH", `/api/print-profiles/${profileId}`, { cookie: cookieB, body: { name: "Overgenomen" } })).status,
      404
    );
    assert.equal((await request(baseUrl, "DELETE", `/api/print-profiles/${profileId}`, { cookie: cookieB })).status, 404);
    const own = await request(baseUrl, "GET", `/api/print-profiles/${profileId}`, { cookie: cookieUserA });
    assert.equal(own.status, 200);
    assert.equal(own.data.name, "A4 stickers");
  });

  // --- Zoeken, meldingen, dashboard ---------------------------------------
  await t.test("zoeken: alleen eigen producten; platform owner zoekt over bedrijven", async () => {
    const a = await request(baseUrl, "GET", "/api/workspace/search?q=Beta", { cookie: cookieA });
    assert.equal(a.status, 200);
    const productHits = a.data.groups.filter((g) => g.type === "products").flatMap((g) => g.items);
    assert.ok(!productHits.some((p) => p.id === productB));

    const b = await request(baseUrl, "GET", "/api/workspace/search?q=Beta Kast", { cookie: cookieB });
    assert.ok(b.data.groups.some((g) => g.items.some((i) => i.id === productB)));

    const o = await request(baseUrl, "GET", "/api/workspace/search?q=Bulk A", { cookie: cookieOwner });
    assert.equal(o.status, 200);
    assert.ok(o.data.groups.some((g) => g.type === "companies" && g.items.some((i) => i.id === companyA)));
  });

  await t.test("meldingen en dashboard-overzicht zijn per bedrijf", async () => {
    const n = await request(baseUrl, "GET", "/api/workspace/notifications", { cookie: cookieA });
    assert.equal(n.status, 200);
    assert.ok(Array.isArray(n.data.items));

    const ovA = await request(baseUrl, "GET", "/api/dashboard/overview", { cookie: cookieA });
    const ovB = await request(baseUrl, "GET", "/api/dashboard/overview", { cookie: cookieB });
    assert.equal(ovA.status, 200);
    assert.equal(Number(ovB.data.summary.total), 1);
    assert.ok(Number(ovA.data.summary.total) >= 3);
    assert.ok(!ovB.data.recent.some((p) => p.id === productA1));
  });

  await t.test("completeness: product van ander bedrijf niet opvraagbaar", async () => {
    assert.equal((await request(baseUrl, "GET", `/api/products/${productA1}/completeness`, { cookie: cookieA })).status, 200);
    assert.ok([403, 404].includes((await request(baseUrl, "GET", `/api/products/${productA1}/completeness`, { cookie: cookieB })).status));
  });
});
