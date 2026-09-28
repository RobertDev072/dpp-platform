const { getPool, sql } = require("../config/db");

async function listBatchesForProduct(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`
      SELECT id, product_id, company_id, batch_number, production_date, quantity, created_at
      FROM dbo.ProductBatches
      WHERE product_id = @productId
      ORDER BY id
    `);
  return result.recordset;
}

async function createBatch({ productId, companyId, batchNumber, productionDate, quantity }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .input("companyId", sql.Int, companyId)
    .input("batchNumber", sql.NVarChar(100), batchNumber)
    .input("productionDate", sql.Date, productionDate ?? null)
    .input("quantity", sql.Int, quantity ?? null)
    .query(`
      INSERT INTO dbo.ProductBatches (product_id, company_id, batch_number, production_date, quantity)
      OUTPUT INSERTED.id, INSERTED.product_id, INSERTED.company_id, INSERTED.batch_number,
             INSERTED.production_date, INSERTED.quantity, INSERTED.created_at
      VALUES (@productId, @companyId, @batchNumber, @productionDate, @quantity)
    `);
  return result.recordset[0];
}

module.exports = { listBatchesForProduct, createBatch };
