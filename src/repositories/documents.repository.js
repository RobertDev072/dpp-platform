const { getPool, sql } = require("../config/db");

const COLUMNS = `
  id, company_id, product_id, type, title, language, storage_url, is_public, category, created_at
`;

async function listDocumentsForProduct(productId, options = {}) {
  const pool = await getPool();
  const request = pool.request().input("productId", sql.Int, productId);

  let where = "WHERE product_id = @productId";
  if (options.onlyPublic) {
    where += " AND is_public = 1";
  }

  const result = await request.query(`
    SELECT ${COLUMNS}
    FROM dbo.Documents
    ${where}
    ORDER BY id
  `);
  return result.recordset;
}

async function createDocument({ companyId, productId, type, title, language, storageUrl, isPublic, category }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("productId", sql.Int, productId)
    .input("type", sql.NVarChar(50), type)
    .input("title", sql.NVarChar(200), title)
    .input("language", sql.NVarChar(10), language ?? null)
    .input("storageUrl", sql.NVarChar(1000), storageUrl)
    .input("isPublic", sql.Bit, isPublic ?? false)
    .input("category", sql.NVarChar(30), category ?? "document")
    .query(`
      INSERT INTO dbo.Documents
        (company_id, product_id, type, title, language, storage_url, is_public, category)
      OUTPUT ${COLUMNS.trim().split(/,\s*/).map((c) => `INSERTED.${c.trim()}`).join(", ")}
      VALUES
        (@companyId, @productId, @type, @title, @language, @storageUrl, @isPublic, @category)
    `);
  return result.recordset[0];
}

async function deleteDocument(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      DELETE FROM dbo.Documents
      OUTPUT DELETED.id
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

module.exports = { listDocumentsForProduct, createDocument, deleteDocument };
