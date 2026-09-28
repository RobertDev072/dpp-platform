const { getPool, sql } = require("../config/db");

// Alleen niet-herleidbare gegevens (zie §8 "Publiek"): nooit IP-adressen of cookies. De
// route levert al opgeschoonde waarden aan; de lengtes hier spiegelen de kolommen.
async function recordScanEvent({ productId, source, userAgent, referrer, countryCode }) {
  const pool = await getPool();
  await pool
    .request()
    .input("productId", sql.Int, productId)
    .input("source", sql.NVarChar(20), source)
    .input("userAgent", sql.NVarChar(500), userAgent ?? null)
    .input("referrer", sql.NVarChar(500), referrer ?? null)
    .input("countryCode", sql.NChar(2), countryCode ?? null)
    .query(`
      INSERT INTO dbo.ScanEvents (product_id, source, user_agent, referrer, country_code)
      VALUES (@productId, @source, @userAgent, @referrer, @countryCode)
    `);
}

module.exports = { recordScanEvent };
