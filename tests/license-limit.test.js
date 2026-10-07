const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { query, closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

test("license limit: nieuwe gebruiker boven max_users geeft LICENSE_LIMIT_REACHED", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const planResult = await query(`
      INSERT INTO plans (name, max_users, max_products)
      VALUES ($1, $2, 10) RETURNING id`, ["Test Plan", 1]);
  const planId = planResult.rows[0].id;

  const companyId = await createTestCompany("License Limit Co");
  await query("UPDATE companies SET plan_id = $1 WHERE id = $2", [planId, companyId]);

  const admin = await createTestUser({ companyId, role: "company_admin" });
  const userIds = [admin.id];
  let createdUserId;
  let createdAuthUserId;

  t.after(async () => {
    if (createdUserId) userIds.push(createdUserId);
    await cleanupTestData({ companyIds: [companyId], userIds });
    await query("DELETE FROM plans WHERE id = $1", [planId]);
    // Met Supabase Auth geconfigureerd maakt de succesvolle aanmaak een ECHT
    // Supabase-account aan - dat moet mee opgeruimd worden (scripts/cleanup-test-data.js
    // veegt achterblijvers).
    if (createdAuthUserId) {
      try {
        await require("../src/services/identity.service").deleteAuthUser(createdAuthUserId);
      } catch (error) {
        console.error("Supabase-testaccount opruimen mislukt:", error.message);
      }
    }
    await stopTestServer(server);
    await closePool();
  });

  const adminCookie = await login(baseUrl, admin);

  await t.test("company zit al op max_users=1 door de bestaande admin", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: adminCookie,
      body: {
        email: `overlimiet-${suffix}@example.com`,
        password: "GeldigWachtwoord123!",
        role: "company_user"
      }
    });

    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "LICENSE_LIMIT_REACHED");
  });

  await t.test("na verhogen van max_users lukt aanmaken wel", async () => {
    await query("UPDATE plans SET max_users = 5 WHERE id = $1", [planId]);

    const suffix = crypto.randomBytes(4).toString("hex");
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: adminCookie,
      body: {
        email: `binnen-limiet-${suffix}@example.com`,
        password: "GeldigWachtwoord123!",
        role: "company_user"
      }
    });

    assert.equal(res.status, 201);
    createdUserId = res.data.id;
    createdAuthUserId = res.data.auth_user_id || null;
  });
});
