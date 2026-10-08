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
      VALUES (@name, @slug) RETURNING id
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
      VALUES (@companyId, @email, @passwordHash, @role, 'active') RETURNING id
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
      VALUES (@companyId, @name, 'draft') RETURNING id
    `);
  return result.recordset[0].id;
}

// Alles wat via een FK aan producten hangt (scans, documenten, onderdelen, ...) moet
// weg vóór de producten zelf. productIds: kommalijst of subquery.
async function deleteProductChildren(pool, productIds) {
  for (const table of ["ScanEvents", "Documents", "ProductParts", "ProductBatches", "ProductSustainability", "ProductCompliance"]) {
    await pool.request().query(`DELETE FROM dbo.${table} WHERE product_id IN (${productIds})`);
  }
}

async function cleanupTestData({ companyIds = [], userIds = [], productIds = [] }) {
  const pool = await getPool();
  const companies = companyIds.map(Number);
  const users = userIds.map(Number);
  const products = productIds.map(Number);

  if (users.length) {
    await pool.request().query(`DELETE FROM dbo.Sessions WHERE user_id IN (${users.join(",")})`);
    await pool.request().query(`DELETE FROM dbo.AuditLogs WHERE user_id IN (${users.join(",")})`);
  }
  if (companies.length) {
    await pool.request().query(`DELETE FROM dbo.AuditLogs WHERE company_id IN (${companies.join(",")})`);
    // Invites verwijzen naar zowel company als invited_by-user; weg vóór beide.
    await pool.request().query(`DELETE FROM dbo.CompanyAdminInvites WHERE company_id IN (${companies.join(",")})`);
    // Importjobs en printprofielen verwijzen naar company én created_by-user.
    await pool.request().query(`DELETE FROM dbo.ProductImports WHERE company_id IN (${companies.join(",")})`);
    await pool.request().query(`DELETE FROM dbo.PrintProfiles WHERE company_id IN (${companies.join(",")})`);
    // ScanEvents heeft een FK naar Products - moet weg vóór de Products zelf verwijderd
    // worden (raakt gevuld zodra een test de publieke paspoortpagina bezoekt).
    await deleteProductChildren(pool, `SELECT id FROM dbo.Products WHERE company_id IN (${companies.join(",")})`);
    await pool.request().query(`DELETE FROM dbo.Products WHERE company_id IN (${companies.join(",")})`);
  }
  if (products.length) {
    await deleteProductChildren(pool, products.join(","));
    await pool.request().query(`DELETE FROM dbo.Products WHERE id IN (${products.join(",")})`);
  }
  if (users.length) {
    await pool.request().query(`DELETE FROM dbo.Users WHERE id IN (${users.join(",")})`);
  }
  if (companies.length) {
    await pool.request().query(`DELETE FROM dbo.Companies WHERE id IN (${companies.join(",")})`);
  }
}

module.exports = { createTestCompany, createTestUser, createTestProduct, cleanupTestData };
