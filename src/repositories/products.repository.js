const crypto = require("crypto");
const { getPool, sql } = require("../config/db");
const { calculateProductCompleteness } = require("../utils/completeness");

const PUBLIC_COLUMNS = `
  id, company_id, name, brand, model, sku, gtin, category_id, category_label, description,
  manufacturer, country_of_origin, photo_url, photo_blob_name, status, highlights, public_id,
  published_at, created_by, created_at, updated_at
`;

// Whitelist: voorkomt dat sort/order ooit rauw in de SQL belanden. De tweede kolom
// is dezelfde sortering op de buitenste query (na de LATERAL-join voor scans).
const SORTABLE_COLUMNS = {
  name: ["p.name", "paged.name"],
  created_at: ["p.created_at", "paged.created_at"],
  updated_at: ["p.updated_at", "paged.updated_at"],
  status: ["p.status", "paged.status"],
  category: ["p.category_label", "paged.category_label"]
};

function escapeLike(value) {
  return value.replace(/[\\%_\[]/g, (m) => `\\${m}`);
}

// Compleetheid van een productpaspoort: zeven gelijkwaardige criteria (foto,
// omschrijving, categorie, identificatie (SKU of GTIN), duurzaamheidsdata,
// compliance-data, minimaal één document). Als LATERAL-join berekend zodat de losse
// vlaggen teruggegeven kunnen worden ("wat ontbreekt er nog?") én er in WHERE en
// aggregaties op gefilterd/geteld kan worden.
const CHECKS_APPLY = `CROSS JOIN LATERAL (SELECT
  CASE WHEN (p.photo_url IS NOT NULL AND length(p.photo_url) > 0) OR p.photo_blob_name IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
  CASE WHEN p.description IS NOT NULL AND length(p.description) > 0 THEN 1 ELSE 0 END AS has_description,
  CASE WHEN p.category_label IS NOT NULL AND length(p.category_label) > 0 THEN 1 ELSE 0 END AS has_category,
  CASE WHEN (p.sku IS NOT NULL AND length(p.sku) > 0) OR (p.gtin IS NOT NULL AND length(p.gtin) > 0) THEN 1 ELSE 0 END AS has_identification,
  CASE WHEN EXISTS (SELECT 1 FROM dbo.ProductSustainability ps WHERE ps.product_id = p.id) THEN 1 ELSE 0 END AS has_sustainability,
  CASE WHEN EXISTS (SELECT 1 FROM dbo.ProductCompliance pc WHERE pc.product_id = p.id) THEN 1 ELSE 0 END AS has_compliance,
  CASE WHEN EXISTS (SELECT 1 FROM dbo.Documents d WHERE d.product_id = p.id) THEN 1 ELSE 0 END AS has_documents
) checks`;

const CHECK_COLUMNS =
  "checks.has_photo, checks.has_description, checks.has_category, checks.has_identification, checks.has_sustainability, checks.has_compliance, checks.has_documents";

const COMPLETENESS_EXPR =
  "(checks.has_photo + checks.has_description + checks.has_category + checks.has_identification + checks.has_sustainability + checks.has_compliance + checks.has_documents) * 100 / 7";

// Criteria waarop "wat ontbreekt?" gefilterd kan worden (?missing=documents). Vaste
// whitelist: de naam komt nooit rauw in de SQL.
const MISSING_CHECKS = {
  photo: "checks.has_photo",
  description: "checks.has_description",
  category: "checks.has_category",
  identification: "checks.has_identification",
  sustainability: "checks.has_sustainability",
  compliance: "checks.has_compliance",
  documents: "checks.has_documents"
};

function buildProductFilters({ companyId, q, status, category, doc, missing, qr, ids }, request) {
  const where = [];
  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("p.company_id = @companyId");
  }
  if (q) {
    request.input("q", sql.NVarChar(220), `%${escapeLike(q)}%`);
    // ILIKE: Azure SQL zocht hoofdletterongevoelig (collation), Postgres alleen met ILIKE.
    where.push("(p.name ILIKE @q ESCAPE '\\' OR p.sku ILIKE @q ESCAPE '\\' OR p.gtin ILIKE @q ESCAPE '\\' OR p.brand ILIKE @q ESCAPE '\\')");
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
    where.push(`${COMPLETENESS_EXPR} = 100`);
  } else if (doc === "incompleet") {
    where.push(`${COMPLETENESS_EXPR} < 100`);
  }
  if (missing && MISSING_CHECKS[missing]) {
    where.push(`${MISSING_CHECKS[missing]} = 0`);
  }
  // QR-status: actief = bereikbaar via de publieke link (gepubliceerd, of gearchiveerd
  // na publicatie); gereserveerd = public_id toegekend maar (nog) nooit gepubliceerd;
  // geen = nog niets. Zelfde definitie als getProductByPublicId.
  if (qr === "active") {
    where.push("p.public_id IS NOT NULL AND p.published_at IS NOT NULL AND p.status IN ('published', 'archived')");
  } else if (qr === "reserved") {
    where.push("p.public_id IS NOT NULL AND (p.status = 'draft' OR p.published_at IS NULL)");
  } else if (qr === "none") {
    where.push("p.public_id IS NULL");
  } else if (qr === "any") {
    where.push("p.public_id IS NOT NULL");
  }
  if (Array.isArray(ids)) {
    request.input("ids", sql.Int, ids);
    where.push("p.id = ANY(@ids::int[])");
  }
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

// Afgeleide QR-status (zelfde definitie als het qr-filter hierboven).
function qrStatusOf(row) {
  if (!row.public_id) return "none";
  if (row.status === "draft") return "reserved";
  // Gearchiveerd zonder ooit gepubliceerd te zijn: nooit openbaar geweest.
  if (row.published_at === null) return "reserved";
  return "active";
}

function checksOf(row) {
  return {
    photo: Boolean(row.has_photo),
    description: Boolean(row.has_description),
    category: Boolean(row.has_category),
    identification: Boolean(row.has_identification),
    sustainability: Boolean(row.has_sustainability),
    compliance: Boolean(row.has_compliance),
    documents: Boolean(row.has_documents)
  };
}

function decorate({ total: _ignored, ...row }) {
  // "Wat ontbreekt nog?" - direct bruikbaar voor de UI.
  const checks = checksOf(row);
  const completeness = calculateProductCompleteness(checks);
  return {
    ...row,
    completeness,
    action_required: completeness < 100,
    qr_status: qrStatusOf(row),
    checks
  };
}

async function listProducts({
  companyId,
  q,
  status,
  category,
  doc,
  missing,
  qr,
  withScans = false,
  sort = "name",
  order = "asc",
  page = 1,
  pageSize = 25
} = {}) {
  const pool = await getPool();
  const request = pool.request();

  const whereSql = buildProductFilters({ companyId, q, status, category, doc, missing, qr }, request);
  const [innerSort, outerSort] = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.name;
  const orderSql = order === "desc" ? "DESC" : "ASC";
  request.input("offset", sql.Int, (page - 1) * pageSize);
  request.input("limit", sql.Int, pageSize);

  const selectColumns = PUBLIC_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ");

  // Scan-aantallen alleen op verzoek (QR-overzicht) en alleen voor de rijen van deze
  // pagina: de LATERAL-join draait pas na het pagineren.
  const scansSelect = withScans ? ", scans.scan_count, scans.last_scan_at" : "";
  const scansJoin = withScans
    ? `LEFT JOIN LATERAL (
         SELECT COUNT(*) AS scan_count, MAX(s.scanned_at) AS last_scan_at
         FROM dbo.ScanEvents s WHERE s.product_id = paged.id
       ) scans ON true`
    : "";

  const result = await request.query(`
    SELECT paged.*${scansSelect}
    FROM (
      SELECT ${selectColumns},
             creator.email AS created_by_email,
             ${CHECK_COLUMNS},
             ${COMPLETENESS_EXPR} AS completeness,
             COUNT(*) OVER() AS total
      FROM dbo.Products p
      ${CHECKS_APPLY}
      LEFT JOIN dbo.Users creator ON creator.id = p.created_by
      ${whereSql}
      ORDER BY ${innerSort} ${orderSql}, p.id ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    ) paged
    ${scansJoin}
    ORDER BY ${outerSort} ${orderSql}, paged.id ASC
  `);

  const rows = result.recordset;
  const total = rows.length ? rows[0].total : 0;
  return { items: rows.map(decorate), total, page, pageSize };
}

// Id's van alle producten die aan een filter voldoen (voor bulkacties op "alle
// resultaten"). Altijd met companyId; begrensd zodat één actie nooit onbeperkt is.
async function listProductIds({ companyId, filters = {}, ids, limit = 10000 }) {
  const pool = await getPool();
  const request = pool.request();
  const whereSql = buildProductFilters({ ...filters, companyId, ids }, request);
  request.input("limit", sql.Int, limit);
  const result = await request.query(`
    SELECT p.id
    FROM dbo.Products p
    ${CHECKS_APPLY}
    ${whereSql}
    ORDER BY p.id
    LIMIT @limit
  `);
  return result.recordset.map((row) => row.id);
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

  const monthStart = "date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";
  // Gearchiveerde producten tellen niet mee voor "actie nodig" en de ontbrekende
  // gegevens: daar wordt niet meer aan gewerkt.
  const live = "p.status <> 'archived'";
  const result = await request.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN p.status = 'archived' THEN 1 ELSE 0 END) AS archived,
      SUM(CASE WHEN ${COMPLETENESS_EXPR} < 100 THEN 1 ELSE 0 END) AS action_required,
      SUM(CASE WHEN ${live} AND ${COMPLETENESS_EXPR} = 100 THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN p.status = 'draft' AND ${COMPLETENESS_EXPR} = 100 THEN 1 ELSE 0 END) AS ready_to_publish,
      ROUND(AVG(CASE WHEN ${live} THEN ${COMPLETENESS_EXPR} END)) AS avg_completeness,
      SUM(CASE WHEN p.created_at >= ${monthStart} THEN 1 ELSE 0 END) AS created_this_month,
      SUM(CASE WHEN p.published_at >= ${monthStart} THEN 1 ELSE 0 END) AS published_this_month,
      SUM(CASE WHEN p.public_id IS NOT NULL AND p.status <> 'draft' AND p.published_at IS NOT NULL THEN 1 ELSE 0 END) AS qr_active,
      SUM(CASE WHEN p.public_id IS NOT NULL AND (p.status = 'draft' OR p.published_at IS NULL) THEN 1 ELSE 0 END) AS qr_reserved,
      SUM(CASE WHEN ${live} AND checks.has_photo = 0 THEN 1 ELSE 0 END) AS missing_photo,
      SUM(CASE WHEN ${live} AND checks.has_description = 0 THEN 1 ELSE 0 END) AS missing_description,
      SUM(CASE WHEN ${live} AND checks.has_category = 0 THEN 1 ELSE 0 END) AS missing_category,
      SUM(CASE WHEN ${live} AND checks.has_identification = 0 THEN 1 ELSE 0 END) AS missing_identification,
      SUM(CASE WHEN ${live} AND checks.has_sustainability = 0 THEN 1 ELSE 0 END) AS missing_sustainability,
      SUM(CASE WHEN ${live} AND checks.has_compliance = 0 THEN 1 ELSE 0 END) AS missing_compliance,
      SUM(CASE WHEN ${live} AND checks.has_documents = 0 THEN 1 ELSE 0 END) AS missing_documents
    FROM dbo.Products p
    ${CHECKS_APPLY}
    ${where}
  `);

  const row = result.recordset[0];
  return {
    total: row.total || 0,
    published: row.published || 0,
    drafts: row.drafts || 0,
    archived: row.archived || 0,
    actionRequired: row.action_required || 0,
    complete: row.complete || 0,
    readyToPublish: row.ready_to_publish || 0,
    avgCompleteness: row.avg_completeness == null ? null : Number(row.avg_completeness),
    createdThisMonth: row.created_this_month || 0,
    publishedThisMonth: row.published_this_month || 0,
    qrActive: row.qr_active || 0,
    qrReserved: row.qr_reserved || 0,
    missing: {
      photo: row.missing_photo || 0,
      description: row.missing_description || 0,
      category: row.missing_category || 0,
      identification: row.missing_identification || 0,
      sustainability: row.missing_sustainability || 0,
      compliance: row.missing_compliance || 0,
      documents: row.missing_documents || 0
    }
  };
}

// Producten per categorie (top N + "overig") voor het dashboard.
async function countByCategory(companyId, limit = 6) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT COALESCE(NULLIF(category_label, ''), '') AS category, COUNT(*) AS total
      FROM dbo.Products
      WHERE company_id = @companyId AND status <> 'archived'
      GROUP BY 1
      ORDER BY total DESC, category
    `);
  const rows = result.recordset;
  const top = rows.slice(0, limit).map((r) => ({ category: r.category || null, total: r.total }));
  const rest = rows.slice(limit).reduce((sum, r) => sum + r.total, 0);
  if (rest > 0) top.push({ category: "__other__", total: rest });
  return top;
}

