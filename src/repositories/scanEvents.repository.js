const { getPool, sql } = require("../config/db");

async function recordScanEvent({ productId, userAgent, referrer }) {
  const pool = await getPool();
  await pool
    .request()
    .input("productId", sql.Int, productId)
    .input("userAgent", sql.NVarChar(500), userAgent ? userAgent.slice(0, 500) : null)
    .input("referrer", sql.NVarChar(1000), referrer ? referrer.slice(0, 1000) : null)
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

// Kerncijfers voor dashboard en QR-overzicht, strikt per bedrijf.
async function getScanSummary(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN s.scanned_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN s.scanned_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 1 ELSE 0 END) AS this_month,
        SUM(CASE WHEN s.scanned_at >= now() - interval '30 days' THEN 1 ELSE 0 END) AS last_30_days,
        SUM(CASE WHEN s.scanned_at >= now() - interval '60 days' AND s.scanned_at < now() - interval '30 days' THEN 1 ELSE 0 END) AS previous_30_days
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId
    `);
  const row = result.recordset[0];
  return {
    total: row.total || 0,
    today: row.today || 0,
    thisMonth: row.this_month || 0,
    last30Days: row.last_30_days || 0,
    previous30Days: row.previous_30_days || 0
  };
}

// Scans per dag (UTC) over de laatste N dagen; dagen zonder scans vult de aanroeper aan.
async function countScansPerDay(companyId, days) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("days", sql.Int, days)
    .query(`
      SELECT to_char(date_trunc('day', s.scanned_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, COUNT(*) AS total
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.scanned_at >= now() - make_interval(days => @days)
      GROUP BY 1
    `);
  return result.recordset;
}

async function listTopScannedProducts(companyId, { limit = 5, days = 30 } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("limit", sql.Int, limit)
    .input("days", sql.Int, days)
    .query(`
      SELECT p.id, p.name, p.sku, COUNT(*) AS scans, MAX(s.scanned_at) AS last_scan_at
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.scanned_at >= now() - make_interval(days => @days)
      GROUP BY p.id, p.name, p.sku
      ORDER BY scans DESC, p.name
      LIMIT @limit
    `);
  return result.recordset;
}

module.exports.getScanSummary = getScanSummary;
module.exports.countScansPerDay = countScansPerDay;
module.exports.listTopScannedProducts = listTopScannedProducts;
