const { queryRows, queryOne } = require("../config/db");

const COLUMNS = "id, product_id, company_id, part_number, name, description, image_url, created_at";

async function listPartsForProduct(productId) {
  return queryRows(`SELECT ${COLUMNS} FROM product_parts WHERE product_id = $1 ORDER BY id`, [productId]);
}

async function createPart({ productId, companyId, partNumber, name, description, imageUrl }) {
  return queryOne(
    `
    INSERT INTO product_parts (product_id, company_id, part_number, name, description, image_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING ${COLUMNS}
  `,
    [productId, companyId, partNumber, name, description ?? null, imageUrl ?? null]
  );
}

async function deletePart(id) {
  return queryOne(`DELETE FROM product_parts WHERE id = $1 RETURNING id`, [id]);
}

module.exports = { listPartsForProduct, createPart, deletePart };
