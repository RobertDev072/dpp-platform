const test = require("node:test");
const assert = require("node:assert/strict");
const { unzipSync, strFromU8 } = require("fflate");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const guide = require("../lib/instancesGuide");

// Tabblad "Batches & exemplaren": wanneer de knoppen uit staan, welke meldingen er komen,
// de bevestigingsteksten, en de ZIP met QR-codes voor de drukker.

test("knoppen uit en gele melding zolang het product niet gepubliceerd is", () => {
  const draft = guide.instanceGuide({ published_at: null, gtin: "8712345678906" });
  assert.equal(draft.canCreate, false, "Batch toevoegen en Exemplaren aanmaken uitgeschakeld");
  assert.deepEqual(draft.notices.map((n) => [n.key, n.tone]), [["not-published", "warning"]]);
  assert.equal(draft.notices[0].text, "Publiceer eerst je product. Pas daarna werken de QR-codes van batches en exemplaren.");

  const published = guide.instanceGuide({ published_at: "2026-10-01T10:00:00Z", gtin: "8712345678906" });
  assert.equal(published.canCreate, true);
  assert.deepEqual(published.notices, []);
});

test("blauwe melding bij een ontbrekende GTIN", () => {
  for (const gtin of [null, "", "   "]) {
    const result = guide.instanceGuide({ published_at: "2026-10-01T10:00:00Z", gtin });
    assert.equal(result.canCreate, true, "zonder GTIN werkt het wel");
    assert.deepEqual(result.notices.map((n) => [n.key, n.tone]), [["no-gtin", "info"]]);
    assert.equal(
      result.notices[0].text,
      "Je product heeft geen GTIN (barcode-nummer). Je codes werken wel, maar krijgen geen officieel GS1-adres. Voor batterijen en de meeste winkels heb je een GTIN nodig. Die vraag je aan bij GS1 Nederland."
    );
  }
  assert.deepEqual(guide.instanceGuide({ published_at: null, gtin: null }).notices.map((n) => n.key), ["not-published", "no-gtin"]);
});

test("bevestigingsvenster vóór aanmaken: aantal en tekst", () => {
  assert.equal(guide.plannedItemCount({ mode: "generate", count: "25" }), 25);
  assert.equal(guide.plannedItemCount({ mode: "generate", count: "" }), 0);
  assert.equal(guide.plannedItemCount({ mode: "list", list: "A1\nA2, A2;A3\n\n" }), 3, "dubbele nummers tellen één keer");
  assert.equal(
    guide.itemsConfirmMessage(25),
    "Je maakt 25 exemplaren aan. Elk krijgt een eigen QR-code die direct online staat en nooit verandert. Doorgaan?"
  );
  assert.match(guide.itemsConfirmMessage(1), /^Je maakt 1 exemplaar aan\./);
  assert.equal(guide.BATCH_CONFIRM, "Je maakt een batch aan met een eigen QR-code die direct online staat. Doorgaan?");
  assert.equal(guide.itemsCreatedMessage(25), "25 exemplaren aangemaakt en online. Download de QR-codes voor je drukker.");
});

test("ZIP met QR-codes van (net aangemaakte) exemplaren", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("Drukker A");
  const companyB = await createTestCompany("Drukker B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const product = await createTestProduct({ companyId: companyA, name: "E-bike Volt" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const login = async (user) => (await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } })).cookie;
  const cookieA = await login(adminA);
  const cookieB = await login(adminB);
  await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA });
  const zip = (cookie, query = "") => fetch(`${baseUrl}/api/products/${product}/items/qr.zip${query}`, { headers: { Cookie: cookie } });

  assert.equal((await zip(cookieA)).status, 404, "nog geen exemplaren");

  const first = await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { serials: ["SN-1", "SN-2"] } });
  assert.equal(first.status, 201);
  assert.match(first.data.since, /^\d{4}-\d{2}-\d{2}T/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { generate: { count: 3, prefix: "SN-", start: 10, digits: 3 } } });
  assert.equal(second.data.created, 3);

  const all = await zip(cookieA);
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("content-type"), "application/zip");
  const allFiles = unzipSync(new Uint8Array(await all.arrayBuffer()));
  assert.deepEqual(Object.keys(allFiles).sort(), ["qr-SN-010.svg", "qr-SN-011.svg", "qr-SN-012.svg", "qr-SN-1.svg", "qr-SN-2.svg"]);
  assert.match(strFromU8(allFiles["qr-SN-1.svg"]), /<svg/);

  const fresh = unzipSync(new Uint8Array(await (await zip(cookieA, `?createdAfter=${encodeURIComponent(second.data.since)}`)).arrayBuffer()));
  assert.deepEqual(Object.keys(fresh).sort(), ["qr-SN-010.svg", "qr-SN-011.svg", "qr-SN-012.svg"], "alleen de net aangemaakte");

  assert.equal((await zip(cookieB)).status, 404, "ander bedrijf");
  assert.equal((await zip(cookieA, "?createdAfter=gisteren")).status, 400);
});
