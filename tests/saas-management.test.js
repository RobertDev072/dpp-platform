const test = require("node:test");
const assert = require("node:assert/strict");
const { closePool, query, queryOne } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("documentbeheer, sessies, Customer 360, abonnementen en partnerdashboard", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const partnerCo = await createTestCompany("SaaS Partner");
  await query("UPDATE companies SET kind = 'partner' WHERE id = $1", [partnerCo]);
  const companyA = await createTestCompany("SaaS A");
  const companyB = await createTestCompany("SaaS B");
  const plan = await queryOne(
    "INSERT INTO plans (name, max_users, max_products, price_monthly_cents, max_storage_mb, max_scans_month) VALUES ($1, 10, 2, 14900, 1, 100) RETURNING id",
    [`Test Professional ${Date.now()}`]
  );
  await query("UPDATE companies SET partner_id = $1, plan_id = $2, notes = 'Intern: betaalt laat' WHERE id = $3", [partnerCo, plan.id, companyA]);

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const partner = await createTestUser({ companyId: partnerCo, role: "partner_admin" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const productA = await createTestProduct({ companyId: companyA, name: "Doc Product A" });
  const productB = await createTestProduct({ companyId: companyB, name: "Doc Product B" });
  await query("UPDATE products SET status = 'published', public_id = gen_random_uuid() WHERE id = $1", [productA]);

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB, partnerCo],
      userIds: [owner.id, partner.id, adminA.id, userA.id, adminB.id],
      productIds: [productA, productB]
    });
    await query("DELETE FROM plans WHERE id = $1", [plan.id]);
    await stopTestServer(server);
    await closePool();
  });

  let cOwner;
  let cPartner;
  let cAdminA;
  let cUserA;
  let cAdminB;

  await t.test("setup: inloggen zet last_login_at en registreert de browser", async () => {
    cOwner = await login(baseUrl, owner);
    cPartner = await login(baseUrl, partner);
    cAdminA = await login(baseUrl, adminA);
    cUserA = await login(baseUrl, userA);
    cAdminB = await login(baseUrl, adminB);
    const row = await queryOne("SELECT last_login_at FROM users WHERE id = $1", [userA.id]);
    assert.ok(row.last_login_at, "last_login_at gevuld");
  });

  // --- Documenten ---------------------------------------------------------
  let docExpired;
  let docValid;
  await t.test("documenten: versie, vervaldatum en uploader worden opgeslagen", async () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const a = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
      cookie: cUserA,
      body: { type: "link", title: "CE-verklaring", storageUrl: "https://example.com/ce.pdf", isPublic: true, version: "1.0", validUntil: past }
    });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(a.data.version, "1.0");
    assert.equal(a.data.uploaded_by, userA.id);
    docExpired = a.data.id;
    const b = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
      cookie: cAdminA,
      body: { type: "link", title: "Handleiding", storageUrl: "https://example.com/m.pdf", isPublic: true, validUntil: future }
    });
    assert.equal(b.status, 201);
    docValid = b.data.id;

    const list = await request(baseUrl, "GET", "/api/company/documents", { cookie: cAdminA });
    assert.equal(list.status, 200);
    const expired = list.data.find((d) => d.id === docExpired);
    assert.equal(expired.expiry_status, "expired");
    assert.ok(expired.uploader_email);
  });

  await t.test("documenten: verlopen document verschijnt als melding", async () => {
    const res = await request(baseUrl, "GET", "/api/workspace/notifications", { cookie: cAdminA });
    assert.ok(res.data.items.some((n) => n.id.startsWith("docs-expired-")));
  });

  await t.test("documenten: bulkactie van bedrijf B raakt documenten van A niet", async () => {
    const res = await request(baseUrl, "POST", "/api/company/documents/bulk", {
      cookie: cAdminB,
      body: { action: "archive", ids: [docExpired, docValid] }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.affected, 0);
    const links = await request(baseUrl, "POST", "/api/company/documents/download-links", { cookie: cAdminB, body: { ids: [docExpired] } });
    assert.equal(links.status, 200);
    assert.equal(links.data.items.length, 0);
  });

  await t.test("documenten: PATCH via product van ander bedrijf geeft 403/404", async () => {
    const res = await request(baseUrl, "PATCH", `/api/products/${productA}/documents/${docValid}`, {
      cookie: cAdminB,
      body: { title: "Overgenomen" }
    });
    assert.ok([403, 404].includes(res.status));
    const viaOwnProduct = await request(baseUrl, "PATCH", `/api/products/${productB}/documents/${docValid}`, {
      cookie: cAdminB,
      body: { title: "Overgenomen" }
    });
    assert.equal(viaOwnProduct.status, 404, "document hoort niet bij dit product");
  });

  await t.test("documenten: archiveren haalt het van het paspoort en uit de compleetheid", async () => {
    const before = await request(baseUrl, "GET", `/api/products/${productA}/completeness`, { cookie: cAdminA });
    assert.equal(before.data.checks.documents, true);

    const bulk = await request(baseUrl, "POST", "/api/company/documents/bulk", {
      cookie: cAdminA,
      body: { action: "archive", ids: [docExpired, docValid] }
    });
    assert.equal(bulk.data.affected, 2);

    const pid = (await queryOne("SELECT public_id FROM products WHERE id = $1", [productA])).public_id;
    const pub = await request(baseUrl, "GET", `/api/public/products/${pid}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.data.documents.length, 0);
    const file = await request(baseUrl, "GET", `/api/public/products/${pid}/documents/${docValid}/file`, { redirect: "manual" });
    assert.equal(file.status, 404);

    const after = await request(baseUrl, "GET", `/api/products/${productA}/completeness`, { cookie: cAdminA });
    assert.equal(after.data.checks.documents, false);

    const restore = await request(baseUrl, "PATCH", `/api/products/${productA}/documents/${docValid}`, { cookie: cUserA, body: { archived: false } });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.archived_at, null);
    const pub2 = await request(baseUrl, "GET", `/api/public/products/${pid}`);
    assert.equal(pub2.data.documents.length, 1);
  });

  // --- Sessies ------------------------------------------------------------
  await t.test("sessies: beheerder ziet en beëindigt sessies van eigen medewerker", async () => {
    const list = await request(baseUrl, "GET", `/api/users/${userA.id}/sessions`, { cookie: cAdminA });
    assert.equal(list.status, 200);
    assert.ok(list.data.items.length >= 1);
    assert.ok(!("token_hash" in list.data.items[0]), "tokens worden nooit teruggegeven");

    const users = await request(baseUrl, "GET", "/api/users", { cookie: cAdminA });
    const u = users.data.find((x) => x.id === userA.id);
    assert.ok(u.last_login_at);
    assert.ok(u.active_sessions >= 1);

    const revoke = await request(baseUrl, "POST", `/api/users/${userA.id}/sessions/revoke`, { cookie: cAdminA });
    assert.equal(revoke.status, 200);
    assert.ok(revoke.data.revoked >= 1);
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: cUserA });
    assert.equal(me.status, 401, "ingetrokken sessie werkt niet meer");
  });

  await t.test("sessies: ander bedrijf en platform owner zijn afgeschermd", async () => {
    assert.ok([403, 404].includes((await request(baseUrl, "GET", `/api/users/${adminA.id}/sessions`, { cookie: cAdminB })).status));
    assert.ok([403, 404].includes((await request(baseUrl, "POST", `/api/users/${adminA.id}/sessions/revoke`, { cookie: cAdminB })).status));
    assert.equal((await request(baseUrl, "GET", `/api/users/${owner.id}/sessions`, { cookie: cAdminA })).status, 404);
    assert.equal((await request(baseUrl, "POST", `/api/users/${adminA.id}/sessions/revoke`, { cookie: cAdminA })).status, 403, "eigen sessies via uitloggen");
    assert.equal((await request(baseUrl, "GET", `/api/users/${adminA.id}/sessions`, { cookie: cOwner })).status, 200);
  });

  // --- Abonnement / usage -------------------------------------------------
  await t.test("abonnement: uitgebreid verbruik met prijs, opslag, scans en waarschuwingen", async () => {
    const res = await request(baseUrl, "GET", "/api/company/license", { cookie: cAdminA });
    assert.equal(res.status, 200);
    assert.equal(res.data.priceMonthlyCents, 14900);
    assert.equal(res.data.storage.max, 1024 * 1024);
    assert.equal(res.data.scans.max, 100);
    assert.equal(res.data.products.max, 2);
    // 1 van 2 producten = 50%: geen productwaarschuwing.
    assert.ok(!res.data.warnings.some((w) => w.message.startsWith("Producten")));
  });

  await t.test("bedrijf ziet interne notities van platformbeheer niet", async () => {
    const res = await request(baseUrl, "GET", "/api/company", { cookie: cAdminA });
    assert.equal(res.status, 200);
    assert.ok(!("notes" in res.data));
  });

  // --- Customer 360 -------------------------------------------------------
  await t.test("Customer 360: alleen platform owner", async () => {
    for (const cookie of [cAdminA, cPartner]) {
      assert.equal((await request(baseUrl, "GET", `/api/admin/companies/${companyA}/overview`, { cookie })).status, 403);
      assert.equal((await request(baseUrl, "GET", `/api/admin/companies/${companyA}/documents`, { cookie })).status, 403);
    }
    const res = await request(baseUrl, "GET", `/api/admin/companies/${companyA}/overview`, { cookie: cOwner });
    assert.equal(res.status, 200);
    assert.equal(res.data.company.notes, "Intern: betaalt laat");
    assert.equal(res.data.company.partner_name.startsWith("SaaS Partner"), true);
    assert.equal(res.data.counts.products, 1);
    assert.equal(res.data.counts.qr_active, 1);
    assert.equal(res.data.usage.priceMonthlyCents, 14900);
    assert.ok(Array.isArray(res.data.recentActivity));

    const qr = await request(baseUrl, "GET", `/api/admin/companies/${companyA}/qr`, { cookie: cOwner });
    assert.equal(qr.status, 200);
    assert.match(qr.data.items[0].qr_url, /\/p\/[0-9A-F-]{36}$/);
    assert.equal((await request(baseUrl, "GET", `/api/admin/companies/999999/overview`, { cookie: cOwner })).status, 404);
  });

  await t.test("Customer 360: contact- en facturatiegegevens bijwerken met validatie", async () => {
    const bad = await request(baseUrl, "PATCH", `/api/admin/companies/${companyA}`, { cookie: cOwner, body: { billingEmail: "geen-mail" } });
    assert.equal(bad.status, 400);
    const ok = await request(baseUrl, "PATCH", `/api/admin/companies/${companyA}`, {
      cookie: cOwner,
      body: { contactName: "Jan Jansen", contactEmail: "jan@example.com", billingEmail: "", vatNumber: "NL123456789B01" }
    });
    assert.equal(ok.status, 200);
    const row = await queryOne("SELECT contact_name, billing_email, vat_number FROM companies WHERE id = $1", [companyA]);
    assert.equal(row.contact_name, "Jan Jansen");
    assert.equal(row.billing_email, null);
    assert.equal(row.vat_number, "NL123456789B01");
    const denied = await request(baseUrl, "PATCH", `/api/admin/companies/${companyA}`, { cookie: cAdminA, body: { notes: "x" } });
    assert.equal(denied.status, 403);
  });

  await t.test("plannen: prijs en extra limieten opslaan", async () => {
    const res = await request(baseUrl, "PATCH", `/api/admin/plans/${plan.id}`, { cookie: cOwner, body: { priceMonthlyCents: 19900, maxScansMonth: null } });
    assert.equal(res.status, 200);
    assert.equal(res.data.price_monthly_cents, 19900);
    assert.equal(res.data.max_scans_month, null);
  });

  // --- Partner ------------------------------------------------------------
  await t.test("partnerdashboard: geaggregeerde aantallen alleen voor eigen klanten", async () => {
    const res = await request(baseUrl, "GET", "/api/dashboard/stats", { cookie: cPartner });
    assert.equal(res.status, 200);
    assert.equal(res.data.totals.customers, 1);
    assert.equal(res.data.totals.products, 1);
    assert.equal(res.data.totals.monthlyRevenueCents, 19900);
    assert.ok(!res.data.customers.some((c) => c.id === companyB));
    const lic = await request(baseUrl, "GET", `/api/partner/customers/${companyA}/license`, { cookie: cPartner });
    assert.equal(lic.status, 200);
    assert.ok(lic.data.storage && lic.data.scans);
    assert.equal((await request(baseUrl, "GET", `/api/partner/customers/${companyB}/license`, { cookie: cPartner })).status, 404);
  });
});
