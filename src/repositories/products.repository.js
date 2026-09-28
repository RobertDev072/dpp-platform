const { getPool, sql } = require("../config/db");

// Lijstweergave: bewust zonder de lange tekstvelden (materialen, compliance, notities), die
// staan alleen in het detail. company_name is voor de System Owner, die alle companies ziet.
const LIST_COLUMNS = `
  p.id, p.company_id, c.name AS company_name, p.name, p.brand, p.model, p.sku, p.gtin,
  p.category, p.manufacturer, p.country_of_origin, p.status, p.public_id, p.published_at,
  p.created_at, p.updated_at`;

// Detail voor ingelogde gebruikers van de eigen company (of de System Owner). Bevat interne
// velden zoals admin_notes: NOOIT gebruiken voor de publieke DPP (zie getPublishedByPublicId).
const DETAIL_COLUMNS = `
  p.id, p.company_id, c.name AS company_name, p.name, p.brand, p.model, p.sku, p.gtin,
  p.category, p.description, p.manufacturer, p.country_of_origin, p.materials,
  p.compliance_info, p.recycling_info, p.repair_info, p.admin_notes, p.status,
  p.public_id, p.published_at, p.created_by, cu.email AS created_by_email,
  p.updated_by, uu.email AS updated_by_email, p.created_at, p.updated_at`;

const DETAIL_FROM = `
  FROM dbo.Products p
  JOIN dbo.Companies c ON c.id = p.company_id
  LEFT JOIN dbo.Users cu ON cu.id = p.created_by
  LEFT JOIN dbo.Users uu ON uu.id = p.updated_by`;

// Whitelist API-veld (camelCase) -> kolom + SQL-type. Alleen namen uit deze tabel komen ooit
// in dynamische SQL terecht; de waarden gaan altijd als parameter mee.
const FIELD_MAP = Object.freeze({
  name: { column: "name", type: () => sql.NVarChar(200) },
  sku: { column: "sku", type: () => sql.NVarChar(100) },
  manufacturer: { column: "manufacturer", type: () => sql.NVarChar(200) },
  brand: { column: "brand", type: () => sql.NVarChar(150) },
  model: { column: "model", type: () => sql.NVarChar(150) },
  gtin: { column: "gtin", type: () => sql.NVarChar(50) },
  category: { column: "category", type: () => sql.NVarChar(100) },
  description: { column: "description", type: () => sql.NVarChar(sql.MAX) },
  adminNotes: { column: "admin_notes", type: () => sql.NVarChar(sql.MAX) },
  materials: { column: "materials", type: () => sql.NVarChar(sql.MAX) },
  countryOfOrigin: { column: "country_of_origin", type: () => sql.NVarChar(100) },
  complianceInfo: { column: "compliance_info", type: () => sql.NVarChar(sql.MAX) },
  recyclingInfo: { column: "recycling_info", type: () => sql.NVarChar(sql.MAX) },
  repairInfo: { column: "repair_info", type: () => sql.NVarChar(sql.MAX) }
});

const PRODUCT_FIELDS = Object.freeze(Object.keys(FIELD_MAP));

// LIKE-jokertekens in zoekinvoer letterlijk nemen. SQL Server kent naast % en _ ook [...]
// als tekenklasse; de escape-char zelf moet ook ge-escaped worden.
function escapeLike(value) {
  return value.replace(/[\\%_[]/g, (char) => `\\${char}`);
}

async function listProducts({ companyId, status, q, category } = {}) {
  const pool = await getPool();
  const request = pool.request();

  const where = [];
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("p.company_id = @companyId");
  }
  if (status !== undefined) {
    request.input("status", sql.NVarChar(20), status);
    where.push("p.status = @status");
  }
  if (q !== undefined) {
    request.input("q", sql.NVarChar(500), `%${escapeLike(q)}%`);
    where.push("(p.name LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\')");
  }
  if (category !== undefined) {
    request.input("category", sql.NVarChar(100), category);
    where.push("p.category = @category");
  }

  const result = await request.query(`
    SELECT ${LIST_COLUMNS}
    FROM dbo.Products p
    JOIN dbo.Companies c ON c.id = p.company_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.name, p.id
  `);
  return result.recordset;
}

