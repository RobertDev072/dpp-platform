const { getPool, sql } = require("../config/db");

// Effectieve seat-limit: Companies.max_users (override door de System Owner) gaat vóór
// Plans.max_users. Geeft null terug als geen van beide gezet is (dan geldt geen limiet) —
// een system_owner kan een company aanmaken zonder meteen een plan te kiezen.
async function getMaxUsersForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT COALESCE(c.max_users, p.max_users) AS max_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);

  const row = result.recordset[0];
  return row ? row.max_users : null;
}

module.exports = { getMaxUsersForCompany };