// Nieuwe producten per dag over de laatste N dagen.
async function countCreatedPerDay(companyId, days) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("days", sql.Int, days)
    .query(`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, COUNT(*) AS total
      FROM dbo.Products
      WHERE company_id = @companyId AND created_at >= now() - make_interval(days => @days)
      GROUP BY 1
    `);
  return result.recordset;
}

// Aantal producten dat meetelt voor de licentielimiet (gearchiveerde niet: die
// bestaan alleen nog voor QR-continuïteit en audit-historie).
async function countProductsForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query("SELECT COUNT(*) AS n FROM dbo.Products WHERE company_id = @companyId AND status <> 'archived'");
  return result.recordset[0].n;
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

// Product + compleetheid/QR-status in één query (voor de product-editor).
async function getProductWithChecks(id) {
  const pool = await getPool();
  const selectColumns = PUBLIC_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ");
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT ${selectColumns}, ${CHECK_COLUMNS}, ${COMPLETENESS_EXPR} AS completeness
      FROM dbo.Products p
      ${CHECKS_APPLY}
      WHERE p.id = @id
    `);
  const row = result.recordset[0];
  if (!row) return null;
  const { has_photo, has_description, has_category, has_identification, has_sustainability, has_compliance, has_documents, ...rest } = row;
  const decorated = decorate(row);
  return {
    ...rest,
    completeness: decorated.completeness,
    action_required: decorated.action_required,
    qr_status: decorated.qr_status,
    checks: decorated.checks
  };
}

async function createProduct({
  companyId,
  name,
  brand,
  model,
  sku,
  gtin,
  categoryLabel,
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
    .input("categoryLabel", sql.NVarChar(100), categoryLabel ?? null)
    .input("description", sql.NVarChar(sql.MAX), description ?? null)
    .input("manufacturer", sql.NVarChar(200), manufacturer ?? null)
    .input("countryOfOrigin", sql.NVarChar(100), countryOfOrigin ?? null)
    .input("photoUrl", sql.NVarChar(1000), photoUrl ?? null)
    .query(`
      INSERT INTO dbo.Products
        (company_id, name, brand, model, sku, gtin, category_label, description, manufacturer, country_of_origin, photo_url, created_by, status)
      VALUES
        (@companyId, @name, @brand, @model, @sku, @gtin, @categoryLabel, @description, @manufacturer, @countryOfOrigin, @photoUrl, @createdBy, 'draft')
      RETURNING ${PUBLIC_COLUMNS}
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = [
  "name",
  "brand",
  "model",
  "sku",
  "gtin",
  "categoryLabel",
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
  categoryLabel: "category_label",
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
  categoryLabel: () => sql.NVarChar(100),
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

  setClauses.push("updated_at = now()");

  const result = await request.query(`
    UPDATE dbo.Products
    SET ${setClauses.join(", ")}
    WHERE id = @id
    RETURNING ${PUBLIC_COLUMNS}
  `);

  return result.recordset[0] || null;
}

// public_id is een uuid-kolom: een kapotte/geraden id uit een URL zou in Postgres
// een castfout (500) geven i.p.v. "niet gevonden". Hoofdletters (zo staan ze in de
// al gedrukte QR-codes, Azure SQL gaf GUID's in hoofdletters) zijn prima.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getProductByPublicId(publicId) {
  if (!UUID_PATTERN.test(String(publicId || ""))) {
    return null;
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input("publicId", sql.UniqueIdentifier, publicId)
    .query(`
      SELECT ${PUBLIC_COLUMNS}
      FROM dbo.Products
      WHERE public_id = @publicId
        AND (status = 'published' OR (status = 'archived' AND published_at IS NOT NULL))
    `);
  // 'archived' hoort hierbij: een gedrukte/gegraveerde QR-code verwijst permanent naar
  // deze public_id en mag nooit stoppen met werken, ook niet nadat het product intern is
  // gearchiveerd. Maar alleen als het paspoort ooit gepubliceerd is: een gearchiveerd
  // concept met een gereserveerde QR-code is nooit openbaar geweest en blijft dat ook
  // niet. 'draft' blijft buiten beeld - pas publiceren maakt het paspoort openbaar.
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
          published_at = now(),
          updated_at = now()
      WHERE id = @id
      RETURNING ${PUBLIC_COLUMNS}
    `);

  return result.recordset[0] || null;
}

// Reserveert de permanente QR-sleutel zonder te publiceren: de code kan al gedrukt
// worden, de publieke pagina blijft "niet gevonden" tot het product gepubliceerd is.
// Een bestaande public_id wordt nooit vervangen.
async function reserveQr(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("publicId", sql.UniqueIdentifier, crypto.randomUUID())
    .query(`
      UPDATE dbo.Products
      SET public_id = COALESCE(public_id, @publicId), updated_at = now()
      WHERE id = @id
      RETURNING ${PUBLIC_COLUMNS}
    `);
  return result.recordset[0] || null;
}

// --- bulkacties --------------------------------------------------------------
// Alle bulkfuncties krijgen de companyId van de server mee en filteren daar altijd
// op: id's van een ander bedrijf worden stil genegeerd (geen IDOR, geen bevestiging
// dat ze bestaan). Ze geven het aantal daadwerkelijk gewijzigde producten terug.

async function bulkPublish(companyId, ids, { onlyComplete = true } = {}) {
  const pool = await getPool();
  const request = pool.request().input("companyId", sql.Int, companyId).input("ids", sql.Int, ids);
  const completeFilter = onlyComplete ? `AND ${COMPLETENESS_EXPR} = 100` : "";
  const result = await request.query(`
    UPDATE dbo.Products target
    SET public_id = COALESCE(target.public_id, gen_random_uuid()),
        status = 'published',
        published_at = now(),
        updated_at = now()
    FROM (
      SELECT p.id
      FROM dbo.Products p
      ${CHECKS_APPLY}
      WHERE p.company_id = @companyId AND p.id = ANY(@ids::int[]) AND p.status <> 'published' ${completeFilter}
    ) eligible
    WHERE target.id = eligible.id
    RETURNING target.id
  `);
  return result.recordset.map((r) => r.id);
}

async function bulkArchive(companyId, ids) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("ids", sql.Int, ids)
    .query(`
      UPDATE dbo.Products SET status = 'archived', updated_at = now()
      WHERE company_id = @companyId AND id = ANY(@ids::int[]) AND status <> 'archived'
      RETURNING id
    `);
  return result.recordset.map((r) => r.id);
}

async function bulkReserveQr(companyId, ids) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("ids", sql.Int, ids)
    .query(`
      UPDATE dbo.Products SET public_id = gen_random_uuid(), updated_at = now()
      WHERE company_id = @companyId AND id = ANY(@ids::int[]) AND public_id IS NULL
      RETURNING id
    `);
  return result.recordset.map((r) => r.id);
}

async function bulkSetCategory(companyId, ids, categoryLabel) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("ids", sql.Int, ids)
    .input("category", sql.NVarChar(100), categoryLabel || null)
    .query(`
      UPDATE dbo.Products SET category_label = @category, updated_at = now()
      WHERE company_id = @companyId AND id = ANY(@ids::int[])
      RETURNING id
    `);
  return result.recordset.map((r) => r.id);
}

// Alles wat op een label/export kan staan, voor een set producten van één bedrijf,
// in de volgorde van de aangeleverde id's.
async function getProductsForOutput(companyId, ids) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("ids", sql.Int, ids)
    .query(`
      SELECT p.id, p.name, p.brand, p.model, p.sku, p.gtin, p.category_label, p.description,
             p.manufacturer, p.country_of_origin, p.status, p.public_id, p.created_at, p.updated_at,
             s.co2_footprint_kg, s.recycled_material_pct, s.materials, s.recyclable,
             s.reach_conform, s.rohs_conform, c.ce_marked
      FROM dbo.Products p
      LEFT JOIN dbo.ProductSustainability s ON s.product_id = p.id
      LEFT JOIN dbo.ProductCompliance c ON c.product_id = p.id
      WHERE p.company_id = @companyId AND p.id = ANY(@ids::int[])
    `);
  const byId = new Map(result.recordset.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Bestaande producten op SKU (hoofdletterongevoelig) of GTIN, voor duplicaatdetectie
// bij import. Gearchiveerde producten tellen niet mee.
async function findExistingByIdentifiers(companyId, { skus = [], gtins = [] }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("skus", sql.NVarChar(100), skus.map((s) => s.toLowerCase()))
    .input("gtins", sql.NVarChar(50), gtins)
    .query(`
      SELECT id, lower(sku) AS sku_key, gtin
      FROM dbo.Products
      WHERE company_id = @companyId AND status <> 'archived'
        AND (lower(sku) = ANY(@skus::text[]) OR gtin = ANY(@gtins::text[]))
      ORDER BY id
    `);
  return result.recordset;
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

// Laatst gewijzigde producten (dashboard), met compleetheid en QR-status.
async function listRecentlyUpdated(companyId, limit = 6) {
  return listProducts({ companyId, sort: "updated_at", order: "desc", page: 1, pageSize: limit });
}

module.exports = {
  listProducts,
  listProductIds,
  listCategories,
  listRecentlyUpdated,
  getProductStats,
  countByCategory,
  countCreatedPerDay,
  countProductsForCompany,
  getProductById,
  getProductWithChecks,
  createProduct,
  updateProduct,
  getProductByPublicId,
  publishProduct,
  reserveQr,
  bulkPublish,
  bulkArchive,
  bulkReserveQr,
  bulkSetCategory,
  getProductsForOutput,
  findExistingByIdentifiers,
  countProductsByStatus,
  MISSING_CHECKS: Object.keys(MISSING_CHECKS)
};
