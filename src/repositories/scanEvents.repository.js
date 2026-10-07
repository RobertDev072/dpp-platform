const { query, queryOne } = require("../config/db");

async function recordScanEvent({ productId, userAgent, referrer }) {
  await query(`INSERT INTO scan_events (product_id, user_agent, referrer) VALUES ($1, $2, $3)`, [
    productId,
    userAgent ? String(userAgent).slice(0, 500) : null,
    referrer ? String(referrer).slice(0, 1000) : null
  ]);
}

async function countScanEvents({ companyId } = {}) {
  if (companyId !== undefined) {
    const row = await queryOne(
      `SELECT COUNT(*) AS n FROM scan_events s JOIN products p ON p.id = s.product_id WHERE p.company_id = $1`,
      [companyId]
    );
    return row.n;
  }
  const row = await queryOne(`SELECT COUNT(*) AS n FROM scan_events`);
  return row.n;
}

module.exports = { recordScanEvent, countScanEvents };
