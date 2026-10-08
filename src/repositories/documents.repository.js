const { getPool, sql } = require("../config/db");

const COLUMNS = `
  id, company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type,
  is_public, category, valid_until, version, uploaded_by, created_at
`;

async function listDocumentsForProduct(productId, options = {}) {
  const pool = await getPool();
  const request = pool.request().input("productId", sql.Int, productId);

  let where = "WHERE product_id = @productId";
  if (options.onlyPublic) {
    where += " AND is_public = true";
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
  category,
  validUntil,
  version,
  uploadedBy
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
    .input("validUntil", sql.Date, validUntil || null)
    .input("version", sql.NVarChar(30), version || null)
    .input("uploadedBy", sql.Int, uploadedBy ?? null)
    .query(`
      INSERT INTO dbo.Documents
        (company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category,
         valid_until, version, uploaded_by)
      VALUES
        (@companyId, @productId, @type, @title, @language, @storageUrl, @blobName, @fileSize, @mimeType, @isPublic, @category,
         @validUntil, @version, @uploadedBy)
      RETURNING ${COLUMNS}
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

// Verwijdert alleen als het document bij dit product hoort: een document-id van een
// ander product (of bedrijf) in de URL raakt niets.
async function deleteDocument(id, productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("productId", sql.Int, productId)
    .query(`
      DELETE FROM dbo.Documents
      WHERE id = @id AND product_id = @productId
      RETURNING id
    `);
  return result.recordset[0] || null;
}

const EDITABLE = {
  title: ["title", () => sql.NVarChar(200)],
  isPublic: ["is_public", () => sql.Bit],
  category: ["category", () => sql.NVarChar(30)],
  language: ["language", () => sql.NVarChar(10)],
  validUntil: ["valid_until", () => sql.Date],
  version: ["version", () => sql.NVarChar(30)]
};

async function updateDocument(id, productId, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id).input("productId", sql.Int, productId);
  const sets = [];
  for (const [field, [column, type]] of Object.entries(EDITABLE)) {
    if (!(field in fields)) continue;
    sets.push(`${column} = @${field}`);
    request.input(field, type(), fields[field] === "" ? null : fields[field]);
  }
  if (!sets.length) return getDocumentById(id);
  const result = await request.query(`
    UPDATE dbo.Documents SET ${sets.join(", ")}
    WHERE id = @id AND product_id = @productId
    RETURNING ${COLUMNS}
  `);
  return result.recordset[0] || null;
}

// Status van de geldigheid: verlopen / verloopt binnen 30 dagen / geldig / geen datum.
const VALIDITY_EXPR = `CASE
  WHEN d.valid_until IS NULL THEN 'none'
  WHEN d.valid_until < CURRENT_DATE THEN 'expired'
  WHEN d.valid_until < CURRENT_DATE + 30 THEN 'expiring'
  ELSE 'valid' END`;

function escapeLike(value) {
  return value.replace(/[\\%_\[]/g, (m) => `\\${m}`);
}

// Documenten van één bedrijf met filters en paginering (documentenpagina).
async function listDocumentsForCompany(companyId, { q, category, visibility, validity, page = 1, pageSize = 50 } = {}) {
  const pool = await getPool();
  const request = pool.request().input("companyId", sql.Int, companyId);
  const where = ["d.company_id = @companyId"];
  if (q) {
    request.input("q", sql.NVarChar(220), `%${escapeLike(q)}%`);
    where.push("(d.title ILIKE @q ESCAPE '\\' OR p.name ILIKE @q ESCAPE '\\' OR p.sku ILIKE @q ESCAPE '\\')");
  }
  if (category) {
    request.input("category", sql.NVarChar(30), category);
    where.push("d.category = @category");
  }
  if (visibility === "public") where.push("d.is_public = true");
  if (visibility === "private") where.push("d.is_public = false");
  if (validity) {
    request.input("validity", sql.NVarChar(10), validity);
    where.push(`${VALIDITY_EXPR} = @validity`);
  }
  request.input("offset", sql.Int, (page - 1) * pageSize).input("limit", sql.Int, pageSize);

  const result = await request.query(`
    SELECT d.id, d.product_id, d.type, d.category, d.title, d.language, d.storage_url, d.blob_name,
           d.file_size, d.mime_type, d.is_public, d.valid_until, d.version, d.created_at,
           ${VALIDITY_EXPR} AS validity,
           p.name AS product_name, p.sku AS product_sku,
           u.email AS uploaded_by_email,
           COUNT(*) OVER() AS total
    FROM dbo.Documents d
    JOIN dbo.Products p ON p.id = d.product_id
    LEFT JOIN dbo.Users u ON u.id = d.uploaded_by
    WHERE ${where.join(" AND ")}
    ORDER BY d.created_at DESC, d.id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);
  const rows = result.recordset;
  return {
    items: rows.map(({ total: _ignored, ...row }) => row),
    total: rows.length ? rows[0].total : 0,
    page,
    pageSize
  };
}

async function getDocumentStats(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN d.is_public THEN 1 ELSE 0 END) AS public_count,
        SUM(CASE WHEN ${VALIDITY_EXPR} = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN ${VALIDITY_EXPR} = 'expiring' THEN 1 ELSE 0 END) AS expiring,
        COALESCE(SUM(d.file_size), 0) AS storage_bytes
      FROM dbo.Documents d
      WHERE d.company_id = @companyId
    `);
  const byCategory = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT category, COUNT(*) AS total FROM dbo.Documents
      WHERE company_id = @companyId GROUP BY category ORDER BY total DESC
    `);
  const row = result.recordset[0];
  return {
    total: row.total || 0,
    public: row.public_count || 0,
    expired: row.expired || 0,
    expiring: row.expiring || 0,
    storageBytes: row.storage_bytes || 0,
    byCategory: byCategory.recordset
  };
}

// Openbaar/privé voor een set documenten van één bedrijf.
async function bulkSetPublic(companyId, ids, isPublic) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("ids", sql.Int, ids)
    .input("isPublic", sql.Bit, isPublic)
    .query(`
      UPDATE dbo.Documents SET is_public = @isPublic
      WHERE company_id = @companyId AND id = ANY(@ids::int[]) AND is_public <> @isPublic
      RETURNING id
    `);
  return result.recordset.map((r) => r.id);
}

module.exports = {
  listDocumentsForProduct,
  listDocumentsForCompany,
  getDocumentStats,
  createDocument,
  getDocumentById,
  updateDocument,
  deleteDocument,
  bulkSetPublic
};
