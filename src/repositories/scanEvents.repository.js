const { getPool, sql } = require("../config/db");

async function recordScanEvent({ productId, userAgent, referrer }) {
  const pool = await getPool();
  await pool
    .request()
    .input("productId", sql.Int, productId)
    .input("userAgent", sql.NVarChar(500), userAgent ?? null)
    .input("referrer", sql.NVarChar(1000), referrer ?? null)
    .query(`
      INSERT INTO dbo.ScanEvents (product_id, user_agent, referrer)
      VALUES (@productId, @userAgent, @referrer)
    `);
}

async function countScanEvents({ companyId } = {}) {
  const pool = await getPool();
  const request = pool.request();
  let join = "";
  let where = "";
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    join = "JOIN dbo.Products p ON p.id = s.product_id";
    where = "WHERE p.company_id = @companyId";
  }
  const result = await request.query(`SELECT COUNT(*) AS n FROM dbo.ScanEvents s ${join} ${where}`);
  return result.recordset[0].n;
}

module.exports = { recordScanEvent, countScanEvents };
