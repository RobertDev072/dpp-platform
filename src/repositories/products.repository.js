const crypto = require("crypto");
const { getPool, sql } = require("../config/db");

const PUBLIC_COLUMNS = `
  id, company_id, name, brand, model, sku, gtin, category_id, category_label, description,
  manufacturer, country_of_origin, photo_url, photo_blob_name, status, highlights, public_id,
  published_at, created_by, created_at, updated_at
`;

// Whitelist: voorkomt dat sort/order ooit rauw in de SQL belanden.
const SORTABLE_COLUMNS = {
  name: "p.name",
  created_at: "p.created_at",
  status: "p.status",
  category: "p.category_label"
};

function escapeLike(value) {
  return value.replace(/[\\%_\[]/g, (m) => `\\${m}`);
}

// Compleetheid van een productpaspoort: zes gelijkwaardige criteria (foto,
// omschrijving, categorie, duurzaamheidsdata, compliance-data, minimaal één
// document). Berekend in SQL zodat er ook op gefilterd/geteld kan worden.
const COMPLETENESS_SQL = `(
  (CASE WHEN p.photo_url IS NOT NULL OR p.photo_blob_name IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN p.description IS NOT NULL AND LEN(p.description) > 0 THEN 1 ELSE 0 END) +
  (CASE WHEN p.category_label IS NOT NULL AND LEN(p.category_label) > 0 THEN 1 ELSE 0 END) +
  (CASE WHEN EXISTS (SELECT 1 FROM dbo.ProductSustainability ps WHERE ps.product_id = p.id) THEN 1 ELSE 0 END) +
  (CASE WHEN EXISTS (SELECT 1 FROM dbo.ProductCompliance pc WHERE pc.product_id = p.id) THEN 1 ELSE 0 END) +
  (CASE WHEN EXISTS (SELECT 1 FROM dbo.Documents d WHERE d.product_id = p.id) THEN 1 ELSE 0 END)
) * 100 / 6`;

function buildProductFilters({ companyId, q, status, category, doc }, request) {
  const where = [];
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("p.company_id = @companyId");
  }
  if (q) {
    request.input("q", sql.NVarChar(220), `%${escapeLike(q)}%`);
    where.push("(p.name LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\' OR p.gtin LIKE @q ESCAPE '\\' OR p.brand LIKE @q ESCAPE '\\')");
  }
  if (status) {
    request.input("status", sql.NVarChar(20), status);
    where.push("p.status = @status");
  }
  if (category) {
    request.input("category", sql.NVarChar(100), category);
    where.push("p.category_label = @category");
  }
  if (doc === "compleet") {
    where.push(`${COMPLETENESS_SQL} = 100`);
  } else if (doc === "incompleet") {
    where.push(`${COMPLETENESS_SQL} < 100`);
  }
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

async function listProducts({
  companyId,
  q,
  status,
  category,
  doc,
  sort = "name",
  order = "asc",
  page = 1,
  pageSize = 25
} = {}) {
  const pool = await getPool();
  const request = pool.request();

  const whereSql = buildProductFilters({ companyId, q, status, category, doc }, request);
  const sortSql = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.name;
  const orderSql = order === "desc" ? "DESC" : "ASC";
  request.input("offset", sql.Int, (page - 1) * pageSize);
  request.input("limit", sql.Int, pageSize);

  const selectColumns = PUBLIC_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ");

  const result = await request.query(`
    SELECT ${selectColumns},
           creator.email AS created_by_email,
           ${COMPLETENESS_SQL} AS completeness,
           COUNT(*) OVER() AS total
    FROM dbo.Products p
    LEFT JOIN dbo.Users creator ON creator.id = p.created_by
    ${whereSql}
    ORDER BY ${sortSql} ${orderSql}, p.id ASC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  const rows = result.recordset;
  const total = rows.length ? rows[0].total : 0;
  const items = rows.map(({ total: _ignored, ...row }) => ({
    ...row,
    action_required: row.completeness < 100
  }));
  return { items, total, page, pageSize };
}

// Statistieken voor de dashboard-tegels van het productoverzicht.
async function getProductStats({ companyId } = {}) {
  const pool = await getPool();
  const request = pool.request();
  let where = "";
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where = "WHERE p.company_id = @companyId";
  }

  const result = await request.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN ${COMPLETENESS_SQL} < 100 THEN 1 ELSE 0 END) AS action_required,
      SUM(CASE WHEN p.created_at >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1) THEN 1 ELSE 0 END) AS created_this_month,
      SUM(CASE WHEN p.published_at >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1) THEN 1 ELSE 0 END) AS published_this_month
    FROM dbo.Products p
    ${where}
  `);

  const row = result.recordset[0];
  return {
    total: row.total || 0,
    published: row.published || 0,
    drafts: row.drafts || 0,
    actionRequired: row.action_required || 0,
    createdThisMonth: row.created_this_month || 0,
    publishedThisMonth: row.published_this_month || 0
  };
}

// Onderscheiden categorielabels voor het filter in het productoverzicht.
async function listCategories({ companyId } = {}) {
  const pool = await getPool();
  const request = pool.request();
  let where = "WHERE category_label IS NOT NULL AND category_label <> ''";
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where += " AND company_id = @companyId";
  }
  const result = await request.query(`
    SELECT DISTINCT category_label FROM dbo.Products ${where} ORDER BY category_label
  `);
  return result.recordset.map((r) => r.category_label);
}

