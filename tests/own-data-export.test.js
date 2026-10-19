const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

// AVG art. 15/20: een gebruiker downloadt zijn eigen gegevens, zonder geheimen.
test("eigen gegevens downloaden: compleet, zonder geheimen, alleen eigen account", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("Export AVG");
  const user = await createTestUser({ companyId: company, role: "company_user" });
  const other = await createTestUser({ companyId: company, role: "company_user" });
  t.after(async () => {
    await cleanupTestData({ companyIds: [company], userIds: [user.id, other.id] });
    await stopTestServer(server);
    await sql.close();
  });
  assert.equal((await request(baseUrl, "GET", "/api/auth/me/export")).status, 401);
  const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  const res = await fetch(`${baseUrl}/api/auth/me/export`, { headers: { Cookie: login.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="veripasso-mijn-gegevens-/);
  const text = await res.text();
  const data = JSON.parse(text);
  assert.equal(data.account.email, user.email);
  assert.ok(Array.isArray(data.sessies) && data.sessies.length >= 1);
  assert.ok(data.activiteit.some((a) => a.action === "login"));
  for (const secret of ["password_hash", "mfa_secret", "recovery", "token_hash", user.password]) {
    assert.ok(!text.includes(secret), `bevat geen ${secret}`);
  }
  assert.ok(!text.includes(other.email), "geen gegevens van anderen");
});
