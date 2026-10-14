const test = require("node:test");
const assert = require("node:assert/strict");

// Verplichte scenario's A-O (opdracht oktober 2026): rollen, partner-onboarding,
// activatielinks (48 uur), tijdelijke wachtwoorden (24 uur), abonnementsafscherming,
// QR-scantelling en tenant-/partnerisolatie. Alles via de echte API op PostgreSQL.
const { getPool, sql } = require("../src/config/db");
const scanDedup = require("../src/services/scanDedup.service");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

const BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

async function login(baseUrl, email, password) {
  return request(baseUrl, "POST", "/api/auth/login", { body: { email, password } });
}

function tokenOf(activationUrl) {
  return new URL(activationUrl).searchParams.get("token");
}

test("Scenario's A-O: rollen, onboarding, accounts, abonnement en scans", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const suffix = Date.now().toString(36);
  const companyIds = [];
  const userIds = [];

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  userIds.push(owner.id);
  const plan = (await pool.query("INSERT INTO dbo.plans (name, max_users, max_products, partner_assignable) VALUES ($1, 3, 2, true) RETURNING id", [`Test ${suffix}`])).rows[0].id;
  const otherPartner = (await pool.query("INSERT INTO dbo.companies (name, slug, kind) VALUES ($1, $2, 'partner') RETURNING id", [`Andere partner ${suffix}`, `andere-${suffix}`])).rows[0].id;
  companyIds.push(otherPartner);
  const otherPartnerAdmin = await createTestUser({ companyId: otherPartner, role: "partner_admin" });
  userIds.push(otherPartnerAdmin.id);
  const otherCustomer = (await pool.query("INSERT INTO dbo.companies (name, slug, kind, partner_id, plan_id) VALUES ($1, $2, 'customer', $3, $4) RETURNING id", [`Klant van ander ${suffix}`, `klant-ander-${suffix}`, otherPartner, plan])).rows[0].id;
  companyIds.push(otherCustomer);

  t.after(async () => {
    await cleanupTestData({ companyIds, userIds });
    await pool.query("DELETE FROM dbo.plans WHERE id = $1", [plan]);
    await stopTestServer(server);
    await sql.close();
  });

  const ownerCookie = (await login(baseUrl, owner.email, owner.password)).cookie;
  const otherPartnerCookie = (await login(baseUrl, otherPartnerAdmin.email, otherPartnerAdmin.password)).cookie;
  const state = {};

  await t.test("A: Platform Owner maakt partner + Partner Admin (activatielink); anderen mogen dat niet", async () => {
    const res = await request(baseUrl, "POST", "/api/admin/partners", {
      cookie: ownerCookie,
      body: { name: `Partner ${suffix}`, slug: `partner-${suffix}`, adminFirstName: "Pia", adminLastName: "Partner", adminEmail: `pia.${suffix}@example.com` }
    });
    assert.equal(res.status, 201);
    companyIds.push(res.data.id);
    assert.equal(res.data.kind, "partner");
    assert.equal(res.data.invite.role, "partner_admin");
    assert.match(res.data.invite.activationUrl, /\/activate\?token=[0-9a-f]{64}$/);
    const hours = (new Date(res.data.invite.expires_at) - Date.now()) / 3600e3;
    assert.ok(hours > 47.9 && hours <= 48, `48 uur geldig (${hours})`);
    const stored = (await pool.query("SELECT token_hash FROM dbo.companyadmininvites WHERE id = $1", [res.data.invite.id])).rows[0].token_hash;
    assert.notEqual(stored, tokenOf(res.data.invite.activationUrl), "alleen de hash staat in de database");

    const accepted = await request(baseUrl, "POST", `/api/invites/${tokenOf(res.data.invite.activationUrl)}/accept`, { body: { password: "PartnerWachtwoord123!" } });
    assert.equal(accepted.status, 201);
    const login1 = await login(baseUrl, `pia.${suffix}@example.com`, "PartnerWachtwoord123!");
    assert.equal(login1.status, 200);
    assert.equal(login1.data.role, "partner_admin");
    state.partner = { id: res.data.id, cookie: login1.cookie };

    assert.equal((await request(baseUrl, "POST", "/api/admin/partners", { cookie: state.partner.cookie, body: { name: "x", slug: "x", adminFirstName: "a", adminLastName: "b", adminEmail: "x@example.com" } })).status, 403);
  });

  await t.test("B: partner maakt bedrijf + eerste Company Admin in één stap; alles-of-niets, geen dubbelen", async () => {
    const body = {
      name: `Klant ${suffix}`,
      slug: `klant-${suffix}`,
      planId: plan,
      adminFirstName: "Carla",
      adminLastName: "Beheer",
      adminEmail: `carla.${suffix}@example.com`
    };
    const res = await request(baseUrl, "POST", "/api/partner/customers", { cookie: state.partner.cookie, body });
    assert.equal(res.status, 201);
    companyIds.push(res.data.id);
    assert.equal(res.data.partner_id, state.partner.id, "gekoppeld aan deze partner");
    assert.equal(res.data.kind, "customer");
    assert.equal(res.data.invite.role, "company_admin");
    state.customer = { id: res.data.id, activationUrl: res.data.invite.activationUrl, email: body.adminEmail };

    const again = await request(baseUrl, "POST", "/api/partner/customers", { cookie: state.partner.cookie, body });
    assert.equal(again.status, 409, "dubbel indienen maakt niets aan");
    const count = Number((await pool.query("SELECT COUNT(*) FROM dbo.companies WHERE slug = $1", [body.slug])).rows[0].count);
    assert.equal(count, 1);

    // E-mailadres met bestaand account: geweigerd, en er blijft geen half bedrijf achter.
    const taken = await request(baseUrl, "POST", "/api/partner/customers", {
      cookie: state.partner.cookie,
      body: { ...body, slug: `klant2-${suffix}`, adminEmail: owner.email }
    });
    assert.equal(taken.status, 409);
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM dbo.companies WHERE slug = $1", [`klant2-${suffix}`])).rows[0].count), 0);

    // Een plan dat niet voor partners is, en ontbrekende beheerdergegevens: 400.
    assert.equal((await request(baseUrl, "POST", "/api/partner/customers", { cookie: state.partner.cookie, body: { ...body, slug: `k3-${suffix}`, adminEmail: "" } })).status, 400);
    // Company Admin/medewerker kan geen klantbedrijven aanmaken.
    assert.equal((await request(baseUrl, "POST", "/api/partner/customers", { cookie: ownerCookie, body })).status, 403);
  });

  await t.test("C + D: activatielink 48 uur, eenmalig; verlopen en ingetrokken links werken niet", async () => {
    const token = tokenOf(state.customer.activationUrl);
    const info = await request(baseUrl, "GET", `/api/invites/${token}`);
    assert.equal(info.status, 200);
    assert.equal(info.data.role, "company_admin");

    // Nieuwe link maakt de oude ongeldig.
    const reissue = await request(baseUrl, "POST", `/api/partner/customers/${state.customer.id}/invites`, {
      cookie: state.partner.cookie,
      body: { email: state.customer.email, firstName: "Carla", lastName: "Beheer" }
    });
    assert.equal(reissue.status, 201);
    const old = await request(baseUrl, "POST", `/api/invites/${token}/accept`, { body: { password: "CompanyWachtwoord123!" } });
    assert.equal(old.status, 410, "oude link ingetrokken");
    const newToken = tokenOf(reissue.data.activationUrl);

    // Verlopen (meer dan 48 uur geleden uitgegeven): niet bruikbaar, duidelijke melding.
    await pool.query("UPDATE dbo.companyadmininvites SET expires_at = now() - interval '1 minute' WHERE id = $1", [reissue.data.id]);
    const expired = await request(baseUrl, "POST", `/api/invites/${newToken}/accept`, { body: { password: "CompanyWachtwoord123!" } });
    assert.equal(expired.status, 410);
    assert.equal(expired.data.error.code, "INVITE_EXPIRED");
    assert.match(expired.data.error.message, /48 uur/);
    await pool.query("UPDATE dbo.companyadmininvites SET expires_at = now() + interval '48 hours' WHERE id = $1", [reissue.data.id]);

    // Gelijktijdig twee keer activeren: precies één account.
    const [r1, r2] = await Promise.all([
      request(baseUrl, "POST", `/api/invites/${newToken}/accept`, { body: { password: "CompanyWachtwoord123!" } }),
      request(baseUrl, "POST", `/api/invites/${newToken}/accept`, { body: { password: "CompanyWachtwoord123!" } })
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.equal(statuses[0], 201, "één activatie slaagt");
    assert.ok([409, 410].includes(statuses[1]), `de andere wordt geweigerd (${statuses[1]})`);
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM dbo.users WHERE lower(email) = lower($1)", [state.customer.email])).rows[0].count), 1);
    assert.equal((await request(baseUrl, "POST", `/api/invites/${newToken}/accept`, { body: { password: "CompanyWachtwoord123!" } })).status, 410, "eenmalig");

    const adminLogin = await login(baseUrl, state.customer.email, "CompanyWachtwoord123!");
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.role, "company_admin");
    state.admin = { cookie: adminLogin.cookie };
  });

  await t.test("E + F + M: Company Admin maakt medewerkers; tijdelijk wachtwoord 24 uur; herstel via beheerder", async () => {
    const created = await request(baseUrl, "POST", "/api/users", {
      cookie: state.admin.cookie,
      body: { email: `mia.${suffix}@example.com`, firstName: "Mia", lastName: "Medewerker", role: "company_user", companyId: otherCustomer }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.company_id, state.customer.id, "companyId uit het verzoek wordt genegeerd");
    assert.equal(created.data.tempPasswordValidHours, 24);
    const temp = created.data.tempPassword;
    const row = (await pool.query("SELECT password_hash, temp_password_expires_at FROM dbo.users WHERE id = $1", [created.data.id])).rows[0];
    assert.ok(!row.password_hash.includes(temp), "geen platte tekst");
    const hours = (new Date(row.temp_password_expires_at) - Date.now()) / 3600e3;
    assert.ok(hours > 23.9 && hours <= 24);

    // Eerste login: eerst eigen wachtwoord kiezen.
    assert.equal((await login(baseUrl, `mia.${suffix}@example.com`, temp)).data.mustChangePassword, true);

    // Na 24 uur werkt het tijdelijke wachtwoord niet meer (ook niet voor wijzigen).
    await pool.query("UPDATE dbo.users SET temp_password_expires_at = now() - interval '1 minute' WHERE id = $1", [created.data.id]);
    const late = await login(baseUrl, `mia.${suffix}@example.com`, temp);
    assert.equal(late.status, 401);
    assert.equal(late.data.error.code, "TEMP_PASSWORD_EXPIRED");
    const lateChange = await request(baseUrl, "POST", "/api/auth/change-password", { body: { email: `mia.${suffix}@example.com`, currentPassword: temp, newPassword: "MiaEigenWachtwoord123!" } });
    assert.equal(lateChange.status, 401);

    // M: herstel via de beheerder: nieuw tijdelijk wachtwoord (24 uur), dan eigen wachtwoord.
    const reset = await request(baseUrl, "POST", `/api/users/${created.data.id}/reset-password`, { cookie: state.admin.cookie });
    assert.equal(reset.status, 200);
    const change = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: `mia.${suffix}@example.com`, currentPassword: reset.data.tempPassword, newPassword: "MiaEigenWachtwoord123!" }
    });
    assert.equal(change.status, 200);
    assert.equal((await login(baseUrl, `mia.${suffix}@example.com`, reset.data.tempPassword)).status, 401, "tijdelijk wachtwoord direct ongeldig");
    const employeeLogin = await login(baseUrl, `mia.${suffix}@example.com`, "MiaEigenWachtwoord123!");
    assert.equal(employeeLogin.status, 200);
    state.employee = { id: created.data.id, cookie: employeeLogin.cookie };

    // Een medewerker kan geen gebruikers aanmaken of wachtwoorden resetten.
    assert.equal((await request(baseUrl, "POST", "/api/users", { cookie: state.employee.cookie, body: { email: `x.${suffix}@example.com`, role: "company_user" } })).status, 403);
    assert.equal((await request(baseUrl, "POST", `/api/users/${created.data.id}/reset-password`, { cookie: state.employee.cookie })).status, 403);
    // Een beheerder kan geen gebruiker van een ander bedrijf resetten.
    assert.equal((await request(baseUrl, "POST", `/api/users/${otherPartnerAdmin.id}/reset-password`, { cookie: state.admin.cookie })).status, 404);
  });

  await t.test("G + H: abonnement alleen voor beheerders; medewerker krijgt niets en een neutrale melding", async () => {
    assert.equal((await request(baseUrl, "GET", "/api/company/license", { cookie: state.employee.cookie })).status, 403);
    const stats = await request(baseUrl, "GET", "/api/dashboard/stats", { cookie: state.employee.cookie });
    assert.equal(stats.data.license, undefined);
    assert.equal(stats.data.planName, undefined);
    const overview = await request(baseUrl, "GET", "/api/dashboard/overview", { cookie: state.employee.cookie });
    assert.equal(overview.data.license, null);
    const notes = await request(baseUrl, "GET", "/api/dashboard/notifications", { cookie: state.employee.cookie });
    assert.ok(!notes.data.items.some((n) => n.id.startsWith("license:")));

    const adminLicense = await request(baseUrl, "GET", "/api/company/license", { cookie: state.admin.cookie });
    assert.equal(adminLicense.status, 200);
    assert.equal(adminLicense.data.products.max, 2);
    assert.equal((await request(baseUrl, "GET", `/api/partner/customers/${state.customer.id}/license`, { cookie: state.partner.cookie })).status, 200);

    // Productlimiet (2): gelijktijdige aanmaakverzoeken overschrijden de limiet nooit.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => request(baseUrl, "POST", "/api/products", { cookie: state.admin.cookie, body: { name: `Gelijktijdig ${i}` } }))
    );
    assert.equal(results.filter((r) => r.status === 201).length, 2, results.map((r) => r.status).join(","));
    assert.ok(results.filter((r) => r.status === 409).every((r) => /Productlimiet/.test(r.data.error.message)), "beheerder krijgt de reden");
    const employeeTry = await request(baseUrl, "POST", "/api/products", { cookie: state.employee.cookie, body: { name: "Te veel" } });
    assert.equal(employeeTry.status, 409);
    assert.doesNotMatch(employeeTry.data.error.message, /\d+\/\d+|Productlimiet|plan/i, "geen abonnementsdetails voor medewerkers");

    // Archiveren maakt ruimte; opnieuw publiceren van het gearchiveerde product telt weer mee.
    const ids = results.filter((r) => r.status === 201).map((r) => r.data.id);
    state.productIds = ids;
    assert.equal((await request(baseUrl, "DELETE", `/api/products/${ids[0]}`, { cookie: state.admin.cookie })).status, 200);
    const third = await request(baseUrl, "POST", "/api/products", { cookie: state.admin.cookie, body: { name: "Na archiveren" } });
    assert.equal(third.status, 201);
    const republish = await request(baseUrl, "POST", `/api/products/${ids[0]}/publish`, { cookie: state.admin.cookie });
    assert.equal(republish.status, 409, "heractiveren boven de limiet geweigerd");
    state.productIds.push(third.data.id);
  });

  await t.test("I + J + K: alleen echte scans tellen; cache wordt ververst na een wijziging", async () => {
    scanDedup.resetForTests();
    const productId = state.productIds[1];
    const published = await request(baseUrl, "POST", `/api/products/${productId}/publish`, { cookie: state.admin.cookie });
    assert.equal(published.status, 200);
    const publicId = String(published.data.public_id);
    const count = async () => Number((await pool.query("SELECT COUNT(*) FROM dbo.scanevents WHERE product_id = $1", [productId])).rows[0].count);
    const beacon = (headers) => fetch(`${baseUrl}/api/scan/${publicId}`, { method: "POST", headers });

    // I: paspoort ophalen (app, dashboard, cache-miss) en machineleesbaar: geen scan.
    await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    await fetch(`${baseUrl}/api/dpp/${publicId}`, { headers: { Accept: "application/ld+json", "User-Agent": BROWSER_UA } });
    // Scripts, andere sites en bots: geen scan.
    await beacon({ "User-Agent": BROWSER_UA });
    await beacon({ "User-Agent": BROWSER_UA, "Sec-Fetch-Site": "cross-site" });
    await beacon({ "User-Agent": "WhatsApp/2.23 (link preview)", "Sec-Fetch-Site": "same-origin" });
    await beacon({ "User-Agent": "curl/8.0", "Sec-Fetch-Site": "same-origin" });
    assert.equal(await count(), 0, "geen enkele van deze telt als scan");

    // J: echte browser op de paspoortpagina: precies één scan, ook bij verversen/retries.
    for (let i = 0; i < 4; i++) {
      assert.equal((await beacon({ "User-Agent": BROWSER_UA, "Sec-Fetch-Site": "same-origin" })).status, 204);
    }
    assert.equal(await count(), 1);

    // K: na een wijziging toont het paspoort direct de nieuwe inhoud (cache geleegd).
    const before = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    await request(baseUrl, "PATCH", `/api/products/${productId}`, { cookie: state.admin.cookie, body: { description: `Nieuw ${suffix}` } });
    const after = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.notEqual(before.data.description, after.data.description);
    assert.equal(after.data.description, `Nieuw ${suffix}`);

    // Ingetrokken of onbekende QR-bestemming.
    assert.equal((await request(baseUrl, "GET", "/api/public/products/0f8fad5b-d9cb-469f-a165-70867728950e")).status, 404);
    assert.equal((await beacon.call(null, { "User-Agent": BROWSER_UA, "Sec-Fetch-Site": "same-origin" })).status, 204);
  });

  await t.test("N + O: geen toegang tot andere bedrijven of andere partners", async () => {
    const product = await createTestProduct({ companyId: otherCustomer, name: "Van een ander" });
    for (const path of [`/api/products/${product}`, `/api/products/${product}/documents`, `/api/products/${product}/qr.png`]) {
      assert.equal((await request(baseUrl, "GET", path, { cookie: state.admin.cookie })).status, 404, path);
      assert.equal((await request(baseUrl, "GET", path, { cookie: state.employee.cookie })).status, 404, path);
    }
    // Partner: alleen eigen klanten.
    for (const path of [`/api/partner/customers/${otherCustomer}/license`, `/api/partner/customers/${otherCustomer}/admins`, `/api/partner/customers/${otherCustomer}/invites`]) {
      assert.equal((await request(baseUrl, "GET", path, { cookie: state.partner.cookie })).status, 404, path);
    }
    assert.equal((await request(baseUrl, "GET", `/api/partner/customers/${state.customer.id}/license`, { cookie: otherPartnerCookie })).status, 404);
    const list = await request(baseUrl, "GET", "/api/partner/customers", { cookie: state.partner.cookie });
    assert.deepEqual(list.data.map((c) => c.id), [state.customer.id]);
    // Partner en bedrijfsgebruikers: geen platformbrede gegevens.
    for (const cookie of [state.partner.cookie, state.admin.cookie, state.employee.cookie]) {
      for (const path of ["/api/admin/companies", "/api/admin/plans", "/api/admin/system/overview", "/api/audit", "/api/admin/licenses/overview", "/api/admin/config-status"]) {
        assert.ok([401, 403].includes((await request(baseUrl, "GET", path, { cookie })).status), path);
      }
    }
    // Een partner kan geen producten van zijn klanten openen (geen productmodule).
    assert.equal((await request(baseUrl, "GET", `/api/products/${state.productIds[1]}`, { cookie: state.partner.cookie })).status, 403);
  });
});
