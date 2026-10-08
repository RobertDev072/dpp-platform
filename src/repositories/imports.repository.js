const { getPool, sql } = require("../config/db");

// Kolommen zonder de (grote) rijdata: voor overzicht, status en voortgang.
const SUMMARY_COLUMNS = `
  i.id, i.company_id, i.created_by, i.filename, i.file_type, i.status, i.headers, i.column_mapping,
  i.duplicate_strategy, i.validation_summary, i.total_rows, i.processed_rows, i.current_chunk,
  i.success_count, i.created_count, i.updated_count, i.skipped_count, i.error_count, i.warning_count,
  i.created_at, i.started_at, i.completed_at, i.updated_at
`;

async function createImport({ companyId, createdBy, filename, fileType, headers, rows, columnMapping }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("createdBy", sql.Int, createdBy)
    .input("filename", sql.NVarChar(255), filename)
    .input("fileType", sql.NVarChar(10), fileType)
    .input("headers", sql.NVarChar(sql.MAX), JSON.stringify(headers))
    .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .input("mapping", sql.NVarChar(sql.MAX), JSON.stringify(columnMapping))
    .input("totalRows", sql.Int, rows.length)
    .query(`
      INSERT INTO dbo.ProductImports (company_id, created_by, filename, file_type, headers, rows, column_mapping, total_rows, status)
      VALUES (@companyId, @createdBy, @filename, @fileType, @headers::jsonb, @rows::jsonb, @mapping::jsonb, @totalRows, 'pending')
      RETURNING id
    `);
  return getImport(result.recordset[0].id, companyId);
}

// Altijd met companyId: een import van een ander bedrijf bestaat voor de aanvrager niet.
async function getImport(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT ${SUMMARY_COLUMNS}, u.email AS created_by_email
      FROM dbo.ProductImports i
      LEFT JOIN dbo.Users u ON u.id = i.created_by
      WHERE i.id = @id AND i.company_id = @companyId
    `);
  return result.recordset[0] || null;
}

async function getImportRows(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query("SELECT rows FROM dbo.ProductImports WHERE id = @id AND company_id = @companyId");
  return result.recordset[0]?.rows || null;
}

async function getImportErrors(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query("SELECT errors FROM dbo.ProductImports WHERE id = @id AND company_id = @companyId");
  return result.recordset[0]?.errors || null;
}

async function listImports(companyId, { page = 1, pageSize = 25 } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("offset", sql.Int, (page - 1) * pageSize)
    .input("limit", sql.Int, pageSize)
    .query(`
      SELECT ${SUMMARY_COLUMNS}, u.email AS created_by_email, COUNT(*) OVER() AS total
      FROM dbo.ProductImports i
      LEFT JOIN dbo.Users u ON u.id = i.created_by
      WHERE i.company_id = @companyId
      ORDER BY i.created_at DESC, i.id DESC
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

// Resultaat van de validatiestap opslaan. Alleen toegestaan zolang er nog niet
// geïmporteerd wordt (status pending/validating).
async function saveValidation(id, companyId, { columnMapping, duplicateStrategy, summary, errors, errorRows }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .input("mapping", sql.NVarChar(sql.MAX), JSON.stringify(columnMapping))
    .input("strategy", sql.NVarChar(10), duplicateStrategy)
    .input("summary", sql.NVarChar(sql.MAX), JSON.stringify(summary))
    .input("errors", sql.NVarChar(sql.MAX), JSON.stringify(errors))
    .input("errorRows", sql.Int, errorRows)
    .input("errorCount", sql.Int, summary.errors)
    .input("warningCount", sql.Int, summary.warnings)
    .query(`
      UPDATE dbo.ProductImports
      SET column_mapping = @mapping::jsonb, duplicate_strategy = @strategy, validation_summary = @summary::jsonb,
          errors = @errors::jsonb, error_rows = @errorRows::int[], error_count = @errorCount,
          warning_count = @warningCount, status = 'validating', updated_at = now()
      WHERE id = @id AND company_id = @companyId AND status IN ('pending', 'validating')
      RETURNING id
    `);
  return result.recordset.length > 0;
}

async function cancelImport(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query(`
      UPDATE dbo.ProductImports
      SET status = 'cancelled', rows = NULL, completed_at = now(), updated_at = now()
      WHERE id = @id AND company_id = @companyId AND status IN ('pending', 'validating', 'importing')
      RETURNING id
    `);
  return result.recordset.length > 0;
}

// Laatste imports (meldingen/dashboard).
async function listRecentImports(companyId, days = 7, limit = 5) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("days", sql.Int, days)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT ${SUMMARY_COLUMNS}
      FROM dbo.ProductImports i
      WHERE i.company_id = @companyId AND i.created_at >= now() - make_interval(days => @days)
      ORDER BY i.created_at DESC
      LIMIT @limit
    `);
  return result.recordset;
}

async function countImports(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query("SELECT COUNT(*) AS n FROM dbo.ProductImports WHERE company_id = @companyId AND status = 'completed'");
  return result.recordset[0].n;
}

module.exports = {
  createImport,
  getImport,
  getImportRows,
  getImportErrors,
  listImports,
  saveValidation,
  cancelImport,
  listRecentImports,
  countImports
};
