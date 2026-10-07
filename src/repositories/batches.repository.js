const { queryRows, queryOne } = require("../config/db");

const COLUMNS = "id, product_id, company_id, batch_number, production_date, quantity, created_at";

async function listBatchesForProduct(productId) {
  return queryRows(`SELECT ${COLUMNS} FROM product_batches WHERE product_id = $1 ORDER BY id`, [productId]);
}

async function createBatch({ productId, companyId, batchNumber, productionDate, quantity }) {
  return queryOne(
    `
    INSERT INTO product_batches (product_id, company_id, batch_number, production_date, quantity)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING ${COLUMNS}
  `,
    [productId, companyId, batchNumber, productionDate ?? null, quantity ?? null]
  );
}

module.exports = { listBatchesForProduct, createBatch };
