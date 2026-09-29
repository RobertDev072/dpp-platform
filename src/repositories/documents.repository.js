const { getPool, sql } = require("../config/db");

const COLUMNS = `
  id, company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category, created_at
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

async function createDocument({
  companyId,
  productId,
  type,
  title,
  language,
  storageUrl,
  blobName,
  fileSize,
  mimeType,
  isPublic,
  category
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("productId", sql.Int, productId)
    .input("type", sql.NVarChar(50), type)
    .input("title", sql.NVarChar(200), title)
    .input("language", sql.NVarChar(10), language ?? null)
    .input("storageUrl", sql.NVarChar(1000), storageUrl ?? null)
    .input("blobName", sql.NVarChar(300), blobName ?? null)
    .input("fileSize", sql.Int, fileSize ?? null)
    .input("mimeType", sql.NVarChar(100), mimeType ?? null)
    .input("isPublic", sql.Bit, isPublic ?? false)
    .input("category", sql.NVarChar(30), category ?? "document")
    .query(`
      INSERT INTO dbo.Documents
        (company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category)
      OUTPUT ${COLUMNS.trim().split(/,\s*/).map((c) => `INSERTED.${c.trim()}`).join(", ")}
      VALUES
        (@companyId, @productId, @type, @title, @language, @storageUrl, @blobName, @fileSize, @mimeType, @isPublic, @category)
    `);
  return result.recordset[0];
}

async function getDocumentById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${COLUMNS} FROM dbo.Documents WHERE id = @id`);
  return result.recordset[0] || null;
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

// Alle documenten van een bedrijf, met productnaam - voor de documentenpagina.
async function listDocumentsForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT d.id, d.product_id, d.type, d.category, d.title, d.language,
             d.storage_url, d.is_public, d.created_at,
             p.name AS product_name
      FROM dbo.Documents d
      JOIN dbo.Products p ON p.id = d.product_id
      WHERE d.company_id = @companyId
      ORDER BY d.created_at DESC
    `);
  return result.recordset;
}

module.exports = { listDocumentsForProduct, listDocumentsForCompany, createDocument, getDocumentById, deleteDocument };
