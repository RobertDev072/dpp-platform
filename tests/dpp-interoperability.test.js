const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const gs1 = require("../src/utils/gs1");
const { validateOperatorId } = require("../src/utils/operatorId");
const { readDomainConfig, routeDomain } = require("../src/utils/domainRouting");

// DPP-header en interoperabiliteit: identificatie (GS1 Digital Link, marktdeelnemer),
// meertaligheid, dictionaryReference per dataveld, RelatedResource, en permanentie van
// public_id in de database.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

// Geldige testwaarden met kloppende controlecijfers.
function validLei(prefix18) {
  const digits = `${prefix18}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return `${prefix18}${String(98 - r).padStart(2, "0")}`;
}
function validGtin13(prefix12) {
  let sum = 0;
  const padded = prefix12.padStart(13, "0");
  for (let i = 0; i < 13; i += 1) sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

test("GS1 en marktdeelnemer: controlecijfers en Digital Link", () => {
  const gtin = validGtin13("871234567890");
  assert.equal(gs1.isValidGtin(gtin), true);
  assert.equal(gs1.isValidGtin(gtin.slice(0, -1) + ((Number(gtin.at(-1)) + 1) % 10)), false);
  assert.equal(gs1.digitalLink({ gtin }), `https://id.gs1.org/01/0${gtin}`);
  assert.equal(gs1.digitalLink({ gtin, lot: "L-42", serial: "S/1" }), `https://id.gs1.org/01/0${gtin}/10/L-42/21/S%2F1`);
  assert.equal(gs1.digitalLink({ gtin: "123" }), null);

  const lei = validLei("5493001KJTIIGC8Y1R");
  assert.equal(validateOperatorId("lei", lei), null);
  assert.match(validateOperatorId("lei", `${lei.slice(0, -1)}${(Number(lei.at(-1)) + 1) % 10}`), /Ongeldige LEI/);
  assert.match(validateOperatorId("gln", "1234567890123"), /Ongeldige GLN/);
  assert.equal(validateOperatorId("kvk", "12345678"), null);
});

test("domeinen: GS1-links en vocabulaire horen op het QR-domein", () => {
  const config = readDomainConfig({ APP_DOMAIN: "app.example.nl", QR_DOMAIN: "qr.example.nl", SITE_DOMAINS: "example.nl" });
  assert.equal(routeDomain({ host: "qr.example.nl", path: "/01/08712345678906" }, config), null);
  assert.equal(routeDomain({ host: "qr.example.nl", path: "/vocab/dpp" }, config), null);
  assert.equal(routeDomain({ host: "app.example.nl", path: "/01/08712345678906" }, config).location, "https://qr.example.nl/01/08712345678906");
});

