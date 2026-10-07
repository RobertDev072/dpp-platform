const { getPool, sql } = require("../config/db");

const COLUMNS = `product_id, ce_marked, applicable_regulations, updated_at`;

function parseRegulations(row) {
  if (row && typeof row.applicable_regulations === "string") {
    try {
      row.applicable_regulations = JSON.parse(row.applicable_regulations);
    } catch {
      row.applicable_regulations = [];
    }
  }
  return row;
}

async function getCompliance(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`SELECT ${COLUMNS} FROM dbo.ProductCompliance WHERE product_id = @productId`);
  return parseRegulations(result.recordset[0] || null);
}

function buildRequest(pool, productId, fields) {
  return pool
    .request()
    .input("productId", sql.Int, productId)
    .input("ceMarked", sql.Bit, fields.ceMarked ?? null)
    .input(
      "applicableRegulations",
      sql.NVarChar(sql.MAX),
      fields.applicableRegulations ? JSON.stringify(fields.applicableRegulations) : null
    );
}

async function upsertCompliance(productId, fields) {
  const pool = await getPool();

  const result = await buildRequest(pool, productId, fields).query(`
    INSERT INTO dbo.ProductCompliance (product_id, ce_marked, applicable_regulations)
    VALUES (@productId, @ceMarked, @applicableRegulations)
    ON CONFLICT (product_id) DO UPDATE
      SET ce_marked = EXCLUDED.ce_marked,
          applicable_regulations = EXCLUDED.applicable_regulations,
          updated_at = now()
    RETURNING ${COLUMNS}
  `);

  return parseRegulations(result.recordset[0]);
}

module.exports = { getCompliance, upsertCompliance };
