const { queryRows, queryOne } = require("../config/db");

const COLUMNS = `
  id, company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category, created_at
`;

async function listDocumentsForProduct(productId, options = {}) {
  let where = "WHERE product_id = $1";
  if (options.onlyPublic) {
    where += " AND is_public = TRUE";
  }
  return queryRows(`SELECT ${COLUMNS} FROM documents ${where} ORDER BY id`, [productId]);
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
  return queryOne(
    `
    INSERT INTO documents
      (company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING ${COLUMNS}
  `,
    [
      companyId,
      productId,
      type,
      title,
      language ?? null,
      storageUrl ?? null,
      blobName ?? null,
      fileSize ?? null,
      mimeType ?? null,
      Boolean(isPublic),
      category ?? "document"
    ]
  );
}

async function getDocumentById(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(`SELECT ${COLUMNS} FROM documents WHERE id = $1`, [id]);
}

// Verwijdert de rij en geeft (o.a.) blob_name terug, zodat de route het bestand
// in Storage kan opruimen.
async function deleteDocument(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(`DELETE FROM documents WHERE id = $1 RETURNING id, blob_name`, [id]);
}

// Alle documenten van een bedrijf, met productnaam - voor de documentenpagina.
async function listDocumentsForCompany(companyId) {
  return queryRows(
    `
    SELECT d.id, d.product_id, d.type, d.category, d.title, d.language,
           d.storage_url, d.is_public, d.created_at,
           p.name AS product_name
    FROM documents d
    JOIN products p ON p.id = d.product_id
    WHERE d.company_id = $1
    ORDER BY d.created_at DESC
  `,
    [companyId]
  );
}

module.exports = { listDocumentsForProduct, listDocumentsForCompany, createDocument, getDocumentById, deleteDocument };
