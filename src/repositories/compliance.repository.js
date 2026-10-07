const { queryOne } = require("../config/db");

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
  const row = await queryOne(`SELECT ${COLUMNS} FROM product_compliance WHERE product_id = $1`, [productId]);
  return parseRegulations(row);
}

async function upsertCompliance(productId, fields) {
  const row = await queryOne(
    `
    INSERT INTO product_compliance (product_id, ce_marked, applicable_regulations)
    VALUES ($1, $2, $3)
    ON CONFLICT (product_id) DO UPDATE
      SET ce_marked = EXCLUDED.ce_marked,
          applicable_regulations = EXCLUDED.applicable_regulations,
          updated_at = now()
    RETURNING ${COLUMNS}
  `,
    [
      productId,
      fields.ceMarked ?? null,
      fields.applicableRegulations ? JSON.stringify(fields.applicableRegulations) : null
    ]
  );
  return parseRegulations(row);
}

module.exports = { getCompliance, upsertCompliance };