async function getProductById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${DETAIL_COLUMNS} ${DETAIL_FROM} WHERE p.id = @id`);
  return result.recordset[0] || null;
}

// companyId en createdBy komen altijd uit de sessie (route), nooit uit de body.
// Nieuwe producten starten altijd als 'draft'; publiceren loopt via de statusflow.
async function createProduct({ companyId, createdBy, fields }) {
  const pool = await getPool();
  const request = pool.request().input("companyId", sql.Int, companyId).input("createdBy", sql.Int, createdBy);

  const columns = ["company_id", "created_by", "status"];
  const values = ["@companyId", "@createdBy", "'draft'"];
  for (const field of PRODUCT_FIELDS) {
    if (fields[field] === undefined) continue;
    const { column, type } = FIELD_MAP[field];
    columns.push(column);
    values.push(`@${field}`);
    request.input(field, type(), fields[field]);
  }

  const result = await request.query(`
    INSERT INTO dbo.Products (${columns.join(", ")})
    OUTPUT INSERTED.id
    VALUES (${values.join(", ")})
  `);
  return getProductById(result.recordset[0].id);
}

// Werkt alleen bij zolang het product niet gearchiveerd is; de WHERE-clausule maakt dat
// atomair (geen race met een gelijktijdige archivering). null = niet bijgewerkt.
async function updateProduct(id, fields, updatedBy) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id).input("updatedBy", sql.Int, updatedBy);

  const setClauses = [];
  for (const field of PRODUCT_FIELDS) {
    if (fields[field] === undefined) continue;
    const { column, type } = FIELD_MAP[field];
    setClauses.push(`${column} = @${field}`);
    request.input(field, type(), fields[field]);
  }

  if (setClauses.length === 0) {
    return getProductById(id);
  }

  setClauses.push("updated_by = @updatedBy", "updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Products
    SET ${setClauses.join(", ")}
    WHERE id = @id AND status <> 'archived'
  `);

  if (result.rowsAffected[0] === 0) {
    return null;
  }
  return getProductById(id);
}

// Optimistische statuswissel: alleen als de status nog `from` is. Zo kunnen twee gelijktijdige
// verzoeken (bijv. publiceren en archiveren) elkaar niet overschrijven. null = niet gewijzigd.
// Bij publiceren krijgt het product eenmalig een public_id en published_at; COALESCE houdt
// beide vast bij depubliceren en herpubliceren, zodat een geprinte QR-code geldig blijft.
async function changeStatus({ id, from, to, updatedBy }) {
  const pool = await getPool();
  const setClauses = ["status = @to", "updated_by = @updatedBy", "updated_at = SYSUTCDATETIME()"];
  if (to === "published") {
    setClauses.push("public_id = COALESCE(public_id, NEWID())", "published_at = COALESCE(published_at, SYSUTCDATETIME())");
  }

  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("from", sql.NVarChar(20), from)
    .input("to", sql.NVarChar(20), to)
    .input("updatedBy", sql.Int, updatedBy)
    .query(`
      UPDATE dbo.Products
      SET ${setClauses.join(", ")}
      WHERE id = @id AND status = @from
    `);

  if (result.rowsAffected[0] === 0) {
    return null;
  }
  return getProductById(id);
}

// Publieke DPP: alleen gepubliceerde producten, met een expliciete kolomlijst zonder interne
// velden (geen admin_notes, created_by, updated_by). De route bouwt hier daarna nog een
// whitelisted DTO van; deze query is de eerste verdedigingslinie, niet de enige.
async function getPublishedByPublicId(publicId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("publicId", sql.UniqueIdentifier, publicId)
    .query(`
      SELECT p.id, p.public_id, p.name, p.brand, p.manufacturer, p.model, p.sku, p.gtin,
             p.category, p.description, p.materials, p.country_of_origin, p.compliance_info,
             p.recycling_info, p.repair_info, p.published_at, p.updated_at,
             c.name AS issuer
      FROM dbo.Products p
      JOIN dbo.Companies c ON c.id = p.company_id
      WHERE p.public_id = @publicId AND p.status = 'published'
    `);
  return result.recordset[0] || null;
}

module.exports = {
  PRODUCT_FIELDS,
  escapeLike,
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  changeStatus,
  getPublishedByPublicId
};
