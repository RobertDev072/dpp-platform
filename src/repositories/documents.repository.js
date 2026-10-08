const { queryRows, queryOne, query } = require("../config/db");

const COLUMNS = `
  id, company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category,
  created_at, version, valid_until, uploaded_by, archived_at
`;

// Vervalstatus: verlopen, verloopt binnen 30 dagen, of geldig/zonder datum.
const EXPIRY_SQL = `
  CASE
    WHEN d.valid_until IS NULL THEN 'none'
    WHEN d.valid_until < CURRENT_DATE THEN 'expired'
    WHEN d.valid_until <= CURRENT_DATE + 30 THEN 'expiring'
    ELSE 'valid'
  END
`;

const EXPIRING_DAYS = 30;

// Gearchiveerde documenten tellen niet mee voor het paspoort; standaard alleen actieve.
async function listDocumentsForProduct(productId, options = {}) {
  let where = "WHERE product_id = $1";
  if (!options.includeArchived) {
    where += " AND archived_at IS NULL";
  }
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
  category,
  version,
  validUntil,
  uploadedBy
}) {
  return queryOne(
    `
    INSERT INTO documents
      (company_id, product_id, type, title, language, storage_url, blob_name, file_size, mime_type, is_public, category,
       version, valid_until, uploaded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      category ?? "document",
      version || null,
      validUntil || null,
      uploadedBy ?? null
    ]
  );
}

const UPDATABLE = {
  title: "title",
  language: "language",
  version: "version",
  validUntil: "valid_until",
  isPublic: "is_public",
  category: "category"
};

// Metadata wijzigen; companyId zit altijd in de WHERE (geen IDOR).
async function updateDocument(id, companyId, patch) {
  const sets = [];
  const params = [id, companyId];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) {
      params.push(patch[key] === "" ? null : patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (patch.archived !== undefined) {
    sets.push(patch.archived ? "archived_at = COALESCE(archived_at, now())" : "archived_at = NULL");
  }
  if (!sets.length) return getDocumentById(id);
  return queryOne(
    `UPDATE documents SET ${sets.join(", ")} WHERE id = $1 AND company_id = $2 RETURNING ${COLUMNS}`,
    params
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

// Alle documenten van een bedrijf, met productnaam, uploader en vervalstatus.
async function listDocumentsForCompany(companyId, { includeArchived = true } = {}) {
  return queryRows(
    `
    SELECT d.id, d.product_id, d.type, d.category, d.title, d.language, d.version, d.valid_until,
           d.storage_url, d.blob_name IS NOT NULL AS is_upload, d.file_size, d.mime_type,
           d.is_public, d.created_at, d.archived_at,
           ${EXPIRY_SQL} AS expiry_status,
           p.name AS product_name, p.sku AS product_sku,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS uploader_name, u.email AS uploader_email
    FROM documents d
    JOIN products p ON p.id = d.product_id
    LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.company_id = $1 ${includeArchived ? "" : "AND d.archived_at IS NULL"}
    ORDER BY d.created_at DESC
    LIMIT 5000
  `,
    [companyId]
  );
}

// Bulkacties op documenten van één bedrijf. Ids van andere bedrijven worden
// stilzwijgend genegeerd (company_id in de WHERE).
async function bulkUpdate(companyId, ids, action) {
  const sets = {
    publish: "is_public = TRUE",
    unpublish: "is_public = FALSE",
    archive: "archived_at = COALESCE(archived_at, now())",
    restore: "archived_at = NULL"
  }[action];
  if (!sets) throw new Error(`Onbekende actie ${action}`);
  const result = await query(
    `UPDATE documents SET ${sets} WHERE company_id = $1 AND id = ANY($2::int[]) RETURNING id`,
    [companyId, ids]
  );
  return result.rows.map((r) => r.id);
}

async function listByIds(companyId, ids) {
  return queryRows(
    `SELECT d.id, d.product_id, d.title, d.blob_name, d.storage_url, d.mime_type, p.name AS product_name
     FROM documents d JOIN products p ON p.id = d.product_id
     WHERE d.company_id = $1 AND d.id = ANY($2::int[])
     ORDER BY d.id`,
    [companyId, ids]
  );
}

// Documenten die verlopen zijn of binnen 30 dagen verlopen (meldingen/dashboard).
async function expiryCounts(companyId) {
  return queryOne(
    `SELECT COUNT(*) FILTER (WHERE valid_until < CURRENT_DATE)::int AS expired,
            COUNT(*) FILTER (WHERE valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + ${EXPIRING_DAYS})::int AS expiring
     FROM documents WHERE company_id = $1 AND archived_at IS NULL AND valid_until IS NOT NULL`,
    [companyId]
  );
}

module.exports = {
  EXPIRING_DAYS,
  listDocumentsForProduct,
  listDocumentsForCompany,
  createDocument,
  updateDocument,
  getDocumentById,
  deleteDocument,
  bulkUpdate,
  listByIds,
  expiryCounts
};
