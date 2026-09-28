const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

const STRONG_PASSWORD = "Activatie-Wachtwoord-2026";

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

// De gedeelde request-helper geeft geen headers terug; voor Cache-Control hebben we die nodig.
async function rawPost(baseUrl, path, { body, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
}

function tokenFromUrl(activationUrl) {
  const match = /\/activate\.html#token=([A-Za-z0-9_-]{43})$/.exec(activationUrl);
  assert.ok(match, `activationUrl heeft het verwachte formaat: ${activationUrl}`);
  return match[1];
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uniqueEmail(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}@example.com`;
}

test("company admin-uitnodigingen: aanmaken, activeren en misbruik tegenhouden", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();

  const companyA = await createTestCompany("Invite Co A");
  const companyB = await createTestCompany("Invite Co B");
  const companyFull = await createTestCompany("Invite Co Vol");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });
  const managerA = await createTestUser({ companyId: companyA, role: "product_manager" });
  const fullUser = await createTestUser({ companyId: companyFull, role: "company_user" });

  // Seat-limiet via de company-override: 1 seat, al bezet door fullUser.
  await pool.request().input("id", sql.Int, companyFull).query("UPDATE dbo.Companies SET max_users = 1 WHERE id = @id");

  // Alle tokens die de test ziet, om achteraf te controleren dat ze nergens zijn opgeslagen.
  const seenTokens = [];

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB, companyFull],
      userIds: [owner.id, adminA.id, viewerA.id, managerA.id, fullUser.id]
    });
    await stopTestServer(server);
    await sql.close();
  });

  let ownerCookie;
  let adminCookie;
  let viewerCookie;
  let managerCookie;

  async function createInvite(companyId, body) {
    const res = await rawPost(baseUrl, `/api/admin/companies/${companyId}/invitations`, { cookie: ownerCookie, body });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const token = tokenFromUrl(res.data.activationUrl);
    seenTokens.push(token);
    return { res, token, invitation: res.data.invitation };
  }

  await t.test("setup: testgebruikers kunnen inloggen", async () => {
    ownerCookie = await login(baseUrl, owner);
    adminCookie = await login(baseUrl, adminA);
    viewerCookie = await login(baseUrl, viewerA);
    managerCookie = await login(baseUrl, managerA);
  });

  const mainEmail = uniqueEmail("nieuwe-admin");
  let mainToken;
  let mainInvitation;

  await t.test("System Owner maakt een invite: link met token in fragment, no-store", async () => {
    const { res, token, invitation } = await createInvite(companyA, {
      email: mainEmail.toUpperCase(),
      firstName: "Nina",
      lastName: "Nieuw"
    });
    mainToken = token;
    mainInvitation = invitation;

    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!res.data.activationUrl.includes("?"), "token nooit in de query string");
    assert.deepEqual(Object.keys(invitation).sort(), [
      "company_id",
      "created_at",
      "email",
      "expires_at",
      "first_name",
      "id",
      "last_name",
      "status"
    ]);
    assert.equal(invitation.company_id, companyA);
    assert.equal(invitation.email, mainEmail, "e-mail wordt genormaliseerd naar kleine letters");
    assert.equal(invitation.status, "pending");

    const hoursValid = (new Date(invitation.expires_at) - new Date(invitation.created_at)) / 3600000;
    assert.ok(Math.abs(hoursValid - 72) < 0.1, `expiry is 72 uur (was ${hoursValid})`);
  });

  await t.test("database bevat alleen de SHA-256-hash van het token", async () => {
    const result = await pool
      .request()
      .input("id", sql.Int, mainInvitation.id)
      .query("SELECT * FROM dbo.CompanyInvitations WHERE id = @id");
    const row = result.recordset[0];
    assert.equal(row.token_hash, sha256(mainToken));
    assert.ok(!JSON.stringify(row).includes(mainToken), "plaintext token staat nergens in de rij");

    const byToken = await pool
      .request()
      .input("token", sql.NVarChar(100), mainToken)
      .query("SELECT COUNT(*) AS n FROM dbo.CompanyInvitations WHERE token_hash = @token");
    assert.equal(byToken.recordset[0].n, 0);
  });

  await t.test("lookup geeft bedrijfsnaam en e-mail, zonder login", async () => {
    const res = await rawPost(baseUrl, "/api/invitations/lookup", { body: { token: mainToken } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.data.email, mainEmail);
    assert.equal(res.data.firstName, "Nina");
    assert.equal(res.data.lastName, "Nieuw");
    assert.equal(res.data.mode, "local");
    assert.match(res.data.companyName, /^Invite Co A /);
    assert.ok(res.data.expiresAt);
    assert.equal(res.data.token, undefined);
  });

  await t.test("lookup met onbekend, verminkt of in de URL meegegeven token geeft 404 INVITE_INVALID", async () => {
    const unknown = await request(baseUrl, "POST", "/api/invitations/lookup", {
      body: { token: crypto.randomBytes(32).toString("base64url") }
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error.code, "INVITE_INVALID");

    const malformed = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token: "kort'; DROP TABLE x--" } });
    assert.equal(malformed.status, 404);
    assert.equal(malformed.data.error.code, "INVITE_INVALID");
    assert.equal(malformed.data.error.message, unknown.data.error.message, "één generieke melding");

    const inQuery = await request(baseUrl, "POST", `/api/invitations/lookup?token=${mainToken}`, { body: {} });
    assert.equal(inQuery.status, 404);
  });

  await t.test("accept met zwak wachtwoord geeft 400 met details", async () => {
    const res = await request(baseUrl, "POST", "/api/invitations/accept", {
      body: { token: mainToken, password: "alleenkleineletters" }
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.details.fieldErrors.password.length >= 1);
  });

  let newAdminId;

  await t.test("accept maakt een company_admin in de company van de invite (body kan dat niet sturen)", async () => {
    const res = await request(baseUrl, "POST", "/api/invitations/accept", {
      body: {
        token: mainToken,
        password: STRONG_PASSWORD,
        // Pogingen om de invite te sturen: moeten genegeerd worden.
        companyId: companyB,
        company_id: companyB,
        role: "system_owner",
        email: uniqueEmail("kaper")
      }
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { email: mainEmail, redirectTo: "/login.html" });
    assert.equal(res.cookie, null, "geen automatische login");

    const users = await pool
      .request()
      .input("email", sql.NVarChar(256), mainEmail)
      .query("SELECT id, company_id, role, status, password_hash, first_name, last_name FROM dbo.Users WHERE email = @email");
    assert.equal(users.recordset.length, 1);
    const user = users.recordset[0];
    newAdminId = user.id;
    assert.equal(user.company_id, companyA);
    assert.equal(user.role, "company_admin");
    assert.equal(user.status, "active");
    assert.equal(user.first_name, "Nina");
    assert.match(user.password_hash, /^\$2[aby]\$/, "wachtwoord alleen als bcrypt-hash");
    assert.notEqual(user.password_hash, STRONG_PASSWORD);

    const invite = await pool
      .request()
      .input("id", sql.Int, mainInvitation.id)
      .query("SELECT accepted_at, accepted_user_id FROM dbo.CompanyInvitations WHERE id = @id");
    assert.ok(invite.recordset[0].accepted_at);
    assert.equal(invite.recordset[0].accepted_user_id, newAdminId);
  });

  await t.test("de nieuwe admin kan inloggen met het gekozen wachtwoord", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: mainEmail, password: STRONG_PASSWORD }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.role, "company_admin");
    assert.equal(res.data.companyId, companyA);
  });

  await t.test("hetzelfde token een tweede keer gebruiken faalt", async () => {
    const res = await request(baseUrl, "POST", "/api/invitations/accept", {
      body: { token: mainToken, password: STRONG_PASSWORD }
    });
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, "INVITE_INVALID");

    const lookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token: mainToken } });
    assert.equal(lookup.status, 404);
  });

  await t.test("gelijktijdige accepts met één token: precies één slaagt", async () => {
    const { token } = await createInvite(companyA, { email: uniqueEmail("race") });
    const results = await Promise.all(
      [1, 2].map(() => request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } }))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 1, `statussen: ${statuses}`);
    assert.ok([404, 409].includes(statuses.find((s) => s !== 200)));
  });

  await t.test("verlopen token werkt niet", async () => {
    const { token, invitation } = await createInvite(companyA, { email: uniqueEmail("verlopen") });
    await pool
      .request()
      .input("id", sql.Int, invitation.id)
      .query("UPDATE dbo.CompanyInvitations SET expires_at = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE id = @id");

    const lookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token } });
    assert.equal(lookup.status, 404);
    assert.equal(lookup.data.error.code, "INVITE_INVALID");

    const accept = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(accept.status, 404);
    assert.equal(accept.data.error.code, "INVITE_INVALID");

    const list = await request(baseUrl, "GET", "/api/admin/invitations?status=expired", { cookie: ownerCookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.some((i) => i.id === invitation.id && i.status === "expired"));
  });

  await t.test("ingetrokken token werkt niet; intrekken kan maar één keer", async () => {
    const { token, invitation } = await createInvite(companyA, { email: uniqueEmail("ingetrokken") });

    const revoke = await request(baseUrl, "POST", `/api/admin/invitations/${invitation.id}/revoke`, { cookie: ownerCookie });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.data.status, "revoked");
    assert.equal(revoke.data.token_hash, undefined, "hash hoort niet in API-responses");

    const accept = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(accept.status, 404);
    assert.equal(accept.data.error.code, "INVITE_INVALID");

    const again = await request(baseUrl, "POST", `/api/admin/invitations/${invitation.id}/revoke`, { cookie: ownerCookie });
    assert.equal(again.status, 409);
    assert.equal(again.data.error.code, "INVITE_NOT_PENDING");

    const missing = await request(baseUrl, "POST", "/api/admin/invitations/999999999/revoke", { cookie: ownerCookie });
    assert.equal(missing.status, 404);
    const badId = await request(baseUrl, "POST", "/api/admin/invitations/abc/revoke", { cookie: ownerCookie });
    assert.equal(badId.status, 404);
  });

  let resendSourceId;
  let resendToken;

  await t.test("nieuwe invite voor hetzelfde adres trekt de oude in", async () => {
    const email = uniqueEmail("dubbel");
    const first = await createInvite(companyA, { email });
    const second = await createInvite(companyA, { email });

    const list = await request(baseUrl, "GET", `/api/admin/companies/${companyA}/invitations`, { cookie: ownerCookie });
    assert.equal(list.status, 200);
    assert.equal(list.data.find((i) => i.id === first.invitation.id).status, "revoked");
    assert.equal(list.data.find((i) => i.id === second.invitation.id).status, "pending");

    const oldLookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token: first.token } });
    assert.equal(oldLookup.status, 404);

    resendSourceId = second.invitation.id;
    resendToken = second.token;
  });

  await t.test("resend: oude link ongeldig, nieuwe link werkt, no-store", async () => {
    const res = await rawPost(baseUrl, `/api/admin/invitations/${resendSourceId}/resend`, { cookie: ownerCookie });
    // 201 zoals aanmaken: resend levert een nieuwe invite-rij op (docs §8).
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.headers.get("cache-control"), "no-store");
    const newToken = tokenFromUrl(res.data.activationUrl);
    seenTokens.push(newToken);
    assert.notEqual(newToken, resendToken);
    assert.notEqual(res.data.invitation.id, resendSourceId);
    assert.equal(res.data.invitation.status, "pending");

    const oldLookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token: resendToken } });
    assert.equal(oldLookup.status, 404);
    const newLookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token: newToken } });
    assert.equal(newLookup.status, 200);

    const audit = await pool
      .request()
      .input("entityId", sql.NVarChar(50), String(res.data.invitation.id))
      .query("SELECT metadata FROM dbo.AuditLogs WHERE action = 'invite_create' AND entity_id = @entityId");
    assert.equal(audit.recordset.length, 1);
    assert.equal(JSON.parse(audit.recordset[0].metadata).resend, true);

    const resendRevoked = await request(baseUrl, "POST", `/api/admin/invitations/${resendSourceId}/resend`, {
      cookie: ownerCookie
    });
    assert.equal(resendRevoked.status, 409);
    assert.equal(resendRevoked.data.error.code, "INVITE_NOT_PENDING");
  });

  await t.test("lijst van alle invites met status-filter en bedrijfsnaam", async () => {
    const pending = await request(baseUrl, "GET", "/api/admin/invitations?status=pending", { cookie: ownerCookie });
    assert.equal(pending.status, 200);
    assert.ok(pending.data.length >= 1);
    assert.ok(pending.data.every((i) => i.status === "pending"));
    const ours = pending.data.find((i) => i.company_id === companyA);
    assert.ok(ours.company_name);
    assert.equal(ours.created_by_email, owner.email);
    assert.equal(ours.token_hash, undefined);

    const all = await request(baseUrl, "GET", "/api/admin/invitations", { cookie: ownerCookie });
    assert.equal(all.status, 200);
    assert.ok(all.data.some((i) => i.status === "accepted" && i.id === mainInvitation.id));

    const bad = await request(baseUrl, "GET", "/api/admin/invitations?status=bogus", { cookie: ownerCookie });
    assert.equal(bad.status, 400);
  });

  await t.test("company-rollen kunnen geen invites maken, lijsten of intrekken", async () => {
    for (const cookie of [adminCookie, viewerCookie, managerCookie]) {
      const create = await request(baseUrl, "POST", `/api/admin/companies/${companyA}/invitations`, {
        cookie,
        body: { email: uniqueEmail("zelf") }
      });
      assert.equal(create.status, 403);

      const list = await request(baseUrl, "GET", "/api/admin/invitations", { cookie });
      assert.equal(list.status, 403);

      const revoke = await request(baseUrl, "POST", `/api/admin/invitations/${mainInvitation.id}/revoke`, { cookie });
      assert.equal(revoke.status, 403);

      const resend = await request(baseUrl, "POST", `/api/admin/invitations/${mainInvitation.id}/resend`, { cookie });
      assert.equal(resend.status, 403);
    }

    const anonymous = await request(baseUrl, "POST", `/api/admin/companies/${companyA}/invitations`, {
      body: { email: uniqueEmail("anoniem") }
    });
    assert.equal(anonymous.status, 401);
  });

  await t.test("invite voor bestaand e-mailadres, onbekende of inactieve company wordt geweigerd", async () => {
    const inUse = await request(baseUrl, "POST", `/api/admin/companies/${companyA}/invitations`, {
      cookie: ownerCookie,
      body: { email: adminA.email }
    });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.data.error.code, "EMAIL_IN_USE");

    const missing = await request(baseUrl, "POST", "/api/admin/companies/999999999/invitations", {
      cookie: ownerCookie,
      body: { email: uniqueEmail("nergens") }
    });
    assert.equal(missing.status, 404);

    const invalidEmail = await request(baseUrl, "POST", `/api/admin/companies/${companyA}/invitations`, {
      cookie: ownerCookie,
      body: { email: "geen-email" }
    });
    assert.equal(invalidEmail.status, 400);

    await pool.request().input("id", sql.Int, companyB).query("UPDATE dbo.Companies SET status = 'suspended' WHERE id = @id");
    const inactive = await request(baseUrl, "POST", `/api/admin/companies/${companyB}/invitations`, {
      cookie: ownerCookie,
      body: { email: uniqueEmail("inactief") }
    });
    assert.equal(inactive.status, 409);
    assert.equal(inactive.data.error.code, "COMPANY_INACTIVE");
    await pool.request().input("id", sql.Int, companyB).query("UPDATE dbo.Companies SET status = 'active' WHERE id = @id");
  });

  await t.test("invite van een later gedeactiveerde company is ongeldig", async () => {
    const { token } = await createInvite(companyB, { email: uniqueEmail("later-inactief") });
    await pool.request().input("id", sql.Int, companyB).query("UPDATE dbo.Companies SET status = 'suspended' WHERE id = @id");

    const lookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token } });
    assert.equal(lookup.status, 404);
    const accept = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(accept.status, 404);
    assert.equal(accept.data.error.code, "INVITE_INVALID");

    await pool.request().input("id", sql.Int, companyB).query("UPDATE dbo.Companies SET status = 'active' WHERE id = @id");
  });

  await t.test("seat-limiet wordt afgedwongen bij accepteren; de invite blijft dan bruikbaar", async () => {
    const email = uniqueEmail("vol");
    const { token, invitation } = await createInvite(companyFull, { email });

    const full = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(full.status, 409);
    assert.equal(full.data.error.code, "LICENSE_LIMIT_REACHED");

    const inviteRow = await pool
      .request()
      .input("id", sql.Int, invitation.id)
      .query("SELECT accepted_at FROM dbo.CompanyInvitations WHERE id = @id");
    assert.equal(inviteRow.recordset[0].accepted_at, null, "invite niet geconsumeerd bij een volle company");

    const users = await pool
      .request()
      .input("email", sql.NVarChar(256), email)
      .query("SELECT COUNT(*) AS n FROM dbo.Users WHERE email = @email");
    assert.equal(users.recordset[0].n, 0);

    await pool.request().input("id", sql.Int, companyFull).query("UPDATE dbo.Companies SET max_users = 2 WHERE id = @id");
    const ok = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  });

  await t.test("gelijktijdige accepts voor de laatste seat: één slaagt, de ander krijgt LICENSE_LIMIT_REACHED", async () => {
    // companyFull heeft nu max_users = 2 en 2 actieve users; één seat erbij.
    await pool.request().input("id", sql.Int, companyFull).query("UPDATE dbo.Companies SET max_users = 3 WHERE id = @id");
    const first = await createInvite(companyFull, { email: uniqueEmail("laatste-a") });
    const second = await createInvite(companyFull, { email: uniqueEmail("laatste-b") });

    const results = await Promise.all(
      [first.token, second.token].map((token) =>
        request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.data)));
    assert.equal(results.find((r) => r.status === 409).data.error.code, "LICENSE_LIMIT_REACHED");

    const active = await pool
      .request()
      .input("id", sql.Int, companyFull)
      .query("SELECT COUNT(*) AS n FROM dbo.Users WHERE company_id = @id AND status = 'active'");
    assert.equal(active.recordset[0].n, 3);
  });

  await t.test("Entra-modus: identity via Graph, geen lokaal wachtwoord; mislukte insert schakelt het account uit", async () => {
    const graphClient = require("../src/services/graphClient");
    const entraVars = {
      ENTRA_TENANT_NAME: "dpptest",
      ENTRA_TENANT_ID: "00000000-0000-0000-0000-000000000000",
      ENTRA_WEB_CLIENT_ID: "test-web-client",
      ENTRA_WEB_CLIENT_SECRET: crypto.randomBytes(16).toString("hex"),
      ENTRA_REDIRECT_URI: "http://localhost/auth/redirect",
      ENTRA_POST_LOGOUT_REDIRECT_URI: "http://localhost/login.html",
      COOKIE_SECRET: crypto.randomBytes(32).toString("hex"),
      ENTRA_GRAPH_CLIENT_ID: "test-graph-client",
      ENTRA_GRAPH_CLIENT_SECRET: crypto.randomBytes(16).toString("hex")
    };
    const savedEnv = Object.fromEntries(Object.keys(entraVars).map((key) => [key, process.env[key]]));
    const original = { create: graphClient.createEntraUser, enable: graphClient.setAccountEnabled };
    const createCalls = [];
    const enableCalls = [];
    let beforeReturn = async () => {};

    Object.assign(process.env, entraVars);
    graphClient.createEntraUser = async (args) => {
      createCalls.push(args);
      await beforeReturn(args);
      return { entraObjectId: crypto.randomUUID() };
    };
    graphClient.setAccountEnabled = async (id, enabled) => {
      enableCalls.push({ id, enabled });
    };

    try {
      const email = uniqueEmail("entra");
      const { token } = await createInvite(companyA, { email, firstName: "Eva", lastName: "Entra" });

      const lookup = await request(baseUrl, "POST", "/api/invitations/lookup", { body: { token } });
      assert.equal(lookup.data.mode, "entra");

      const ok = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(createCalls.length, 1);
      assert.equal(createCalls[0].email, email);
      assert.equal(createCalls[0].displayName, "Eva Entra");
      assert.equal(createCalls[0].forceChangePasswordNextSignIn, false);

      const row = await pool
        .request()
        .input("email", sql.NVarChar(256), email)
        .query("SELECT password_hash, entra_object_id, role, company_id FROM dbo.Users WHERE email = @email");
      assert.equal(row.recordset[0].password_hash, null, "geen lokaal wachtwoord in Entra-modus");
      assert.ok(row.recordset[0].entra_object_id);
      assert.equal(row.recordset[0].role, "company_admin");
      assert.equal(row.recordset[0].company_id, companyA);

      // Race nabootsen: tijdens de Graph-call claimt iemand anders hetzelfde e-mailadres.
      const raceEmail = uniqueEmail("entra-race");
      const race = await createInvite(companyA, { email: raceEmail });
      beforeReturn = async () => {
        beforeReturn = async () => {};
        await createTestUser({ companyId: companyB, role: "viewer" }).then((user) =>
          pool
            .request()
            .input("id", sql.Int, user.id)
            .input("email", sql.NVarChar(256), raceEmail)
            .query("UPDATE dbo.Users SET email = @email WHERE id = @id")
        );
      };
      const conflict = await request(baseUrl, "POST", "/api/invitations/accept", {
        body: { token: race.token, password: STRONG_PASSWORD }
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error.code, "EMAIL_IN_USE");
      assert.equal(enableCalls.length, 1, "verweesd Entra-account wordt uitgeschakeld");
      assert.equal(enableCalls[0].enabled, false);

      const raceInvite = await pool
        .request()
        .input("hash", sql.Char(64), sha256(race.token))
        .query("SELECT accepted_at FROM dbo.CompanyInvitations WHERE token_hash = @hash");
      assert.equal(raceInvite.recordset[0].accepted_at, null, "transactie teruggedraaid");
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      graphClient.createEntraUser = original.create;
      graphClient.setAccountEnabled = original.enable;
    }
  });

  await t.test("gefaseerde Entra-setup (alleen login, nog geen Graph): accepteren faalt dicht, invite blijft bruikbaar", async () => {
    const graphClient = require("../src/services/graphClient");
    const loginVars = {
      ENTRA_TENANT_NAME: "dpptest",
      ENTRA_TENANT_ID: crypto.randomUUID(),
      ENTRA_WEB_CLIENT_ID: crypto.randomUUID(),
      ENTRA_WEB_CLIENT_SECRET: crypto.randomBytes(16).toString("hex"),
      ENTRA_REDIRECT_URI: "http://localhost/auth/redirect",
      ENTRA_POST_LOGOUT_REDIRECT_URI: "http://localhost/login.html",
      COOKIE_SECRET: crypto.randomBytes(32).toString("hex")
    };
    const graphVarNames = ["ENTRA_GRAPH_CLIENT_ID", "ENTRA_GRAPH_CLIENT_SECRET"];
    const savedEnv = Object.fromEntries([...Object.keys(loginVars), ...graphVarNames].map((key) => [key, process.env[key]]));
    const originalCreate = graphClient.createEntraUser;
    let graphCalls = 0;
    graphClient.createEntraUser = async () => {
      graphCalls += 1;
      throw new Error("Graph hoort hier niet aangeroepen te worden");
    };

    const email = uniqueEmail("login-only");
    const { token } = await createInvite(companyA, { email });
    try {
      Object.assign(process.env, loginVars);
      for (const key of graphVarNames) delete process.env[key];

      // Lokale login is nu dicht: een lokaal wachtwoord zou een admin opleveren die nergens
      // kan inloggen, en de invite zou verbruikt zijn.
      const res = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
      assert.equal(res.status, 503, JSON.stringify(res.data));
      assert.equal(res.data.error.code, "IDENTITY_PROVIDER_NOT_CONFIGURED");
      assert.equal(graphCalls, 0);
      const users = await pool.request().input("email", sql.NVarChar(256), email).query("SELECT id FROM dbo.Users WHERE email = @email");
      assert.equal(users.recordset.length, 0, "geen user aangemaakt");
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      graphClient.createEntraUser = originalCreate;
    }

    // Zelfde invite werkt weer zodra de configuratie compleet (hier: weer lokaal) is.
    const later = await request(baseUrl, "POST", "/api/invitations/accept", { body: { token, password: STRONG_PASSWORD } });
    assert.equal(later.status, 200, JSON.stringify(later.data));
  });

  await t.test("audit log bevat create/accept/revoke, maar nooit een token of hash", async () => {
    const result = await pool
      .request()
      .query(
        `SELECT action, user_id, company_id, entity_type, metadata FROM dbo.AuditLogs
         WHERE company_id IN (${[companyA, companyB, companyFull].map(Number).join(",")})
           AND action IN ('invite_create', 'invite_accept', 'invite_revoke')`
      );
    const actions = new Set(result.recordset.map((row) => row.action));
    assert.ok(actions.has("invite_create"));
    assert.ok(actions.has("invite_accept"));
    assert.ok(actions.has("invite_revoke"));

    const accept = result.recordset.find((row) => row.action === "invite_accept" && row.user_id === newAdminId);
    assert.ok(accept, "invite_accept met de nieuwe user als actor");
    assert.equal(accept.company_id, companyA);
    assert.equal(accept.entity_type, "CompanyInvitation");

    const dump = JSON.stringify(result.recordset);
    for (const token of seenTokens) {
      assert.ok(!dump.includes(token), "token staat niet in de audit log");
      assert.ok(!dump.includes(sha256(token)), "token-hash staat niet in de audit log");
    }
    assert.ok(!dump.includes(STRONG_PASSWORD));
  });

  await t.test("publieke endpoints zijn rate-limited", async () => {
    let limited = null;
    for (let i = 0; i < 30 && !limited; i += 1) {
      const res = await request(baseUrl, "POST", "/api/invitations/lookup", {
        body: { token: crypto.randomBytes(32).toString("base64url") }
      });
      if (res.status === 429) limited = res;
    }
    assert.ok(limited, "na maximaal 20 pogingen volgt een 429");
    assert.equal(limited.data.error.code, "RATE_LIMITED");
  });
});
