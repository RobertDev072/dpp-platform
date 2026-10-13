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
  // dbo.scandays: samengevatte dagen + losse scanregels (zie migratie 20261014000000).
  const result = await request.query(`SELECT COALESCE(SUM(s.scans), 0)::bigint AS n FROM dbo.scandays s ${join} ${where}`);
  return Number(result.recordset[0].n);
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
        COALESCE(SUM(s.scans), 0)::bigint AS total,
        COALESCE(SUM(s.scans) FILTER (WHERE s.day = (now() AT TIME ZONE 'UTC')::date), 0)::bigint AS today,
        COALESCE(SUM(s.scans) FILTER (WHERE s.day >= date_trunc('month', (now() AT TIME ZONE 'UTC')::date)::date), 0)::bigint AS this_month,
        COALESCE(SUM(s.scans) FILTER (WHERE s.day > (now() AT TIME ZONE 'UTC')::date - 30), 0)::bigint AS last_30_days,
        COALESCE(SUM(s.scans) FILTER (WHERE s.day > (now() AT TIME ZONE 'UTC')::date - 60 AND s.day <= (now() AT TIME ZONE 'UTC')::date - 30), 0)::bigint AS previous_30_days
      FROM dbo.scandays s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId
    `);
  const row = result.recordset[0];
  return {
    total: Number(row.total || 0),
    today: Number(row.today || 0),
    thisMonth: Number(row.this_month || 0),
    last30Days: Number(row.last_30_days || 0),
    previous30Days: Number(row.previous_30_days || 0)
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
      SELECT to_char(s.day, 'YYYY-MM-DD') AS day, SUM(s.scans)::bigint AS total
      FROM dbo.scandays s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.day > (now() AT TIME ZONE 'UTC')::date - @days::int
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
      SELECT p.id, p.name, p.sku, SUM(s.scans)::bigint AS scans, MAX(s.last_scan_at) AS last_scan_at
      FROM dbo.scandays s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.day > (now() AT TIME ZONE 'UTC')::date - @days::int
      GROUP BY p.id, p.name, p.sku
      ORDER BY scans DESC, p.name
      LIMIT @limit
    `);
  return result.recordset;
}

module.exports.getScanSummary = getScanSummary;
module.exports.countScansPerDay = countScansPerDay;
module.exports.listTopScannedProducts = listTopScannedProducts;
