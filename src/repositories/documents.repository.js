const { getPool, sql } = require("../config/db");

// storage_url heet in de API gewoon `url` (zelfde naam als in de request-body). De kolomnaam
// blijft storage_url uit 001_init.sql. product_status is nodig voor de archived-check.
const COLUMNS = `
  d.id, d.company_id, d.product_id, p.name AS product_name, p.status AS product_status,
  d.type, d.title, d.language, d.storage_url AS url, d.is_public,
  d.created_by, d.created_at, d.updated_at`;

const FROM = `
  FROM dbo.Documents d
  JOIN dbo.Products p ON p.id = d.product_id`;

// Whitelist API-veld -> kolom + SQL-type voor updates.
const FIELD_MAP = Object.freeze({
  title: { column: "title", type: () => sql.NVarChar(200) },
  type: { column: "type", type: () => sql.NVarChar(50) },
  language: { column: "language", type: () => sql.NVarChar(10) },
  url: { column: "storage_url", type: () => sql.NVarChar(1000) },
  isPublic: { column: "is_public", type: () => sql.Bit }
});

async function listDocuments({ companyId, productId, type } = {}) {
  const pool = await getPool();
  const request = pool.request();

  const where = [];
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("d.company_id = @companyId");
  }
  if (productId !== undefined) {
    request.input("productId", sql.Int, productId);
    where.push("d.product_id = @productId");
  }
  if (type !== undefined) {
    request.input("type", sql.NVarChar(50), type);
    where.push("d.type = @type");
  }

  const result = await request.query(`
    SELECT ${COLUMNS}
    ${FROM}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.name, d.title, d.id
  `);
  return result.recordset;
}

async function listDocumentsForProduct(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`SELECT ${COLUMNS} ${FROM} WHERE d.product_id = @productId ORDER BY d.title, d.id`);
  return result.recordset;
}

async function getDocumentById(id) {
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, id).query(`SELECT ${COLUMNS} ${FROM} WHERE d.id = @id`);
  return result.recordset[0] || null;
}

// companyId komt altijd van het product (niet van de gebruiker of de body), zodat een
// document nooit aan een andere tenant kan hangen dan zijn product.
async function createDocument({ companyId, productId, title, type, language, url, isPublic, createdBy }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("productId", sql.Int, productId)
    .input("title", sql.NVarChar(200), title)
    .input("type", sql.NVarChar(50), type)
    .input("language", sql.NVarChar(10), language ?? null)
    .input("url", sql.NVarChar(1000), url)
    .input("isPublic", sql.Bit, Boolean(isPublic))
    .input("createdBy", sql.Int, createdBy)
    .query(`
      INSERT INTO dbo.Documents (company_id, product_id, title, type, language, storage_url, is_public, created_by)
      OUTPUT INSERTED.id
      VALUES (@companyId, @productId, @title, @type, @language, @url, @isPublic, @createdBy)
    `);
  return getDocumentById(result.recordset[0].id);
}

async function updateDocument(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const [field, { column, type }] of Object.entries(FIELD_MAP)) {
    if (fields[field] === undefined) continue;
    setClauses.push(`${column} = @${field}`);
    request.input(field, type(), fields[field]);
  }

  if (setClauses.length === 0) {
    return getDocumentById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");
  await request.query(`UPDATE dbo.Documents SET ${setClauses.join(", ")} WHERE id = @id`);
  return getDocumentById(id);
}

async function deleteDocument(id) {
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.Documents WHERE id = @id");
  return result.rowsAffected[0] > 0;
}

// Voor de publicatie-checklist ("minstens één publiek document", aanbevolen).
async function countPublicDocuments(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query("SELECT COUNT(*) AS total FROM dbo.Documents WHERE product_id = @productId AND is_public = 1");
  return result.recordset[0].total;
}

// Publieke DPP: alleen is_public = 1 en alleen de velden die op de pagina mogen staan.
async function listPublicDocumentsForProduct(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query(`
      SELECT title, type, language, storage_url
      FROM dbo.Documents
      WHERE product_id = @productId AND is_public = 1
      ORDER BY title, id
    `);
  return result.recordset;
}

module.exports = {
  listDocuments,
  listDocumentsForProduct,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  countPublicDocuments,
  listPublicDocumentsForProduct
};
