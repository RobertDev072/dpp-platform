const test = require("node:test");
const assert = require("node:assert/strict");
const { query, closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Partner-wachtwoordreset: een Partner Admin mag uitsluitend het wachtwoord van
// Company Admins binnen zijn eigen klantbedrijven resetten. Alles daarbuiten is
// 404 (niet bevestigen) of 403/409, het tijdelijke wachtwoord komt alleen in het
// antwoord (nooit in DB/audit), sessies van het doelwit vervallen en de
// eerstvolgende login dwingt een nieuw wachtwoord af.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res;
}

test("partner-wachtwoordreset: scoping, weigeringen en volledige tijdelijk-wachtwoord-flow", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const partnerCo1 = await createTestCompany("Reset Partner Een");
  const partnerCo2 = await createTestCompany("Reset Partner Twee");
  await query(`UPDATE companies SET kind = 'partner' WHERE id IN (${partnerCo1}, ${partnerCo2})`);

  const klantCo1 = await createTestCompany("Reset Klant Van Een");
  const klantCo2 = await createTestCompany("Reset Klant Van Twee");
  const directCo = await createTestCompany("Reset Directe Klant");
  await query("UPDATE companies SET partner_id = $1 WHERE id = $2", [partnerCo1, klantCo1]);
  await query("UPDATE companies SET partner_id = $1 WHERE id = $2", [partnerCo2, klantCo2]);

  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const partner1 = await createTestUser({ companyId: partnerCo1, role: "partner_admin" });
  const partner2 = await createTestUser({ companyId: partnerCo2, role: "partner_admin" });
  const adminK1 = await createTestUser({ companyId: klantCo1, role: "company_admin" });
  const medewerkerK1 = await createTestUser({ companyId: klantCo1, role: "company_user" });
  const blockedAdminK1 = await createTestUser({ companyId: klantCo1, role: "company_admin" });
  const deletedAdminK1 = await createTestUser({ companyId: klantCo1, role: "company_admin" });
  const adminK2 = await createTestUser({ companyId: klantCo2, role: "company_admin" });
  const adminDirect = await createTestUser({ companyId: directCo, role: "company_admin" });
  await query("UPDATE users SET status = 'blocked' WHERE id = $1", [blockedAdminK1.id]);
  await query("UPDATE users SET status = 'deleted' WHERE id = $1", [deletedAdminK1.id]);

  t.after(async () => {
    await cleanupTestData({
      companyIds: [partnerCo1, partnerCo2, klantCo1, klantCo2, directCo],
      userIds: [
        owner.id, partner1.id, partner2.id, adminK1.id, medewerkerK1.id,
        blockedAdminK1.id, deletedAdminK1.id, adminK2.id, adminDirect.id
      ]
    });
    await stopTestServer(server);
    await closePool();
  });

  const partner1Cookie = (await login(baseUrl, partner1)).cookie;
  const partner2Cookie = (await login(baseUrl, partner2)).cookie;

  await t.test("adminlijst toont alleen Company Admins van de eigen klant (geen medewerkers)", async () => {
    const res = await request(baseUrl, "GET", `/api/partner/customers/${klantCo1}/admins`, { cookie: partner1Cookie });
    assert.equal(res.status, 200);
    assert.ok(res.data.some((u) => u.id === adminK1.id));
    assert.ok(res.data.some((u) => u.id === blockedAdminK1.id));
    assert.ok(!res.data.some((u) => u.id === medewerkerK1.id));
    assert.ok(!res.data.some((u) => u.id === deletedAdminK1.id));

    const vreemd = await request(baseUrl, "GET", `/api/partner/customers/${klantCo2}/admins`, { cookie: partner1Cookie });
    assert.equal(vreemd.status, 404);
  });

  await t.test("reset bij klant van een andere partner en bij een directe klant geeft 404", async () => {
    const anderePartner = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo2}/admins/${adminK2.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(anderePartner.status, 404);

    const direct = await request(
      baseUrl, "POST", `/api/partner/customers/${directCo}/admins/${adminDirect.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(direct.status, 404);
  });

  await t.test("Platform Owner, Partner Admins en gebruikers van andere bedrijven zijn onbereikbaar (404)", async () => {
    for (const targetId of [owner.id, partner2.id, partner1.id, adminK2.id]) {
      const res = await request(
        baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${targetId}/reset-password`,
        { cookie: partner1Cookie }
      );
      assert.equal(res.status, 404, `doelwit ${targetId} hoort 404 te geven, kreeg ${res.status}`);
    }
  });

  await t.test("Productmedewerker binnen de eigen klant wordt geweigerd (403)", async () => {
    const res = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${medewerkerK1.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(res.status, 403);
  });

  await t.test("geblokkeerd account: geweigerd zonder heractivering; verwijderd account: 404", async () => {
    const blocked = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${blockedAdminK1.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(blocked.status, 409);

    const statusNa = await query("SELECT status FROM users WHERE id = $1", [blockedAdminK1.id]);
    assert.equal(statusNa.rows[0].status, "blocked");

    const deleted = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${deletedAdminK1.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(deleted.status, 404);
  });

  await t.test("geldige reset: tijdelijk wachtwoord, sessies ingetrokken, oud wachtwoord dood, gedwongen wijziging", async () => {
    // Doelwit is ingelogd vóór de reset - die sessie moet straks ongeldig zijn.
    const adminSessie = (await login(baseUrl, adminK1)).cookie;
    const meVoor = await request(baseUrl, "GET", "/api/auth/me", { cookie: adminSessie });
    assert.equal(meVoor.status, 200);

    const reset = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${adminK1.id}/reset-password`,
      { cookie: partner1Cookie }
    );
    assert.equal(reset.status, 200);
    const tempPassword = reset.data.tempPassword;
    assert.ok(tempPassword && tempPassword.length >= 12);

    // Lopende sessie is ingetrokken.
    const meNa = await request(baseUrl, "GET", "/api/auth/me", { cookie: adminSessie });
    assert.equal(meNa.status, 401);

    // Oude wachtwoord werkt niet meer.
    const oud = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: adminK1.email, password: adminK1.password }
    });
    assert.equal(oud.status, 401);

    // Tijdelijk wachtwoord werkt, maar dwingt eerst een wijziging af (geen sessie).
    const tijdelijk = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: adminK1.email, password: tempPassword }
    });
    assert.equal(tijdelijk.status, 200);
    assert.equal(tijdelijk.data.mustChangePassword, true);
    assert.equal(tijdelijk.cookie, null);

    // Nieuw wachtwoord instellen en daarmee normaal inloggen.
    const nieuwWachtwoord = `Nieuw-${Date.now()}-Wachtwoord!`;
    const wijzig = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: adminK1.email, currentPassword: tempPassword, newPassword: nieuwWachtwoord }
    });
    assert.equal(wijzig.status, 200);

    const nieuw = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: adminK1.email, password: nieuwWachtwoord }
    });
    assert.equal(nieuw.status, 200);
    assert.equal(nieuw.data.mustChangePassword, undefined);

    // Audit: wie, voor wie, bij welk bedrijf, resultaat - en nooit het wachtwoord.
    const audit = await query(
      `
        SELECT company_id, user_id, action, metadata, timestamp
        FROM audit_logs
        WHERE action = 'reset_password' AND entity_type = 'User'
          AND entity_id = $1 AND user_id = $2
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      [String(adminK1.id), partner1.id]
    );
    const rij = audit.rows[0];
    assert.ok(rij, "auditregel voor de reset ontbreekt");
    assert.equal(rij.company_id, klantCo1);
    assert.ok(rij.timestamp);
    const metadata = JSON.parse(rij.metadata);
    assert.equal(metadata.via, "partner");
    assert.equal(metadata.partnerCompanyId, partnerCo1);
    assert.equal(metadata.result, "geslaagd");
    assert.ok(!rij.metadata.includes(tempPassword), "tijdelijk wachtwoord mag nooit in de audit staan");
  });

  await t.test("andere rollen (owner, company_admin) hebben geen toegang tot de partner-resetroute", async () => {
    const ownerCookie = (await login(baseUrl, owner)).cookie;
    const res = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${adminK1.id}/reset-password`,
      { cookie: ownerCookie }
    );
    assert.equal(res.status, 403);

    const adminK2Cookie = (await login(baseUrl, adminK2)).cookie;
    const alsAdmin = await request(
      baseUrl, "POST", `/api/partner/customers/${klantCo1}/admins/${adminK1.id}/reset-password`,
      { cookie: adminK2Cookie }
    );
    assert.equal(alsAdmin.status, 403);
  });
});
