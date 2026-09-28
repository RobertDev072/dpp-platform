const crypto = require("crypto");
const { getPool, sql } = require("../../src/config/db");
const { hashPassword } = require("../../src/utils/password");

function uniqueSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

async function createTestCompany(name = "Test Company") {
  const pool = await getPool();
  const suffix = uniqueSuffix();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(200), `${name} ${suffix}`)
    .input("slug", sql.NVarChar(100), `test-${suffix}`)
    .query(`
      INSERT INTO dbo.Companies (name, slug)
      OUTPUT INSERTED.id
      VALUES (@name, @slug)
    `);
  return result.recordset[0].id;
}

async function createTestUser({ companyId = null, role, password = "TestPassword123!" }) {
  const pool = await getPool();
  const suffix = uniqueSuffix();
  const email = `test-${suffix}@example.com`;
  const passwordHash = await hashPassword(password);

  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .input("passwordHash", sql.NVarChar(255), passwordHash)
    .input("role", sql.NVarChar(30), role)
    .query(`
      INSERT INTO dbo.Users (company_id, email, password_hash, role, status)
      OUTPUT INSERTED.id
      VALUES (@companyId, @email, @passwordHash, @role, 'active')
    `);

  return { id: result.recordset[0].id, email, password, companyId, role };
}

async function createTestProduct({ companyId, name = "Test Product" }) {
  const pool = await getPool();
  const suffix = uniqueSuffix();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("name", sql.NVarChar(200), `${name} ${suffix}`)
    .query(`
      INSERT INTO dbo.Products (company_id, name, status)
      OUTPUT INSERTED.id
      VALUES (@companyId, @name, 'draft')
    `);
  return result.recordset[0].id;
}

// Verwijdert in FK-volgorde. Ids worden naar Number geforceerd, dus de string-interpolatie
// hieronder bevat alleen getallen (testhelper, nooit met gebruikersinvoer aangeroepen).
async function cleanupTestData({ companyIds = [], userIds = [], productIds = [] }) {
  const pool = await getPool();
  const companies = companyIds.map(Number).filter(Number.isInteger);
  const users = userIds.map(Number).filter(Number.isInteger);
  const products = productIds.map(Number).filter(Number.isInteger);
  const run = (query) => pool.request().query(query);

  if (companies.length) {
    // Alle users van deze companies meenemen, ook die tijdens een test via de API zijn aangemaakt.
    const extra = await run(`SELECT id FROM dbo.Users WHERE company_id IN (${companies.join(",")})`);
    for (const row of extra.recordset) if (!users.includes(row.id)) users.push(row.id);
    const extraProducts = await run(`SELECT id FROM dbo.Products WHERE company_id IN (${companies.join(",")})`);
    for (const row of extraProducts.recordset) if (!products.includes(row.id)) products.push(row.id);
  }

  if (products.length) {
    await run(`DELETE FROM dbo.ScanEvents WHERE product_id IN (${products.join(",")})`);
    await run(`DELETE FROM dbo.Documents WHERE product_id IN (${products.join(",")})`);
  }
  if (companies.length) {
    await run(`DELETE FROM dbo.Documents WHERE company_id IN (${companies.join(",")})`);
    await run(`DELETE FROM dbo.CompanyInvitations WHERE company_id IN (${companies.join(",")})`);
    await run(`DELETE FROM dbo.AuditLogs WHERE company_id IN (${companies.join(",")})`);
  }
  if (users.length) {
    await run(`DELETE FROM dbo.CompanyInvitations WHERE created_by IN (${users.join(",")}) OR accepted_user_id IN (${users.join(",")})`);
    await run(`DELETE FROM dbo.Documents WHERE created_by IN (${users.join(",")})`);
    await run(`DELETE FROM dbo.Sessions WHERE user_id IN (${users.join(",")})`);
    await run(`DELETE FROM dbo.AuditLogs WHERE user_id IN (${users.join(",")})`);
    await run(`UPDATE dbo.Products SET created_by = NULL, updated_by = NULL WHERE created_by IN (${users.join(",")}) OR updated_by IN (${users.join(",")})`);
  }
  if (products.length) {
    await run(`DELETE FROM dbo.Products WHERE id IN (${products.join(",")})`);
  }
  if (users.length) {
    await run(`DELETE FROM dbo.Users WHERE id IN (${users.join(",")})`);
  }
  if (companies.length) {
    await run(`DELETE FROM dbo.Companies WHERE id IN (${companies.join(",")})`);
  }
}

module.exports = { createTestCompany, createTestUser, createTestProduct, cleanupTestData };
