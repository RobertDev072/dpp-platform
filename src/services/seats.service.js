const { getPool, sql } = require("../config/db");

// Licentie/seat-overzicht voor één company. Een seat = een gebruiker met status 'active';
// inactieve en geblokkeerde gebruikers tellen niet mee. maxUsers null = geen limiet.
async function getSeatUsage(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT
        COALESCE(c.max_users, p.max_users) AS max_users,
        p.id AS plan_id,
        p.name AS plan_name,
        (SELECT COUNT(*) FROM dbo.Users u WHERE u.company_id = c.id AND u.status = 'active') AS active_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const maxUsers = row.max_users ?? null;
  return {
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    maxUsers,
    activeUsers: row.active_users,
    remainingSeats: maxUsers == null ? null : Math.max(0, maxUsers - row.active_users)
  };
}

module.exports = { getSeatUsage };
