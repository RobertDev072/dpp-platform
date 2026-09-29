const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
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
  const pool = await getPool();

  const planResult = await pool
    .request()
    .input("name", sql.NVarChar(100), "Test Plan")
    .input("maxUsers", sql.Int, 1)
    .query(`
      INSERT INTO dbo.Plans (name, max_users, max_products)
      OUTPUT INSERTED.id
      VALUES (@name, @maxUsers, 10)
    `);
  const planId = planResult.recordset[0].id;

  const companyId = await createTestCompany("License Limit Co");
  await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("planId", sql.Int, planId)
    .query("UPDATE dbo.Companies SET plan_id = @planId WHERE id = @companyId");

  const admin = await createTestUser({ companyId, role: "company_admin" });
  const userIds = [admin.id];
  let createdUserId;
  let createdEntraObjectId;

  t.after(async () => {
    if (createdUserId) userIds.push(createdUserId);
    await cleanupTestData({ companyIds: [companyId], userIds });
    await pool.request().input("planId", sql.Int, planId).query("DELETE FROM dbo.Plans WHERE id = @planId");
    // Met Entra-provisioning geconfigureerd maakt de succesvolle aanmaak een ECHT
    // Entra-account aan - dat moet mee opgeruimd worden, anders slibt de tenant
    // dicht met testaccounts (scripts/cleanup-test-data.js veegt achterblijvers).
    if (createdEntraObjectId) {
      try {
        const graphClient = require("../src/services/graphClient");
        await graphClient.deleteEntraUser(createdEntraObjectId);
      } catch (error) {
        console.error("Entra-testaccount opruimen mislukt:", error.message);
      }
    }
    await stopTestServer(server);
    await sql.close();
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
    await pool.request().input("planId", sql.Int, planId).query("UPDATE dbo.Plans SET max_users = 5 WHERE id = @planId");

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
    createdEntraObjectId = res.data.entra_object_id || null;
  });
});
