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

async function upload(baseUrl, path, cookie, filename, content, type = "text/csv") {
  const form = new FormData();
  form.append("file", new Blob([content], { type }), filename);
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { Cookie: cookie }, body: form });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
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

function gtin13(n) {
  const body = String(871000000000 + n).padStart(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

function csv(rows) {
  return rows.map((r) => r.join(";")).join("\n");
}

async function runImport(baseUrl, cookie, id) {
  let job;
  let calls = 0;
  for (;;) {
    const res = await request(baseUrl, "POST", `/api/products/import/${id}/run`, { cookie });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    job = res.data;
    calls += 1;
    if (job.done) break;
    assert.ok(calls < 100, "import moet eindigen");
  }
  return { job, calls };
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

  await t.test("import: 10 rijen, duplicaten (skip/update/create), ongeldige data en foutrapport", async () => {
    const header = ["Artikelnummer", "Naam", "EAN", "Producent", "Land", "Recycled %", "CO2", "Recyclebaar", "Product type"];
    const rows = Array.from({ length: 10 }, (_, i) => [`IMP-${i}`, `Import ${i}`, gtin13(i), "Fab BV", "NL", "35", "12,5", "ja", "x"]);
    rows.push(["IMP-0", "Dubbel in bestand", "", "", "", "", "", "", ""]);
    rows.push(["IMP-BAD", "", "123", "", "", "150", "abc", "misschien", ""]);
    const up = await upload(baseUrl, "/api/products/import", a, "producten.csv", csv([header, ...rows]));
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.deepEqual(up.data.column_mapping.slice(0, 8), ["sku", "name", "gtin", "manufacturer", "country_of_origin", "recycled_material_percentage", "carbon_footprint_kg", "recyclable"]);
    assert.equal(up.data.column_mapping[8], null, "onbekende kolom blijft ongekoppeld");
    assert.equal(up.data.total_rows, 12);

    // Tenant B ziet deze import niet.
    assert.equal((await request(baseUrl, "GET", `/api/products/import/${up.data.id}`, { cookie: b })).status, 404);
    assert.equal((await request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: b })).status, 404);
    // Eerst valideren, dan pas importeren.
    assert.equal((await request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: a })).status, 409);

    const val = await request(baseUrl, "POST", `/api/products/import/${up.data.id}/validate`, { cookie: a, body: { columnMapping: up.data.column_mapping, duplicateStrategy: "skip" } });
    assert.equal(val.status, 200, JSON.stringify(val.data));
    assert.equal(val.data.summary.total, 12);
    assert.equal(val.data.summary.errors, 2);
    assert.equal(val.data.summary.toCreate, 10);
    const issues = val.data.issues.map((i) => `${i.row}:${i.field}`);
    assert.ok(issues.includes("12:sku"), "dubbele SKU in bestand");
    assert.ok(issues.includes("13:name") && issues.includes("13:gtin") && issues.includes("13:recycled_material_percentage") && issues.includes("13:recyclable"));

    const { job } = await runImport(baseUrl, a, up.data.id);
    assert.equal(job.status, "completed");
    assert.equal(job.created_count, 10);
    assert.equal(job.error_count, 2);

    const imported = await request(baseUrl, "GET", "/api/products?q=IMP-3", { cookie: a });
    const p = imported.data.items[0];
    assert.equal(p.gtin, gtin13(3));
    assert.equal(p.manufacturer, "Fab BV");
    assert.equal(p.status, "draft", "import publiceert nooit");
    const sus = await request(baseUrl, "GET", `/api/products/${p.id}/sustainability`, { cookie: a });
    assert.equal(sus.data.recycled_material_pct, 35);
    assert.equal(sus.data.co2_footprint_kg, 12.5);
    assert.equal(sus.data.recyclable, true);

    const report = await binary(baseUrl, "GET", `/api/products/import/${up.data.id}/errors.csv`, a);
    assert.equal(report.status, 200);
    assert.match(report.buffer.toString("utf8"), /Rij;Product;Veld;Ernst;Fout;Suggestie/);

    // Tweede import: zelfde SKU's → skip, update en create.
    const second = [["sku", "product_name", "brand"], ["IMP-1", "Nieuwe naam", "Merk X"], ["IMP-NEW", "Nieuw", ""]];
    for (const [strategy, expect] of [["skip", { created: 1, updated: 0, skipped: 1 }], ["update", { created: 0, updated: 2, skipped: 0 }], ["create", { created: 2, updated: 0, skipped: 0 }]]) {
      const job2 = await upload(baseUrl, "/api/products/import", a, `tweede-${strategy}.csv`, csv(second));
      const v = await request(baseUrl, "POST", `/api/products/import/${job2.data.id}/validate`, { cookie: a, body: { columnMapping: job2.data.column_mapping, duplicateStrategy: strategy } });
      assert.equal(v.status, 200);
      const { job: done } = await runImport(baseUrl, a, job2.data.id);
      assert.deepEqual({ created: done.created_count, updated: done.updated_count, skipped: done.skipped_count }, expect, strategy);
    }
    const updated = await request(baseUrl, "GET", "/api/products?q=Nieuwe%20naam", { cookie: a });
    assert.equal(updated.data.items[0].brand, "Merk X");
    assert.equal(updated.data.items[0].gtin, gtin13(1), "lege cellen wissen niets");

    // Import Center-lijst is tenant-gebonden.
    const listA = await request(baseUrl, "GET", "/api/products/import", { cookie: a });
    const listB = await request(baseUrl, "GET", "/api/products/import", { cookie: b });
    assert.ok(listA.data.total >= 4);
    assert.equal(listB.data.total, 0);
  });

  await t.test("import: 251 rijen in 2 chunks, hervatten na onderbreking zonder dubbele verwerking", async () => {
    const rows = [["sku", "product_name"], ...Array.from({ length: 251 }, (_, i) => [`CH-${i}`, `Chunk ${i}`])];
    const up = await upload(baseUrl, "/api/products/import", a, "chunks.csv", csv(rows));
    await request(baseUrl, "POST", `/api/products/import/${up.data.id}/validate`, { cookie: a, body: { columnMapping: up.data.column_mapping, duplicateStrategy: "skip" } });
    const before = await productCount(companyA);

    // Eerste chunk, dan "refresh": status opnieuw ophalen en verder.
    const first = await request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: a });
    assert.equal(first.data.processed_rows, 250);
    assert.equal(first.data.done, false);
    const state = await request(baseUrl, "GET", `/api/products/import/${up.data.id}`, { cookie: a });
    assert.equal(state.data.status, "importing");
    // Twee gelijktijdige aanroepen (dubbelklik/twee tabbladen) mogen niets dubbel doen.
    const [r1, r2] = await Promise.all([
      request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: a }),
      request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: a })
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const done = await request(baseUrl, "GET", `/api/products/import/${up.data.id}`, { cookie: a });
    assert.equal(done.data.status, "completed");
    assert.equal(done.data.created_count, 251);
    assert.equal(done.data.current_chunk, 2);
    assert.equal((await productCount(companyA)) - before, 251);
    // Na afronden: geen verwerking meer.
    const after = await request(baseUrl, "POST", `/api/products/import/${up.data.id}/run`, { cookie: a });
    assert.equal(after.data.done, true);
    assert.equal((await productCount(companyA)) - before, 251);
  });

  await t.test("import: 1.000+ rijen via xlsx en .xls; productlimiet wordt gerespecteerd", async () => {
    const aoa = [["Productnaam", "SKU", "GTIN"], ...Array.from({ length: 1001 }, (_, i) => [`Groot ${i}`, `BIG-${i}`, Number(gtin13(5000 + i))])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Producten");
    const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const up = await upload(baseUrl, "/api/products/import", a, "groot.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.equal(up.data.total_rows, 1001);
    assert.equal(up.data.sample[0][2], gtin13(5000), "13-cijferige GTIN zonder wetenschappelijke notatie");
    await request(baseUrl, "POST", `/api/products/import/${up.data.id}/validate`, { cookie: a, body: { columnMapping: up.data.column_mapping, duplicateStrategy: "skip" } });
    const { job, calls } = await runImport(baseUrl, a, up.data.id);
    assert.equal(job.created_count, 1001);
    assert.equal(calls, 5);

    const xls = XLSX.write(wb, { type: "buffer", bookType: "biff8" });
    const upXls = await upload(baseUrl, "/api/products/import", a, "oud.xls", xls, "application/vnd.ms-excel");
    assert.equal(upXls.status, 201, JSON.stringify(upXls.data));
    assert.equal(upXls.data.file_type, "xls");
    // Hernoemd bestand (inhoud past niet bij de extensie) wordt geweigerd.
    assert.equal((await upload(baseUrl, "/api/products/import", a, "nep.xlsx", "a;b\n1;2")).status, 400);

    // Productlimiet: plan met max 2 extra producten.
    const pool = await getPool();
    const plan = await pool.request().query("INSERT INTO dbo.Plans (name, max_users, max_products) VALUES ('UX import plan', 10, 1) RETURNING id");
    const planId = plan.recordset[0].id;
    await pool.request().input("c", sql.Int, companyB).input("p", sql.Int, planId).query("UPDATE dbo.Companies SET plan_id = @p WHERE id = @c");
    try {
      const upB = await upload(baseUrl, "/api/products/import", b, "limiet.csv", csv([["product_name"], ["L1"], ["L2"], ["L3"]]));
      const v = await request(baseUrl, "POST", `/api/products/import/${upB.data.id}/validate`, { cookie: b, body: { columnMapping: upB.data.column_mapping, duplicateStrategy: "skip" } });
      assert.equal(v.data.blocking.length, 1);
      const { job: limited } = await runImport(baseUrl, b, upB.data.id);
      assert.equal(limited.created_count, 0, "B had al 1 product; limiet 1");
      assert.equal(limited.error_count, 3);
    } finally {
      await pool.request().input("c", sql.Int, companyB).query("UPDATE dbo.Companies SET plan_id = NULL WHERE id = @c");
      await pool.request().input("p", sql.Int, planId).query("DELETE FROM dbo.Plans WHERE id = @p");
    }

    const template = await binary(baseUrl, "GET", "/api/products/import/template.xlsx", a);
    assert.equal(template.status, 200);
    const tpl = XLSX.read(template.buffer, { type: "buffer" });
    assert.deepEqual(tpl.SheetNames, ["Producten", "Instructies"]);
  });

  await t.test("print: profielen tenant-gebonden, alleen beheerder beheert, leesbaarheid blokkeert", async () => {
    const options = await request(baseUrl, "GET", "/api/print/options", { cookie: u });
    assert.equal(options.status, 200);
    const settings = options.data.presets[0].settings;
    assert.equal((await request(baseUrl, "POST", "/api/print/profiles", { cookie: u, body: { name: "x", settings } })).status, 403);
    const created = await request(baseUrl, "POST", "/api/print/profiles", { cookie: a, body: { name: "A4 3x8", isDefault: true, settings } });
    assert.equal(created.status, 201);
    const second = await request(baseUrl, "POST", "/api/print/profiles", { cookie: a, body: { name: "Tweede", isDefault: true, settings } });
    const list = await request(baseUrl, "GET", "/api/print/profiles", { cookie: u });
    assert.equal(list.data.filter((p) => p.is_default).length, 1, "maar één standaardprofiel");
    assert.equal(list.data.find((p) => p.is_default).id, second.data.id);
    assert.equal((await request(baseUrl, "GET", "/api/print/profiles", { cookie: b })).data.length, 0);
    assert.equal((await request(baseUrl, "PUT", `/api/print/profiles/${created.data.id}`, { cookie: b, body: { name: "hack", settings } })).status, 404);
    assert.equal((await request(baseUrl, "DELETE", `/api/print/profiles/${created.data.id}`, { cookie: b })).status, 404);
    assert.equal((await request(baseUrl, "POST", "/api/print/summary", { cookie: b, body: { profileId: created.data.id } })).status, 404);

    const summary = await request(baseUrl, "POST", "/api/print/summary", { cookie: a, body: { profileId: created.data.id, productCount: 1000 } });
    assert.equal(summary.data.perPage, 24);
    assert.equal(summary.data.pages, 42);
    assert.deepEqual(summary.data.errors, []);

    const tiny = await request(baseUrl, "POST", "/api/print/summary", { cookie: a, body: { settings: { ...settings, qr: { ...settings.qr, sizeMm: 8, quietZoneModules: 0, color: "#EEEEEE" } } } });
    assert.ok(tiny.data.errors.length >= 3, JSON.stringify(tiny.data.errors));
    const invalid = await request(baseUrl, "POST", "/api/print/profiles", { cookie: a, body: { name: "x", settings: { paper: "custom" } } });
    assert.equal(invalid.status, 400);
  });

  await t.test("print: labels-PDF 1, 10 en 500 producten; 501 geweigerd; vector-QR; ZIP png/svg; tenant-isolatie", async () => {
    const ids = (await request(baseUrl, "POST", "/api/products/bulk/resolve", { cookie: a, body: { selection: { filter: { q: "BIG-" } } } })).data.ids;
    assert.ok(ids.length >= 1001);
    for (const n of [1, 10, 500]) {
      const pdf = await binary(baseUrl, "POST", "/api/print/labels.pdf", a, { presetKey: "a4-3x8", ids: ids.slice(0, n), generateMissing: true });
      assert.equal(pdf.status, 200, n === 1 ? pdf.buffer.toString() : "");
      assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
      assert.equal(pdf.headers.get("x-labels-count"), String(n));
      assert.ok(pdf.buffer.length < 4.5 * 1024 * 1024, `PDF van ${n} labels < 4,5 MB (${pdf.buffer.length})`);
      const pages = (pdf.buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
      assert.equal(pages, Math.ceil(n / 24));
      if (n === 1) assert.ok(!pdf.buffer.toString("latin1").includes("/Subtype /Image"), "QR als vector, geen afbeelding");
    }
    assert.equal((await binary(baseUrl, "POST", "/api/print/labels.pdf", a, { presetKey: "a4-3x8", ids: ids.slice(0, 501) })).status, 400);
    for (const preset of ["a5-1x1", "label-62x29", "qr-only-4x6", "a4-2x7"]) {
      const pdf = await binary(baseUrl, "POST", "/api/print/labels.pdf", a, { presetKey: preset, ids: ids.slice(0, 3) });
      assert.equal(pdf.status, 200, preset);
    }
    // Onleesbare instellingen: geblokkeerd.
    const blocked = await binary(baseUrl, "POST", "/api/print/labels.pdf", a, { settings: { paper: "A4", layout: "3x8", qr: { sizeMm: 6 } }, ids: ids.slice(0, 1) });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json().error.code, "PRINT_UNREADABLE");
    // Producten van tenant A via tenant B: niets.
    const other = await binary(baseUrl, "POST", "/api/print/labels.pdf", b, { presetKey: "a4-3x8", ids: ids.slice(0, 5), generateMissing: true });
    assert.equal(other.status, 400);
    const otherZip = await binary(baseUrl, "POST", "/api/print/qr.zip", b, { ids: ids.slice(0, 5), format: "svg" });
    assert.equal(otherZip.status, 400);

    const zip = await binary(baseUrl, "POST", "/api/print/qr.zip", a, { ids: ids.slice(0, 20), format: "png", sizePx: 600 });
    assert.equal(zip.status, 200);
    assert.equal(zip.buffer.subarray(0, 2).toString(), "PK");
    assert.equal(zip.headers.get("x-files-count"), "20");
    const svgZip = await binary(baseUrl, "POST", "/api/print/qr.zip", a, { ids: ids.slice(0, 1000), format: "svg" });
    assert.equal(svgZip.status, 200);
    assert.ok(svgZip.buffer.length < 4.5 * 1024 * 1024);
    assert.equal((await binary(baseUrl, "POST", "/api/print/qr.zip", a, { ids: ids.slice(0, 501), format: "png" })).status, 400);
    const preview = await binary(baseUrl, "POST", "/api/print/preview.pdf", u, { presetKey: "a4-3x8" });
    assert.equal(preview.status, 200);
  });

  await t.test("zoeken, meldingen, dashboard en QR-statistieken zijn tenant-gebonden", async () => {
    const searchA = await request(baseUrl, "GET", "/api/search?q=UX-1", { cookie: a });
    const productsA = searchA.data.groups.find((g) => g.type === "products");
    assert.ok(productsA.items.length >= 1);
    assert.ok(productsA.items.every((i) => i.href.startsWith("/company/products/")));
    assert.ok(!productsA.items.some((i) => i.id === productB));
    const searchB = await request(baseUrl, "GET", "/api/search?q=Import", { cookie: b });
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
    assert.ok(notes.data.items.some((n) => n.id.startsWith("import:")));
    assert.ok(!(await request(baseUrl, "GET", "/api/dashboard/notifications", { cookie: b })).data.items.some((n) => /producten.csv|chunks.csv|groot.xlsx/.test(n.title)), "B ziet geen imports van A");
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
    assert.ok(res.data.imports.length >= 1);
    assert.equal(res.data.company.logo, undefined, "geen logo-blob in de response");
  });
});
