const { getPool, sql } = require("../config/db");

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
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`SELECT ${COLUMNS} FROM dbo.ProductSustainability WHERE product_id = @productId`);
  return parseMaterials(result.recordset[0] || null);
}

function buildRequest(pool, productId, fields) {
  return pool
    .request()
    .input("productId", sql.Int, productId)
    .input("co2FootprintKg", sql.Decimal(10, 2), fields.co2FootprintKg ?? null)
    .input("co2ReductionPct", sql.Decimal(5, 2), fields.co2ReductionPct ?? null)
    .input("recycledMaterialPct", sql.Decimal(5, 2), fields.recycledMaterialPct ?? null)
    .input("materials", sql.NVarChar(sql.MAX), fields.materials ? JSON.stringify(fields.materials) : null)
    .input("epdUrl", sql.NVarChar(1000), fields.epdUrl ?? null)
    .input("recyclable", sql.Bit, fields.recyclable ?? null)
    .input("reachConform", sql.Bit, fields.reachConform ?? null)
    .input("rohsConform", sql.Bit, fields.rohsConform ?? null)
    .input("expectedLifespanYears", sql.Int, fields.expectedLifespanYears ?? null);
}

async function upsertSustainability(productId, fields) {
  const pool = await getPool();

  const result = await buildRequest(pool, productId, fields).query(`
    INSERT INTO dbo.ProductSustainability
      (product_id, co2_footprint_kg, co2_reduction_pct, recycled_material_pct, materials,
       epd_url, recyclable, reach_conform, rohs_conform, expected_lifespan_years)
    VALUES
      (@productId, @co2FootprintKg, @co2ReductionPct, @recycledMaterialPct, @materials,
       @epdUrl, @recyclable, @reachConform, @rohsConform, @expectedLifespanYears)
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
  `);

  return parseMaterials(result.recordset[0]);
}

module.exports = { getSustainability, upsertSustainability };