test("DPP-header, meertaligheid, dictionaryReference en permanente public_id", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const companyA = await createTestCompany("Interop A");
  const companyB = await createTestCompany("Interop B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const product = await createTestProduct({ companyId: companyA, name: "Stoel Aurora" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, userA.id, adminB.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieUserA = await login(baseUrl, userA);
  const cookieB = await login(baseUrl, adminB);
  const lei = validLei("724500VKKSH9QOLTFR");
  const gtin = validGtin13("871234567890");
  let publicId;

  await t.test("marktdeelnemer-id: alleen beheerder, formaat gecontroleerd", async () => {
    const bad = await request(baseUrl, "PATCH", "/api/company", { cookie: cookieA, body: { economicOperatorIdScheme: "lei", economicOperatorId: "ABC" } });
    assert.equal(bad.status, 400);
    const employee = await request(baseUrl, "PATCH", "/api/company", { cookie: cookieUserA, body: { economicOperatorIdScheme: "lei", economicOperatorId: lei } });
    assert.equal(employee.status, 403);
    const ok = await request(baseUrl, "PATCH", "/api/company", { cookie: cookieA, body: { economicOperatorIdScheme: "lei", economicOperatorId: lei.toLowerCase() } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.economic_operator_id, lei, "genormaliseerd naar hoofdletters");
    assert.equal(ok.data.economic_operator_id_scheme, "lei");
  });

  await t.test("product: taal, vestiging, specificaties, vertaling", async () => {
    const patch = await request(baseUrl, "PATCH", `/api/products/${product}`, {
      cookie: cookieA,
      body: {
        gtin,
        description: "Een stevige stoel.",
        language: "nl-NL",
        facilityId: "8712345000004",
        contentSpecificationIds: ["Verordening (EU) 2024/1781", "EN 18223:2026"]
      }
    });
    assert.equal(patch.status, 200);
    assert.equal((await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { language: "Dutch" } })).status, 400);

    const tr = await request(baseUrl, "PUT", `/api/products/${product}/translations/en-GB`, {
      cookie: cookieA,
      body: { name: "Aurora chair", description: "A sturdy chair." }
    });
    assert.equal(tr.status, 200);
    assert.equal((await request(baseUrl, "PUT", `/api/products/${product}/translations/nl-NL`, { cookie: cookieA, body: { name: "x" } })).status, 400, "basistaal niet als vertaling");
    assert.equal((await request(baseUrl, "PUT", `/api/products/${product}/translations/english`, { cookie: cookieA, body: { name: "x" } })).status, 400);
    assert.equal((await request(baseUrl, "PUT", `/api/products/${product}/translations/de-DE`, { cookie: cookieB, body: { name: "x" } })).status, 404, "ander bedrijf");
    const list = await request(baseUrl, "GET", `/api/products/${product}/translations`, { cookie: cookieUserA });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.translations.map((x) => x.language), ["en-GB"]);

    const pub = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA });
    assert.equal(pub.status, 200);
    publicId = String(pub.data.public_id).toLowerCase();
  });

  await t.test("JSON: DPP-header met verplichte velden", async () => {
    const res = await fetch(`${baseUrl}/api/dpp/${publicId}`, { headers: { Accept: "application/json" } });
    assert.equal(res.status, 200);
    const dpp = await res.json();
    assert.equal(dpp.digitalProductPassportId, `urn:uuid:${publicId}`);
    assert.equal(dpp.uniqueProductIdentifier, `https://id.gs1.org/01/0${gtin}`);
    assert.equal(dpp.granularity, "model");
    assert.equal(dpp.dppSchemaVersion, "1.0.0");
    assert.equal(dpp.dppStatus, "Active");
    assert.match(dpp.lastUpdated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    assert.equal(dpp.economicOperatorId, lei);
    assert.equal(dpp.economicOperatorIdScheme, "lei");
    assert.equal(dpp.facilityId, "8712345000004");
    assert.deepEqual(dpp.contentSpecificationIds, ["Verordening (EU) 2024/1781", "EN 18223:2026"]);
    assert.equal(dpp.identifiers.gs1DigitalLink, `https://id.gs1.org/01/0${gtin}`);
    // Bestaande velden blijven bestaan (achterwaarts compatibel).
    assert.equal(dpp.identifiers.passportId, publicId);
    assert.equal(dpp.passportGranularity, "model");
  });

  await t.test("JSON: meertalige naam en dictionaryReference per dataveld", async () => {
    const dpp = await (await fetch(`${baseUrl}/api/dpp/${publicId}`, { headers: { Accept: "application/json" } })).json();
    assert.deepEqual(dpp.product.nameMultiLanguage, [
      { language: "nl-NL", value: dpp.product.name },
      { language: "en-GB", value: "Aurora chair" }
    ]);
    const name = dpp.dataElements.find((e) => e.elementId === "product.name");
    assert.equal(name.type, "MultiLanguageDataElement");
    assert.equal(name.dictionaryReference, "https://schema.org/name");
    assert.equal(name.value.length, 2);
    assert.ok(dpp.dataElements.length >= 3);
    for (const el of dpp.dataElements) assert.match(el.dictionaryReference, /^https?:\/\//, `${el.elementId} heeft een woordenboekverwijzing`);
    assert.ok(Array.isArray(dpp.relatedResources));
  });

  await t.test("XML en JSON-LD bevatten dezelfde header", async () => {
    const xml = await (await fetch(`${baseUrl}/api/dpp/${publicId}`, { headers: { Accept: "application/xml" } })).text();
    assert.match(xml, /<dppSchemaVersion>1\.0\.0<\/dppSchemaVersion>/);
    assert.match(xml, /<economicOperatorId>/);
    const ld = await (await fetch(`${baseUrl}/api/dpp/${publicId}`, { headers: { Accept: "application/ld+json" } })).json();
    assert.equal(ld.dppStatus, "Active");
    assert.equal(ld["@type"], "DigitalProductPassport");
  });

  await t.test("archief: een vertaling wordt een nieuwe paspoortversie", async () => {
    const before = (await request(baseUrl, "GET", `/api/products/${product}/versions`, { cookie: cookieA })).data.versions.length;
    const tr = await request(baseUrl, "PUT", `/api/products/${product}/translations/de-DE`, { cookie: cookieA, body: { name: "Stuhl Aurora" } });
    assert.equal(tr.status, 200);
    const after = (await request(baseUrl, "GET", `/api/products/${product}/versions`, { cookie: cookieA })).data.versions.length;
    assert.equal(after, before + 1);
  });

  await t.test("permanentie: de database weigert het wijzigen van een gezette public_id", async () => {
    await assert.rejects(
      pool.query("UPDATE dbo.products SET public_id = gen_random_uuid() WHERE id = $1", [product]),
      /permanent/
    );
    await assert.rejects(pool.query("UPDATE dbo.products SET public_id = NULL WHERE id = $1", [product]), /permanent/);
    // Andere velden wijzigen blijft gewoon mogelijk.
    await pool.query("UPDATE dbo.products SET updated_at = now() WHERE id = $1", [product]);
  });
});
