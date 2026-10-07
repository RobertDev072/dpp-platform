const { getPool, sql } = require("../config/db");

async function listPartsForProduct(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`
      SELECT id, product_id, company_id, part_number, name, description, image_url, created_at
      FROM dbo.ProductParts
      WHERE product_id = @productId
      ORDER BY id
    `);
  return result.recordset;
}

async function createPart({ productId, companyId, partNumber, name, description, imageUrl }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .input("companyId", sql.Int, companyId)
    .input("partNumber", sql.NVarChar(100), partNumber)
    .input("name", sql.NVarChar(200), name)
    .input("description", sql.NVarChar(sql.MAX), description ?? null)
    .input("imageUrl", sql.NVarChar(1000), imageUrl ?? null)
    .query(`
      INSERT INTO dbo.ProductParts (product_id, company_id, part_number, name, description, image_url)
      VALUES (@productId, @companyId, @partNumber, @name, @description, @imageUrl)
      RETURNING id, product_id, company_id, part_number, name, description, image_url, created_at
    `);
  return result.recordset[0];
}

async function deletePart(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      DELETE FROM dbo.ProductParts
      WHERE id = @id
      RETURNING id
    `);
  return result.recordset[0] || null;
}

module.exports = { listPartsForProduct, createPart, deletePart };
