const test = require("node:test");
const assert = require("node:assert/strict");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Partner/Reseller-laag: een partner beheert uitsluitend eigen klantbedrijven
// (aanmaken, licentie-inzage, eerste-admin-invite) en heeft nergens anders
// toegang. partner_admin is alleen door de Platform Owner toekenbaar en alleen
// op partnerbedrijven. Verbruik blijft strikt per klant-tenant.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

test("partnerlaag: scoping, klant-onboarding, rolguards en afscherming", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();

  // Twee plannen: één dat partners mogen toewijzen, één intern.
  const planResult = await pool.request().query(`
    INSERT INTO dbo.Plans (name, max_users, max_products, partner_assignable)
    OUTPUT INSERTED.id VALUES ('Test Partnerplan', 3, 5, 1)
  `);
  const partnerPlanId = planResult.recordset[0].id;
  const internResult = await pool.request().query(`
    INSERT INTO dbo.Plans (name, max_users, max_products, partner_assignable)
    OUTPUT INSERTED.id VALUES ('Test Intern Plan', 3, 5, 0)
  `);
  const internPlanId = internResult.recordset[0].id;

  // Twee partnerbedrijven met elk een partner_admin, plus een klant van partner 1.
  const partnerCo1 = await createTestCompany("Partner Een");
  const partnerCo2 = await createTestCompany("Partner Twee");
  await pool.request().query(`UPDATE dbo.Companies SET kind = 'partner' WHERE id IN (${partnerCo1}, ${partnerCo2})`);

  const klantCo = await createTestCompany("Klant Van Een");
  await pool.request().input("pid", sql.Int, partnerCo1).input("cid", sql.Int, klantCo)
    .query("UPDATE dbo.Companies SET kind = 'customer', partner_id = @pid WHERE id = @cid");

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const partner1 = await createTestUser({ companyId: partnerCo1, role: "partner_admin" });
  const partner2 = await createTestUser({ companyId: partnerCo2, role: "partner_admin" });
  const klantAdmin = await createTestUser({ companyId: klantCo, role: "company_admin" });
  // Bewust foute data (rechtstreeks in DB): partner_admin in een klántbedrijf —
  // de routelaag moet die alsnog weren (defense in depth).
  const nepPartner = await createTestUser({ companyId: klantCo, role: "partner_admin" });
  // En een company_user in een partnerbedrijf, om owner-promotie naar partner_admin te testen.
  const partnerMedewerker = await createTestUser({ companyId: partnerCo1, role: "company_user" });

  const extraCleanup = { companyIds: [], userIds: [] };

  t.after(async () => {
    await cleanupTestData({
      companyIds: [partnerCo1, partnerCo2, klantCo, ...extraCleanup.companyIds],
      userIds: [owner.id, partner1.id, partner2.id, klantAdmin.id, nepPartner.id, partnerMedewerker.id, ...extraCleanup.userIds]
    });
    await pool.request().query(`DELETE FROM dbo.Plans WHERE id IN (${partnerPlanId}, ${internPlanId})`);
    await stopTestServer(server);
    await sql.close();
  });

  const ownerCookie = await login(baseUrl, owner);
  const partner1Cookie = await login(baseUrl, partner1);
  const partner2Cookie = await login(baseUrl, partner2);
  const klantAdminCookie = await login(baseUrl, klantAdmin);
  const nepPartnerCookie = await login(baseUrl, nepPartner);

  // --- Scoping: alleen eigen klanten ---
  await t.test("partner ziet alleen eigen klanten; andere partner ziet ze niet", async () => {
    const eigen = await request(baseUrl, "GET", "/api/partner/customers", { cookie: partner1Cookie });
    assert.equal(eigen.status, 200);
    assert.ok(eigen.data.some((c) => c.id === klantCo));

    const ander = await request(baseUrl, "GET", "/api/partner/customers", { cookie: partner2Cookie });
    assert.equal(ander.status, 200);
    assert.ok(!ander.data.some((c) => c.id === klantCo));
  });

  await t.test("partner_admin in een klantbedrijf (foute data) krijgt 403 op het partnergebied", async () => {
    const res = await request(baseUrl, "GET", "/api/partner/customers", { cookie: nepPartnerCookie });
    assert.equal(res.status, 403);
  });

  await t.test("company_admin en owner hebben geen toegang tot partnerroutes", async () => {
    const alsAdmin = await request(baseUrl, "GET", "/api/partner/customers", { cookie: klantAdminCookie });
    assert.equal(alsAdmin.status, 403);
    const alsOwner = await request(baseUrl, "GET", "/api/partner/customers", { cookie: ownerCookie });
    assert.equal(alsOwner.status, 403);
  });

  // --- Klant aanmaken ---
  await t.test("partner maakt klantbedrijf aan: eigen tenant, gekoppeld aan de partner", async () => {
    const res = await request(baseUrl, "POST", "/api/partner/customers", {
      cookie: partner1Cookie,
      body: { name: "Nieuwe Klant BV", slug: `nieuwe-klant-${Date.now()}`, planId: partnerPlanId }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.kind, "customer");
    assert.equal(res.data.partner_id, partnerCo1);
    extraCleanup.companyIds.push(res.data.id);
  });

  await t.test("partner kan geen niet-partner_assignable plan toewijzen", async () => {
    const res = await request(baseUrl, "POST", "/api/partner/customers", {
      cookie: partner1Cookie,
      body: { name: "Klant Fout Plan", slug: `fout-plan-${Date.now()}`, planId: internPlanId }
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.details.fieldErrors.planId);
  });

  await t.test("partner-planlijst bevat alleen partner_assignable plannen", async () => {
    const res = await request(baseUrl, "GET", "/api/partner/plans", { cookie: partner1Cookie });
    assert.equal(res.status, 200);
    assert.ok(res.data.some((p) => p.id === partnerPlanId));
    assert.ok(!res.data.some((p) => p.id === internPlanId));
  });

  // --- Licentie-inzage per klant ---
  await t.test("partner ziet het licentieverbruik van de eigen klant; andermans klant is 404", async () => {
    await pool.request().input("pid", sql.Int, partnerPlanId).input("cid", sql.Int, klantCo)
      .query("UPDATE dbo.Companies SET plan_id = @pid WHERE id = @cid");

    const eigen = await request(baseUrl, "GET", `/api/partner/customers/${klantCo}/license`, { cookie: partner1Cookie });
    assert.equal(eigen.status, 200);
    assert.equal(eigen.data.users.max, 3);

    const ander = await request(baseUrl, "GET", `/api/partner/customers/${klantCo}/license`, { cookie: partner2Cookie });
    assert.equal(ander.status, 404);
  });

  // --- Invites: eerste admin voor de klant ---
  await t.test("partner nodigt de eerste Company Admin uit; andere partner kan dat niet", async () => {
    const res = await request(baseUrl, "POST", `/api/partner/customers/${klantCo}/invites`, {
      cookie: partner1Cookie,
      body: { email: `partner-invite-${Date.now()}@example.com`, firstName: "Eerste", lastName: "Admin" }
    });
    assert.equal(res.status, 201);
    assert.ok(res.data.activationUrl.includes("/activate?token="));

    const vreemd = await request(baseUrl, "POST", `/api/partner/customers/${klantCo}/invites`, {
      cookie: partner2Cookie,
      body: { email: `vreemde-invite-${Date.now()}@example.com` }
    });
    assert.equal(vreemd.status, 404);

    // Intrekken door de eigenaar-partner werkt.
    const lijst = await request(baseUrl, "GET", `/api/partner/customers/${klantCo}/invites`, { cookie: partner1Cookie });
    assert.equal(lijst.status, 200);
    const pending = lijst.data.find((i) => i.status === "pending");
    const revoke = await request(baseUrl, "POST", `/api/partner/customers/${klantCo}/invites/${pending.id}/revoke`, {
      cookie: partner1Cookie
    });
    assert.equal(revoke.status, 200);
  });

  // --- Partner heeft nergens anders toegang ---
  await t.test("partner_admin krijgt 403 op producten, gebruikers, companybeheer en adminroutes", async () => {
    for (const [method, path] of [
      ["GET", "/api/products"],
      ["POST", "/api/products"],
      ["GET", "/api/users"],
      ["GET", "/api/company"],
      ["GET", "/api/company/license"],
      ["GET", "/api/admin/companies"],
      ["GET", "/api/admin/licenses/overview"],
      ["GET", "/api/audit"]
    ]) {
      const res = await request(baseUrl, method, path, {
        cookie: partner1Cookie,
        body: method === "POST" ? { name: "x" } : undefined
      });
      assert.equal(res.status, 403, `${method} ${path} hoort 403 te geven, kreeg ${res.status}`);
    }
  });

  // --- Rolguards rond partner_admin ---
  await t.test("company_admin kan geen partner_admin aanmaken of aanpassen", async () => {
    const aanmaken = await request(baseUrl, "POST", "/api/users", {
      cookie: klantAdminCookie,
      body: { email: `hack-${Date.now()}@example.com`, role: "partner_admin" }
    });
    assert.equal(aanmaken.status, 403);

    const aanpassen = await request(baseUrl, "PATCH", `/api/users/${nepPartner.id}`, {
      cookie: klantAdminCookie,
      body: { role: "company_user" }
    });
    assert.equal(aanpassen.status, 403);
  });

  await t.test("owner kan partner_admin alleen op een partnerbedrijf zetten", async () => {
    const opKlant = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { companyId: klantCo, email: `fout-${Date.now()}@example.com`, role: "partner_admin" }
    });
    assert.equal(opKlant.status, 400);
    assert.ok(opKlant.data.error.details.fieldErrors.companyId);

    // Promotie binnen een partnerbedrijf mag wél (bestaande gebruiker, geen Entra-call).
    const promotie = await request(baseUrl, "PATCH", `/api/users/${partnerMedewerker.id}`, {
      cookie: ownerCookie,
      body: { role: "partner_admin" }
    });
    assert.equal(promotie.status, 200);
    assert.equal(promotie.data.role, "partner_admin");
  });

  await t.test("owner kan geen company-rol op een partnerbedrijf zetten", async () => {
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { companyId: partnerCo1, email: `fout2-${Date.now()}@example.com`, role: "company_admin" }
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.details.fieldErrors.role);
  });

  await t.test("owner-invite op een partnerbedrijf wordt geweigerd", async () => {
    const res = await request(baseUrl, "POST", `/api/admin/companies/${partnerCo1}/invites`, {
      cookie: ownerCookie,
      body: { email: `partnerinvite-${Date.now()}@example.com` }
    });
    assert.equal(res.status, 409);
  });

  // --- Dashboard ---
  await t.test("dashboard geeft de partner een eigen scope met klanttotalen", async () => {
    const res = await request(baseUrl, "GET", "/api/dashboard/stats", { cookie: partner1Cookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.scope, "partner");
    assert.ok(res.data.totals.customers >= 1);
    assert.ok(res.data.customers.some((c) => c.id === klantCo));
  });

  // --- Owner-overzicht toont de partnerrelatie ---
  await t.test("owner ziet de klant met partnernaam in bedrijven- en licentie-overzicht", async () => {
    const bedrijven = await request(baseUrl, "GET", "/api/admin/companies", { cookie: ownerCookie });
    assert.equal(bedrijven.status, 200);
    const klant = bedrijven.data.find((c) => c.id === klantCo);
    assert.equal(klant.kind, "customer");
    assert.equal(klant.partner_id, partnerCo1);
    assert.ok(klant.partner_name.startsWith("Partner Een"));

    const overzicht = await request(baseUrl, "GET", "/api/admin/licenses/overview", { cookie: ownerCookie });
    const rij = overzicht.data.find((r) => r.companyId === klantCo);
    assert.equal(rij.partnerId, partnerCo1);
  });
});
