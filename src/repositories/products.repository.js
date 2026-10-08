const crypto = require("crypto");
const { query, queryRows, queryOne } = require("../config/db");

const PUBLIC_COLUMNS = `
  id, company_id, name, brand, model, sku, gtin, category_id, category_label, description,
  manufacturer, country_of_origin, photo_url, photo_blob_name, status, highlights, public_id,
  published_at, created_by, created_at, updated_at
`;
const PUBLIC_COLUMN_LIST = PUBLIC_COLUMNS.trim().split(/,\s*/).map((c) => c.trim());

// Whitelist: voorkomt dat sort/order ooit rauw in de SQL belanden.
const SORTABLE_COLUMNS = {
  name: "p.name",
  created_at: "p.created_at",
  status: "p.status",
  category: "p.category_label"
};

// public_id's komen uit QR-codes/URL's. Geprinte QR-codes van vóór de migratie
// bevatten de GUID in HOOFDLETTERS (zo gaf SQL Server hem terug); het uuid-type van
// Postgres vergelijkt hoofdletterongevoelig, dus die blijven gewoon werken. Alles wat
// geen geldige uuid is, is per definitie geen bestaand paspoort (en zou anders een
// cast-fout/500 geven).
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidPublicId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Compleetheid van een productpaspoort: zes gelijkwaardige criteria (foto,
// omschrijving, categorie, duurzaamheidsdata, compliance-data, minimaal één
// document). Als LATERAL-join berekend zodat de losse vlaggen teruggegeven kunnen
// worden ("wat ontbreekt er nog?") én er in WHERE en aggregaties op gefilterd/geteld
// kan worden.
const CHECKS_JOIN = `CROSS JOIN LATERAL (SELECT
  CASE WHEN (p.photo_url IS NOT NULL AND length(p.photo_url) > 0) OR p.photo_blob_name IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
  CASE WHEN p.description IS NOT NULL AND length(p.description) > 0 THEN 1 ELSE 0 END AS has_description,
  CASE WHEN p.category_label IS NOT NULL AND length(p.category_label) > 0 THEN 1 ELSE 0 END AS has_category,
  CASE WHEN EXISTS (SELECT 1 FROM product_sustainability ps WHERE ps.product_id = p.id) THEN 1 ELSE 0 END AS has_sustainability,
  CASE WHEN EXISTS (SELECT 1 FROM product_compliance pc WHERE pc.product_id = p.id) THEN 1 ELSE 0 END AS has_compliance,
  CASE WHEN EXISTS (SELECT 1 FROM documents d WHERE d.product_id = p.id AND d.archived_at IS NULL) THEN 1 ELSE 0 END AS has_documents
) checks`;

const COMPLETENESS_EXPR =
  "(checks.has_photo + checks.has_description + checks.has_category + checks.has_sustainability + checks.has_compliance + checks.has_documents) * 100 / 6";

function buildProductFilters({ companyId, q, status, category, doc }, params) {
  const where = [];
  if (companyId !== undefined) {
    params.push(companyId);
    where.push(`p.company_id = $${params.length}`);
  }
  if (q) {
    // ILIKE: SQL Server zocht hoofdletterongevoelig (collatie), Postgres' LIKE niet.
    params.push(`%${escapeLike(q)}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.gtin ILIKE $${n} OR p.brand ILIKE $${n})`);
  }
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`p.category_label = $${params.length}`);
  }
  if (doc === "compleet") {
    where.push(`${COMPLETENESS_EXPR} = 100`);
  } else if (doc === "incompleet") {
    where.push(`${COMPLETENESS_EXPR} < 100`);
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
  const params = [];
  const whereSql = buildProductFilters({ companyId, q, status, category, doc }, params);
  const sortSql = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.name;
  const orderSql = order === "desc" ? "DESC" : "ASC";
  params.push(pageSize, (page - 1) * pageSize);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const selectColumns = PUBLIC_COLUMN_LIST.map((c) => `p.${c}`).join(", ");

  const rows = await queryRows(
    `
    SELECT ${selectColumns},
           creator.email AS created_by_email,
           checks.has_photo, checks.has_description, checks.has_category,
           checks.has_sustainability, checks.has_compliance, checks.has_documents,
           ${COMPLETENESS_EXPR} AS completeness,
           COUNT(*) OVER() AS total
    FROM products p
    ${CHECKS_JOIN}
    LEFT JOIN users creator ON creator.id = p.created_by
    ${whereSql}
    ORDER BY ${sortSql} ${orderSql}, p.id ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `,
    params
  );

  const total = rows.length ? rows[0].total : 0;
  const items = rows.map(({ total: _ignored, ...row }) => ({
    ...row,
    action_required: row.completeness < 100,
    // "Wat ontbreekt nog?" - direct bruikbaar voor de UI.
    checks: {
      photo: Boolean(row.has_photo),
      description: Boolean(row.has_description),
      category: Boolean(row.has_category),
      sustainability: Boolean(row.has_sustainability),
      compliance: Boolean(row.has_compliance),
      documents: Boolean(row.has_documents)
    }
  }));
  return { items, total, page, pageSize };
}

