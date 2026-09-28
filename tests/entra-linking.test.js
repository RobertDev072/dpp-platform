const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
const { resolveEntraLogin, EntraLoginError } = require("../src/services/entraLogin.service");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

function fakeSub() {
  return crypto.randomBytes(16).toString("hex");
}

test("entra login: just-in-time koppeling van sub aan bestaand DPP-account", async (t) => {
  const companyId = await createTestCompany("Entra Test Co");
  // Simuleert een door een admin aangemaakt, nog niet gekoppeld account: geen wachtwoord,
  // geen entra_subject_id — precies de staat waarin een Entra-geprovisioneerde user
  // in dbo.Users terechtkomt vóór de eerste succesvolle login.
  const pool = await getPool();
  const suffix = crypto.randomBytes(4).toString("hex");
  const email = `entra-test-${suffix}@example.com`;
  const insertResult = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .input("role", sql.NVarChar(30), "company_user")
    .query(`
      INSERT INTO dbo.Users (company_id, email, password_hash, entra_object_id, role, status)
      OUTPUT INSERTED.id
      VALUES (@companyId, @email, NULL, 'fake-graph-object-id', @role, 'active')
    `);
  const userId = insertResult.recordset[0].id;
  const userIds = [userId];

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds });
  });

  const sub = fakeSub();

  await t.test("eerste login koppelt op basis van e-mail en zet entra_subject_id", async () => {
    const user = await resolveEntraLogin({ sub, email });
    assert.equal(user.id, userId);
    assert.equal(user.company_id, companyId);

    const check = await pool
      .request()
      .input("id", sql.Int, userId)
      .query("SELECT entra_subject_id FROM dbo.Users WHERE id = @id");
    assert.equal(check.recordset[0].entra_subject_id, sub);
  });

  await t.test("tweede login matcht direct op entra_subject_id, ongeacht e-mail", async () => {
    const user = await resolveEntraLogin({ sub, email: "compleet-ander-adres@example.com" });
    assert.equal(user.id, userId);
  });

  await t.test("onbekende identiteit zonder gekoppeld DPP-account wordt geweigerd", async () => {
    await assert.rejects(
      () => resolveEntraLogin({ sub: fakeSub(), email: "nooit-aangemaakt@example.com" }),
      EntraLoginError
    );
  });
});

test("entra login: gedeactiveerd account wordt geweigerd ondanks geldige koppeling", async (t) => {
  const companyId = await createTestCompany("Entra Inactive Co");
  const user = await createTestUser({ companyId, role: "viewer" });
  const sub = fakeSub();

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [user.id] });
  });

  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, user.id)
    .input("sub", sql.NVarChar(255), sub)
    .query("UPDATE dbo.Users SET entra_subject_id = @sub, status = 'inactive' WHERE id = @id");

  await assert.rejects(() => resolveEntraLogin({ sub, email: user.email }), EntraLoginError);
});

after(async () => {
  await sql.close();
});
