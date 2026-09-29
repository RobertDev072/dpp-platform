// Ruimt restanten van geautomatiseerde testruns op die crashten vóór hun eigen
// cleanup: gebruikers test-<hex>@example.com en bedrijven met slug test-<hex>.
// Bewust strak patroon (8 hex-tekens) zodat echte data nooit kan matchen.
// Gebruik: node scripts/cleanup-test-data.js
require("dotenv").config();
const { getPool, sql } = require("../src/config/db");

const USER_PATTERN = "test-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]@example.com";
const SLUG_PATTERN = "test-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]";

async function run() {
  const pool = await getPool();

  const users = await pool.request().query(`SELECT id, email FROM dbo.Users WHERE email LIKE '${USER_PATTERN}'`);
  const companies = await pool.request().query(`SELECT id, slug FROM dbo.Companies WHERE slug LIKE '${SLUG_PATTERN}'`);
  console.log(`Gevonden: ${users.recordset.length} testgebruikers, ${companies.recordset.length} testbedrijven`);

  const userIds = users.recordset.map((u) => u.id);
  const companyIds = companies.recordset.map((c) => c.id);

  if (userIds.length) {
    const ids = userIds.join(",");
    await pool.request().query(`DELETE FROM dbo.Sessions WHERE user_id IN (${ids})`);
    await pool.request().query(`UPDATE dbo.CompanyAdminInvites SET invited_by = NULL WHERE invited_by IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.AuditLogs WHERE user_id IN (${ids}) OR impersonator_user_id IN (${ids})`);
    await pool.request().query(`UPDATE dbo.Products SET created_by = NULL WHERE created_by IN (${ids})`);
  }

  if (companyIds.length) {
    const ids = companyIds.join(",");
    await pool.request().query(`DELETE FROM dbo.ScanEvents WHERE product_id IN (SELECT id FROM dbo.Products WHERE company_id IN (${ids}))`);
    await pool.request().query(`DELETE FROM dbo.Documents WHERE company_id IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.ProductParts WHERE company_id IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.ProductBatches WHERE company_id IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.ProductSustainability WHERE product_id IN (SELECT id FROM dbo.Products WHERE company_id IN (${ids}))`);
    await pool.request().query(`DELETE FROM dbo.ProductCompliance WHERE product_id IN (SELECT id FROM dbo.Products WHERE company_id IN (${ids}))`);
    await pool.request().query(`DELETE FROM dbo.Products WHERE company_id IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.CompanyAdminInvites WHERE company_id IN (${ids})`);
    await pool.request().query(`DELETE FROM dbo.AuditLogs WHERE company_id IN (${ids})`);
  }

  if (userIds.length) {
    await pool.request().query(`DELETE FROM dbo.Users WHERE id IN (${userIds.join(",")})`);
  }
  if (companyIds.length) {
    // Eventuele niet-testgebruikers in een testbedrijf blokkeren het verwijderen via
    // de FK - dat is bewust: dan blijft dat bedrijf staan en zie je het hieronder.
    for (const id of companyIds) {
      try {
        await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Companies WHERE id = @id");
      } catch {
        console.log(`  bedrijf ${id} overgeslagen (bevat nog echte gebruikers)`);
      }
    }
  }

  const left = await pool.request().query("SELECT COUNT(*) AS n FROM dbo.Users");
  console.log(`Klaar. Gebruikers over: ${left.recordset[0].n}`);
  await sql.close();
}

run().catch((error) => {
  console.error("Opruimen mislukt:", error.message);
  process.exit(1);
});
