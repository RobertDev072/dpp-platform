const crypto = require("crypto");
const { query, queryOne } = require("../../src/config/db");
const { hashPassword } = require("../../src/utils/password");

function uniqueSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

async function createTestCompany(name = "Test Company") {
  const suffix = uniqueSuffix();
  const row = await queryOne(`INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`, [
    `${name} ${suffix}`,
    `test-${suffix}`
  ]);
  return row.id;
}

async function createTestUser({ companyId = null, role, password = "TestPassword123!" }) {
  const suffix = uniqueSuffix();
  const email = `test-${suffix}@example.com`;
  const passwordHash = await hashPassword(password);

  const row = await queryOne(
    `INSERT INTO users (company_id, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [companyId, email, passwordHash, role]
  );

  return { id: row.id, email, password, companyId, role };
}

async function createTestProduct({ companyId, name = "Test Product" }) {
  const suffix = uniqueSuffix();
  const row = await queryOne(
    `INSERT INTO products (company_id, name, status) VALUES ($1, $2, 'draft') RETURNING id`,
    [companyId, `${name} ${suffix}`]
  );
  return row.id;
}

// Ruimt testdata op in FK-volgorde. Ids worden als int-array doorgegeven
// (= ANY($1::int[])), nooit in de SQL-tekst geplakt.
async function cleanupTestData({ companyIds = [], userIds = [], productIds = [] }) {
  const companies = companyIds.map(Number);
  const users = userIds.map(Number);
  const products = productIds.map(Number);

  if (users.length) {
    await query(`DELETE FROM sessions WHERE user_id = ANY($1::int[]) OR impersonator_user_id = ANY($1::int[])`, [users]);
    await query(`DELETE FROM audit_logs WHERE user_id = ANY($1::int[])`, [users]);
  }
  if (companies.length) {
    await query(`DELETE FROM audit_logs WHERE company_id = ANY($1::int[])`, [companies]);
    await query(`DELETE FROM import_jobs WHERE company_id = ANY($1::int[])`, [companies]);
    await query(`DELETE FROM print_profiles WHERE company_id = ANY($1::int[])`, [companies]);
    // Invites verwijzen naar zowel company als invited_by-user; weg vóór beide.
    await query(`DELETE FROM company_admin_invites WHERE company_id = ANY($1::int[])`, [companies]);
    // Kindtabellen van producten moeten weg vóór de producten zelf.
    for (const table of ["scan_events", "documents", "product_parts", "product_batches", "product_sustainability", "product_compliance"]) {
      await query(
        `DELETE FROM ${table} WHERE product_id IN (SELECT id FROM products WHERE company_id = ANY($1::int[]))`,
        [companies]
      );
    }
    await query(`DELETE FROM products WHERE company_id = ANY($1::int[])`, [companies]);
  }
  if (products.length) {
    for (const table of ["scan_events", "documents", "product_parts", "product_batches", "product_sustainability", "product_compliance"]) {
      await query(`DELETE FROM ${table} WHERE product_id = ANY($1::int[])`, [products]);
    }
    await query(`DELETE FROM products WHERE id = ANY($1::int[])`, [products]);
  }
  if (users.length) {
    await query(`DELETE FROM company_admin_invites WHERE invited_by = ANY($1::int[])`, [users]);
    await query(`UPDATE products SET created_by = NULL WHERE created_by = ANY($1::int[])`, [users]);
    await query(`DELETE FROM users WHERE id = ANY($1::int[])`, [users]);
  }
  if (companies.length) {
    // Klanten van een partner eerst ontkoppelen (FK partner_id).
    await query(`UPDATE companies SET partner_id = NULL WHERE partner_id = ANY($1::int[])`, [companies]);
    await query(`DELETE FROM users WHERE company_id = ANY($1::int[])`, [companies]);
    await query(`DELETE FROM companies WHERE id = ANY($1::int[])`, [companies]);
  }
}

module.exports = { createTestCompany, createTestUser, createTestProduct, cleanupTestData };