async function getProductById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${PUBLIC_COLUMNS} FROM dbo.Products WHERE id = @id`);
  return result.recordset[0] || null;
}

async function createProduct({
  companyId,
  name,
  brand,
  model,
  sku,
  gtin,
  description,
  manufacturer,
  countryOfOrigin,
  photoUrl,
  createdBy
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("createdBy", sql.Int, createdBy ?? null)
    .input("name", sql.NVarChar(200), name)
    .input("brand", sql.NVarChar(150), brand ?? null)
    .input("model", sql.NVarChar(150), model ?? null)
    .input("sku", sql.NVarChar(100), sku ?? null)
    .input("gtin", sql.NVarChar(50), gtin ?? null)
    .input("description", sql.NVarChar(sql.MAX), description ?? null)
    .input("manufacturer", sql.NVarChar(200), manufacturer ?? null)
    .input("countryOfOrigin", sql.NVarChar(100), countryOfOrigin ?? null)
    .input("photoUrl", sql.NVarChar(1000), photoUrl ?? null)
    .query(`
      INSERT INTO dbo.Products
        (company_id, name, brand, model, sku, gtin, description, manufacturer, country_of_origin, photo_url, created_by, status)
      OUTPUT ${PUBLIC_COLUMNS.trim().split(/,\s*/).map((c) => `INSERTED.${c.trim()}`).join(", ")}
      VALUES
        (@companyId, @name, @brand, @model, @sku, @gtin, @description, @manufacturer, @countryOfOrigin, @photoUrl, @createdBy, 'draft')
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = [
  "name",
  "brand",
  "model",
  "sku",
  "gtin",
  "description",
  "manufacturer",
  "countryOfOrigin",
  "photoUrl",
  "photoBlobName",
  "status"
];
const FIELD_TO_COLUMN = {
  name: "name",
  brand: "brand",
  model: "model",
  sku: "sku",
  gtin: "gtin",
  description: "description",
  manufacturer: "manufacturer",
  countryOfOrigin: "country_of_origin",
  photoUrl: "photo_url",
  photoBlobName: "photo_blob_name",
  status: "status"
};
const FIELD_TO_SQL_TYPE = {
  name: () => sql.NVarChar(200),
  brand: () => sql.NVarChar(150),
  model: () => sql.NVarChar(150),
  sku: () => sql.NVarChar(100),
  gtin: () => sql.NVarChar(50),
  description: () => sql.NVarChar(sql.MAX),
  manufacturer: () => sql.NVarChar(200),
  countryOfOrigin: () => sql.NVarChar(100),
  photoUrl: () => sql.NVarChar(1000),
  photoBlobName: () => sql.NVarChar(255),
  status: () => sql.NVarChar(20)
};

async function updateProduct(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    setClauses.push(`${FIELD_TO_COLUMN[field]} = @${field}`);
    request.input(field, FIELD_TO_SQL_TYPE[field](), fields[field]);
  }

  if (setClauses.length === 0) {
    return getProductById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Products
    SET ${setClauses.join(", ")}
    OUTPUT ${PUBLIC_COLUMNS.trim().split(/,\s*/).map((c) => `INSERTED.${c.trim()}`).join(", ")}
    WHERE id = @id
  `);

  return result.recordset[0] || null;
}

async function getProductByPublicId(publicId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("publicId", sql.UniqueIdentifier, publicId)
    .query(`
      SELECT ${PUBLIC_COLUMNS}
      FROM dbo.Products
      WHERE public_id = @publicId AND status IN ('published', 'archived')
    `);
  // 'archived' hoort hierbij: een gedrukte/gegraveerde QR-code verwijst permanent naar
  // deze public_id en mag nooit stoppen met werken, ook niet nadat het product intern is
  // gearchiveerd. Alleen 'draft' (nooit gepubliceerd, heeft sowieso geen public_id) blijft
  // buiten beeld.
  return result.recordset[0] || null;
}

async function publishProduct(id) {
  const pool = await getPool();
  const existing = await getProductById(id);
  if (!existing) {
    return null;
  }

  const publicId = existing.public_id || crypto.randomUUID();

  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("publicId", sql.UniqueIdentifier, publicId)
    .query(`
      UPDATE dbo.Products
      SET public_id = @publicId,
          status = 'published',
          published_at = SYSUTCDATETIME(),
          updated_at = SYSUTCDATETIME()
      OUTPUT ${PUBLIC_COLUMNS.trim().split(/,\s*/).map((c) => `INSERTED.${c.trim()}`).join(", ")}
      WHERE id = @id
    `);

  return result.recordset[0] || null;
}

async function countProductsByStatus({ companyId } = {}) {
  const pool = await getPool();
  const request = pool.request();

  let where = "";
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where = "WHERE company_id = @companyId";
  }

  const result = await request.query(`
    SELECT status, COUNT(*) AS total
    FROM dbo.Products
    ${where}
    GROUP BY status
  `);

  const counts = { draft: 0, published: 0, archived: 0 };
  for (const row of result.recordset) {
    counts[row.status] = row.total;
  }
  return counts;
}

module.exports = {
  listProducts,
  listCategories,
  getProductStats,
  getProductById,
  createProduct,
  updateProduct,
  getProductByPublicId,
  publishProduct,
  countProductsByStatus
};
