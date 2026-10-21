const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const { verificationExpiry } = require("../lib/euVerification");
const { productGroup } = require("../lib/productGroups");

// Productgroep per product (bepaalt of aanmelden bij het EU-register aan de orde is) en
// de geldigheid van de EU-verificatie met herinnering 60 dagen vooraf.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

const isoDaysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test("verificatietermijn: vroegste van zegel en 3 jaar na verificatie", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  assert.equal(verificationExpiry({}, now), null);
  const bySeal = verificationExpiry({ verifiedAt: "2026-01-10", sealExpiresAt: "2027-03-01" }, now);
  assert.deepEqual([bySeal.expiresOn, bySeal.reason], ["2027-03-01", "vervaldatum van het zegel"]);
  const byCap = verificationExpiry({ verifiedAt: "2024-01-10", sealExpiresAt: "2030-01-01" }, now);
  assert.deepEqual([byCap.expiresOn, byCap.reason], ["2027-01-10", "3 jaar na de verificatie"]);
  assert.equal(byCap.remind, false, "81 dagen: nog geen herinnering");
  assert.equal(verificationExpiry({ sealExpiresAt: "2026-12-20" }, now).remind, true, "60 dagen of minder: herinneren");
  assert.equal(verificationExpiry({ verifiedAt: "2023-10-01" }, now).expired, true);
  assert.equal(productGroup("nonsens").key, "unknown");
  assert.equal(productGroup("battery").registryOpen, true);
  assert.equal(productGroup("textile").registryOpen, false);
});

test("productgroep en EU-verificatie via de API", async (t) => {
  // Het register eist https; zonder https-QR-domein keurt de controle het overzicht terecht af.
  const previousQrBase = process.env.QR_BASE_URL;
  process.env.QR_BASE_URL = "https://qr.example.test";
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const company = await createTestCompany("Productgroep");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const user = await createTestUser({ companyId: company, role: "company_user" });
  const product = await createTestProduct({ companyId: company, name: "Fietsaccu Ion" });
  const created = [product];

  t.after(async () => {
    if (previousQrBase === undefined) delete process.env.QR_BASE_URL;
    else process.env.QR_BASE_URL = previousQrBase;
    await cleanupTestData({ companyIds: [company], userIds: [admin.id, user.id], productIds: created });
    await stopTestServer(server);
    await sql.close();
  });

  const cookie = await login(baseUrl, admin);
  const cookieUser = await login(baseUrl, user);

  await t.test("standaard 'nog niet bekend'; alleen geldige groepen", async () => {
    const current = await request(baseUrl, "GET", `/api/products/${product}`, { cookie });
    assert.equal(current.data.product_group, "unknown");
    assert.equal((await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { productGroup: "fruit" } })).status, 400);
    const res = await request(baseUrl, "POST", "/api/products", { cookie, body: { name: "Bank Sofa", productGroup: "furniture" } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.product_group, "furniture");
    created.push(res.data.id);
  });

  await t.test("productgroep wijzigen maakt geen nieuwe paspoortversie", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { gtin: "8712345678906", model: "ION-500" } });
    const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    const count = async () => Number((await pool.query("SELECT count(*) FROM dbo.passportversions WHERE product_id = $1", [product])).rows[0].count);
    const before = await count();
    const res = await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { productGroup: "battery" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.product_group, "battery");
    assert.equal(await count(), before);
  });

  await t.test("registratiegegevens en overzicht bevatten de productgroep", async () => {
    const reg = await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie });
    assert.equal(reg.data.productGroup, "battery");
    assert.equal(reg.data.record.productGroup, "Batteries");
    assert.equal(reg.data.euVerification, null);
    const csv = await (await fetch(`${baseUrl}/api/products/${product}/registration/records?granularity=model`, { headers: { Cookie: cookie } })).text();
    const [header, row] = csv.trim().split("\r\n");
    assert.equal(header.split(",")[0], "productGroup");
    assert.equal(row.split(",")[0], "Batteries");
  });

  await t.test("verificatiedatums: alleen de beheerder, herinnering 60 dagen vooraf", async () => {
    const notifications = async (c) => (await request(baseUrl, "GET", "/api/dashboard/notifications", { cookie: c })).data.items;
    assert.ok(!(await notifications(cookie)).some((i) => i.id.startsWith("eu-verification:")), "zonder datums geen melding");
    assert.equal((await request(baseUrl, "PATCH", "/api/company", { cookie: cookieUser, body: { euSealExpiresAt: isoDaysFromNow(30) } })).status, 403);
    assert.equal((await request(baseUrl, "PATCH", "/api/company", { cookie, body: { euSealExpiresAt: "31-12-2027" } })).status, 400);

    const far = await request(baseUrl, "PATCH", "/api/company", { cookie, body: { euVerifiedAt: isoDaysFromNow(-10), euSealExpiresAt: isoDaysFromNow(400) } });
    assert.equal(far.status, 200, JSON.stringify(far.data));
    assert.ok(!(await notifications(cookie)).some((i) => i.id.startsWith("eu-verification:")), "nog ver weg: geen melding");

    await request(baseUrl, "PATCH", "/api/company", { cookie, body: { euSealExpiresAt: isoDaysFromNow(30) } });
    const soon = (await notifications(cookie)).find((i) => i.id.startsWith("eu-verification:"));
    assert.ok(soon, "melding binnen 60 dagen");
    assert.equal(soon.severity, "warning");
    assert.equal(soon.href, "/company/instellingen");
    const forUser = (await notifications(cookieUser)).find((i) => i.id.startsWith("eu-verification:"));
    assert.equal(forUser.href, null, "medewerker ziet de melding zonder link naar beheer");

    const reg = await request(baseUrl, "GET", `/api/products/${product}/registration`, { cookie });
    assert.equal(reg.data.euVerification.expiresOn, isoDaysFromNow(30));

    await request(baseUrl, "PATCH", "/api/company", { cookie, body: { euVerifiedAt: isoDaysFromNow(-3 * 365 - 5), euSealExpiresAt: null } });
    const expired = (await notifications(cookie)).find((i) => i.id.startsWith("eu-verification:"));
    assert.equal(expired.severity, "error");
    assert.match(expired.title, /verlopen/);
  });
});
