const { getPool, sql } = require("../config/db");

// Geeft null terug als de company nog geen plan heeft (dan geldt geen limiet) — een
// system_owner kan een company aanmaken zonder meteen een plan te kiezen.
async function getMaxUsersForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT p.max_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);

  const row = result.recordset[0];
  return row ? row.max_users : null;
}

module.exports = { getMaxUsersForCompany };
