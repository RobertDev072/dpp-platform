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

module.exports = { recordScanEvent };
