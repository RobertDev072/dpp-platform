const { queryOne } = require("../config/db");

const COLUMNS = `
  product_id, co2_footprint_kg, co2_reduction_pct, recycled_material_pct, materials,
  epd_url, recyclable, reach_conform, rohs_conform, expected_lifespan_years, updated_at
`;

function parseMaterials(row) {
  if (row && typeof row.materials === "string") {
    try {
      row.materials = JSON.parse(row.materials);
    } catch {
      row.materials = [];
    }
  }
  return row;
}

async function getSustainability(productId) {
  const row = await queryOne(`SELECT ${COLUMNS} FROM product_sustainability WHERE product_id = $1`, [productId]);
  return parseMaterials(row);
}

async function upsertSustainability(productId, fields) {
  const row = await queryOne(
    `
    INSERT INTO product_sustainability
      (product_id, co2_footprint_kg, co2_reduction_pct, recycled_material_pct, materials,
       epd_url, recyclable, reach_conform, rohs_conform, expected_lifespan_years)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (product_id) DO UPDATE
      SET co2_footprint_kg = EXCLUDED.co2_footprint_kg,
          co2_reduction_pct = EXCLUDED.co2_reduction_pct,
          recycled_material_pct = EXCLUDED.recycled_material_pct,
          materials = EXCLUDED.materials,
          epd_url = EXCLUDED.epd_url,
          recyclable = EXCLUDED.recyclable,
          reach_conform = EXCLUDED.reach_conform,
          rohs_conform = EXCLUDED.rohs_conform,
          expected_lifespan_years = EXCLUDED.expected_lifespan_years,
          updated_at = now()
    RETURNING ${COLUMNS}
  `,
    [
      productId,
      fields.co2FootprintKg ?? null,
      fields.co2ReductionPct ?? null,
      fields.recycledMaterialPct ?? null,
      fields.materials ? JSON.stringify(fields.materials) : null,
      fields.epdUrl ?? null,
      fields.recyclable ?? null,
      fields.reachConform ?? null,
      fields.rohsConform ?? null,
      fields.expectedLifespanYears ?? null
    ]
  );
  return parseMaterials(row);
}

module.exports = { getSustainability, upsertSustainability };
