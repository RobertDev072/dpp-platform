const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// Gedwongen wachtwoordwijziging bij eerste login met een tijdelijk wachtwoord:
// zolang must_change_password aan staat maakt de login geen sessie aan; pas na
// /change-password (geverifieerd met het tijdelijke wachtwoord) ontstaat de sessie.
// Getest op het lokale bcrypt-pad (geen externe afhankelijkheden).

test("gedwongen wachtwoordwijziging: login blokkeert tot een nieuw wachtwoord is ingesteld", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyId = await createTestCompany("MustChange Co");
  const user = await createTestUser({ companyId, role: "company_user" });
  const NEW_PASSWORD = "SplinterNieuwWachtwoord1!";

  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, user.id)
    .query("UPDATE dbo.Users SET must_change_password = true WHERE id = @id");

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [user.id] });
    await stopTestServer(server);
  });

  await t.test("login met het tijdelijke wachtwoord geeft mustChangePassword zonder sessie", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: user.email, password: user.password }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.mustChangePassword, true);
    assert.equal(res.cookie, null, "er mag nog geen sessie-cookie gezet worden");
  });

  await t.test("change-password met verkeerd huidig wachtwoord geeft 401", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: user.email, currentPassword: "fout-wachtwoord", newPassword: NEW_PASSWORD }
    });
    assert.equal(res.status, 401);
  });

  await t.test("te kort nieuw wachtwoord geeft 400 met veldfout", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: user.email, currentPassword: user.password, newPassword: "tekort" }
    });
    assert.equal(res.status, 400);
  });

  let sessionCookie;

  await t.test("geldige wijziging logt direct in (sessie-cookie gezet)", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: user.email, currentPassword: user.password, newPassword: NEW_PASSWORD }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.email, user.email);
    assert.ok(res.cookie, "verwacht een sessie-cookie");
    sessionCookie = res.cookie;

    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.id, user.id);
  });

  await t.test("daarna: login met het nieuwe wachtwoord werkt normaal (geen mustChangePassword meer)", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: user.email, password: NEW_PASSWORD }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.mustChangePassword, undefined);
    assert.equal(res.data.email, user.email);
  });

  await t.test("het oude (tijdelijke) wachtwoord werkt niet meer", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: user.email, password: user.password }
    });
    assert.equal(res.status, 401);
  });
});

after(async () => {
  await sql.close();
});
