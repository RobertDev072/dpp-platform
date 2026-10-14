const test = require("node:test");
const assert = require("node:assert/strict");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Organisaties & gebruikers: owner-only, server-side gepagineerd per niveau, zoeken met
// pad, en geen verwijderde gebruikers of gegevens voor andere rollen.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

test("organisatieboom: autorisatie, paginering, zoeken en detail", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();

  const partnerCo = await createTestCompany("Orgboom Partner");
  await pool.request().input("id", sql.Int, partnerCo).query("UPDATE dbo.Companies SET kind = 'partner' WHERE id = @id");
  // 27 klanten van de partner (meer dan één pagina van 25) en één zelfstandige klant.
  const customers = [];
  for (let i = 0; i < 27; i += 1) {
    const id = await createTestCompany(`Orgboom Klant ${String(i).padStart(2, "0")}`);
    await pool.request().input("pid", sql.Int, partnerCo).input("id", sql.Int, id)
      .query("UPDATE dbo.Companies SET kind = 'customer', partner_id = @pid WHERE id = @id");
    customers.push(id);
  }
  const standalone = await createTestCompany("Orgboom Zelfstandig");
  await pool.request().input("id", sql.Int, standalone).query("UPDATE dbo.Companies SET kind = 'customer', partner_id = NULL WHERE id = @id");

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const partnerAdmin = await createTestUser({ companyId: partnerCo, role: "partner_admin" });
  const klantAdmin = await createTestUser({ companyId: customers[0], role: "company_admin" });
  const medewerker = await createTestUser({ companyId: customers[0], role: "company_user" });
  const verwijderd = await createTestUser({ companyId: customers[0], role: "company_user" });
  await pool.request().input("id", sql.Int, verwijderd.id).query("UPDATE dbo.Users SET status = 'deleted' WHERE id = @id");
  const zelfstandigAdmin = await createTestUser({ companyId: standalone, role: "company_admin" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [...customers, standalone, partnerCo],
      userIds: [owner.id, partnerAdmin.id, klantAdmin.id, medewerker.id, verwijderd.id, zelfstandigAdmin.id]
    });
    await stopTestServer(server);
    await sql.close();
  });

  const ownerCookie = await login(baseUrl, owner);

  await t.test("alleen de Platform Owner: andere rollen krijgen 403, anoniem 401", async () => {
    for (const user of [partnerAdmin, klantAdmin, medewerker]) {
      const cookie = await login(baseUrl, user);
      for (const path of ["/api/admin/org/groups", `/api/admin/org/groups/${partnerCo}/customers`, `/api/admin/org/companies/${customers[0]}/users`, "/api/admin/org/search?q=orgboom", `/api/admin/org/users/${klantAdmin.id}`]) {
        const res = await request(baseUrl, "GET", path, { cookie });
        assert.equal(res.status, 403, `${user.role} ${path}`);
      }
    }
    const anon = await request(baseUrl, "GET", "/api/admin/org/groups");
    assert.equal(anon.status, 401);
  });

  await t.test("partners met aantallen; zelfstandige groep apart", async () => {
    const res = await request(baseUrl, "GET", "/api/admin/org/groups?pageSize=100", { cookie: ownerCookie });
    assert.equal(res.status, 200);
    const partner = res.data.items.find((p) => p.id === partnerCo);
    assert.ok(partner);
    assert.equal(partner.customer_count, 27);
    assert.equal(partner.partner_admin_count, 1);
    assert.equal(partner.customer_user_count, 2, "verwijderde gebruiker telt niet mee");
    assert.ok(res.data.standalone.customer_count >= 1);
  });

  await t.test("klantbedrijven: 25 per pagina, totaal en tweede pagina", async () => {
    const first = await request(baseUrl, "GET", `/api/admin/org/groups/${partnerCo}/customers`, { cookie: ownerCookie });
    assert.equal(first.status, 200);
    assert.equal(first.data.pageSize, 25);
    assert.equal(first.data.total, 27);
    assert.equal(first.data.pages, 2);
    assert.equal(first.data.items.length, 25);
    const second = await request(baseUrl, "GET", `/api/admin/org/groups/${partnerCo}/customers?page=2`, { cookie: ownerCookie });
    assert.equal(second.data.items.length, 2);
    const ids = new Set([...first.data.items, ...second.data.items].map((c) => c.id));
    assert.equal(ids.size, 27, "geen dubbelingen over pagina's");
    const k0 = first.data.items.find((c) => c.id === customers[0]);
    assert.equal(k0.admin_count, 1);
    assert.equal(k0.employee_count, 1);
    assert.equal(k0.admins.length, 1);

    const bad = await request(baseUrl, "GET", `/api/admin/org/groups/${partnerCo}/customers?pageSize=30`, { cookie: ownerCookie });
    assert.equal(bad.status, 400, "alleen 25, 50 of 100");
    const notPartner = await request(baseUrl, "GET", `/api/admin/org/groups/${customers[0]}/customers`, { cookie: ownerCookie });
    assert.equal(notPartner.status, 404);

    const alone = await request(baseUrl, "GET", "/api/admin/org/groups/standalone/customers?pageSize=100", { cookie: ownerCookie });
    assert.ok(alone.data.items.some((c) => c.id === standalone));
    assert.ok(!alone.data.items.some((c) => c.id === customers[0]));
  });

  await t.test("gebruikers per bedrijf: beheerders eerst, verwijderden nooit", async () => {
    const res = await request(baseUrl, "GET", `/api/admin/org/companies/${customers[0]}/users`, { cookie: ownerCookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.items.map((u) => u.id), [klantAdmin.id, medewerker.id]);
    assert.ok(!("password_hash" in res.data.items[0]), "geen gevoelige kolommen");
    const filtered = await request(baseUrl, "GET", `/api/admin/org/companies/${customers[0]}/users?role=company_user`, { cookie: ownerCookie });
    assert.deepEqual(filtered.data.items.map((u) => u.id), [medewerker.id]);
  });

  await t.test("zoeken vindt diep in de boom, met pad", async () => {
    const res = await request(baseUrl, "GET", `/api/admin/org/search?q=${encodeURIComponent(medewerker.email)}`, { cookie: ownerCookie });
    assert.equal(res.status, 200);
    const hit = res.data.items.find((i) => i.kind === "user" && i.id === medewerker.id);
    assert.ok(hit);
    assert.equal(hit.company_id, customers[0]);
    assert.equal(hit.partner_id, partnerCo);

    const gone = await request(baseUrl, "GET", `/api/admin/org/search?q=${encodeURIComponent(verwijderd.email)}`, { cookie: ownerCookie });
    assert.equal(gone.data.total, 0, "verwijderde gebruiker niet vindbaar");

    const orgs = await request(baseUrl, "GET", "/api/admin/org/search?q=Orgboom%20Klant&type=customer", { cookie: ownerCookie });
    assert.equal(orgs.data.total, 27);
    assert.equal(orgs.data.items.length, 25);
    assert.ok(orgs.data.items.every((i) => i.kind === "customer" && i.partner_id === partnerCo));

    const wildcard = await request(baseUrl, "GET", "/api/admin/org/search?q=%25", { cookie: ownerCookie });
    assert.equal(wildcard.status, 200);
    assert.equal(wildcard.data.total, 0, "% wordt letterlijk gezocht, niet als wildcard");

    const byRole = await request(baseUrl, "GET", "/api/admin/org/search?q=orgboom&role=company_admin&pageSize=100", { cookie: ownerCookie });
    const ids = byRole.data.items.map((i) => i.id);
    assert.ok(ids.includes(klantAdmin.id) && ids.includes(zelfstandigAdmin.id));
    assert.ok(byRole.data.items.every((i) => i.kind === "user" && i.role === "company_admin"));
  });

  await t.test("detailpaneel: bedrijf en gebruiker; verwijderde gebruiker 404", async () => {
    const company = await request(baseUrl, "GET", `/api/admin/org/companies/${customers[0]}`, { cookie: ownerCookie });
    assert.equal(company.status, 200);
    assert.equal(company.data.partner_id, partnerCo);
    assert.equal(company.data.user_count, 2);
    const user = await request(baseUrl, "GET", `/api/admin/org/users/${medewerker.id}`, { cookie: ownerCookie });
    assert.equal(user.status, 200);
    assert.equal(user.data.partner_name.startsWith("Orgboom Partner"), true);
    const deleted = await request(baseUrl, "GET", `/api/admin/org/users/${verwijderd.id}`, { cookie: ownerCookie });
    assert.equal(deleted.status, 404);
    const badId = await request(baseUrl, "GET", "/api/admin/org/companies/abc", { cookie: ownerCookie });
    assert.equal(badId.status, 404);
  });
});
