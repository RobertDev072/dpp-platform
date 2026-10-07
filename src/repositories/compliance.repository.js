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

// Zelfde samenvoeg-regel als duurzaamheid: undefined = ongewijzigd, null = wissen.
async function upsertCompliance(productId, incoming) {
  const existing = await getCompliance(productId);
  const fields = {
    ceMarked: existing?.ce_marked ?? null,
    applicableRegulations: existing?.applicable_regulations ?? null
  };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) fields[key] = value;
  }
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
      fields.applicableRegulations && fields.applicableRegulations.length ? JSON.stringify(fields.applicableRegulations) : null
    ]
  );
  return parseRegulations(row);
}

module.exports = { getCompliance, upsertCompliance };