// Statistieken voor de dashboard-tegels van het productoverzicht.
async function getProductStats({ companyId } = {}) {
  const params = [];
  let where = "";
  if (companyId !== undefined) {
    params.push(companyId);
    where = "WHERE p.company_id = $1";
  }

  const row = await queryOne(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN ${COMPLETENESS_EXPR} < 100 THEN 1 ELSE 0 END) AS action_required,
      SUM(CASE WHEN p.created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 1 ELSE 0 END) AS created_this_month,
      SUM(CASE WHEN p.published_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 1 ELSE 0 END) AS published_this_month
    FROM products p
    ${CHECKS_JOIN}
    ${where}
  `,
    params
  );

  return {
    total: row.total || 0,
    published: row.published || 0,
    drafts: row.drafts || 0,
    actionRequired: row.action_required || 0,
    createdThisMonth: row.created_this_month || 0,
    publishedThisMonth: row.published_this_month || 0
  };
}

// Aantal producten dat meetelt voor de licentielimiet (gearchiveerde niet: die
// bestaan alleen nog voor QR-continuïteit en audit-historie).
async function countProductsForCompany(companyId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM products WHERE company_id = $1 AND status <> 'archived'",
    [companyId]
  );
  return row.n;
}

// Onderscheiden categorielabels voor het filter in het productoverzicht.
async function listCategories({ companyId } = {}) {
  const params = [];
  let where = "WHERE category_label IS NOT NULL AND category_label <> ''";
  if (companyId !== undefined) {
    params.push(companyId);
    where += " AND company_id = $1";
  }
  const rows = await queryRows(
    `SELECT DISTINCT category_label FROM products ${where} ORDER BY category_label`,
    params
  );
  return rows.map((r) => r.category_label);
}

async function getProductById(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(`SELECT ${PUBLIC_COLUMNS} FROM products WHERE id = $1`, [id]);
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
  return queryOne(
    `
    INSERT INTO products
      (company_id, name, brand, model, sku, gtin, description, manufacturer, country_of_origin, photo_url, created_by, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
    RETURNING ${PUBLIC_COLUMNS}
  `,
    [
      companyId,
      name,
      brand ?? null,
      model ?? null,
      sku ?? null,
      gtin ?? null,
      description ?? null,
      manufacturer ?? null,
      countryOfOrigin ?? null,
      photoUrl ?? null,
      createdBy ?? null
    ]
  );
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
  "categoryLabel",
  "highlights",
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
  categoryLabel: "category_label",
  highlights: "highlights",
  status: "status"
};

async function updateProduct(id, fields) {
  const params = [id];
  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    let value = fields[field] ?? null;
    if (field === "highlights" && Array.isArray(value)) value = JSON.stringify(value);
    if (field === "categoryLabel" && value === "") value = null;
    params.push(value);
    setClauses.push(`${FIELD_TO_COLUMN[field]} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return getProductById(id);
  }

  setClauses.push("updated_at = now()");

  return queryOne(
    `UPDATE products SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    params
  );
}

// Compleetheid + losse criteria van één product (voor de checklist in de editor).
async function getProductChecks(id) {
  if (!Number.isInteger(id)) return null;
  const row = await queryOne(
    `SELECT checks.*, ${COMPLETENESS_EXPR} AS completeness,
            (p.sku IS NOT NULL AND p.sku <> '') OR (p.gtin IS NOT NULL AND p.gtin <> '') AS has_identification,
            p.public_id IS NOT NULL AS has_qr
     FROM products p ${CHECKS_JOIN} WHERE p.id = $1`,
    [id]
  );
  if (!row) return null;
  return {
    completeness: row.completeness,
    checks: {
      basic: true,
      identification: row.has_identification,
      photo: Boolean(row.has_photo),
      description: Boolean(row.has_description),
      category: Boolean(row.has_category),
      sustainability: Boolean(row.has_sustainability),
      compliance: Boolean(row.has_compliance),
      documents: Boolean(row.has_documents),
      qr: row.has_qr
    }
  };
}

async function getProductByPublicId(publicId) {
  if (!isValidPublicId(publicId)) return null;
  // 'archived' hoort hierbij: een gedrukte/gegraveerde QR-code verwijst permanent naar
  // deze public_id en mag nooit stoppen met werken, ook niet nadat het product intern is
  // gearchiveerd. Alleen 'draft' (nooit gepubliceerd, heeft sowieso geen public_id) blijft
  // buiten beeld.
  return queryOne(
    `SELECT ${PUBLIC_COLUMNS} FROM products WHERE public_id = $1 AND status IN ('published', 'archived')`,
    [publicId]
  );
}

async function publishProduct(id) {
  const existing = await getProductById(id);
  if (!existing) {
    return null;
  }

  // Een eenmaal uitgegeven public_id blijft voor altijd hetzelfde (QR-codes).
  const publicId = existing.public_id || crypto.randomUUID();

  return queryOne(
    `
    UPDATE products
    SET public_id = $2,
        status = 'published',
        published_at = now(),
        updated_at = now()
    WHERE id = $1
    RETURNING ${PUBLIC_COLUMNS}
  `,
    [id, publicId]
  );
}

async function countProductsByStatus({ companyId } = {}) {
  const params = [];
  let where = "";
  if (companyId !== undefined) {
    params.push(companyId);
    where = "WHERE company_id = $1";
  }

  const rows = await queryRows(`SELECT status, COUNT(*) AS total FROM products ${where} GROUP BY status`, params);

  const counts = { draft: 0, published: 0, archived: 0 };
  for (const row of rows) {
    counts[row.status] = row.total;
  }
  return counts;
}

module.exports = {
  listProducts,
  listCategories,
  getProductStats,
  countProductsForCompany,
  getProductById,
  createProduct,
  updateProduct,
  getProductByPublicId,
  getProductChecks,
  publishProduct,
  countProductsByStatus,
  isValidPublicId,
  buildProductFilters,
  CHECKS_JOIN,
  COMPLETENESS_EXPR,
  PUBLIC_COLUMNS
};
