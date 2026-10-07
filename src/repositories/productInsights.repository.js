const crypto = require("crypto");
const { query, queryRows, queryOne, withTransaction } = require("../config/db");
const { buildProductFilters, CHECKS_JOIN, COMPLETENESS_EXPR, PUBLIC_COLUMNS } = require("./products.repository");

// Overzichten en bulkbewerkingen op producten van ÉÉN bedrijf. Elke functie krijgt de
// companyId van de aanroeper (uit de sessie, nooit uit de request body) en elke query
// filtert daarop - zo blijft tenant-isolatie ook bij bulkacties gegarandeerd.

const MAX_BULK_IDS = 1000;

// --- dashboard ----------------------------------------------------------------

async function getCompanyOverview(companyId) {
  const [summary, scansDaily, categories, recent, docs, onboarding] = await Promise.all([
    queryOne(
      `
      SELECT
        COUNT(*) FILTER (WHERE p.status <> 'archived') AS total,
        COUNT(*) FILTER (WHERE p.status = 'published') AS published,
        COUNT(*) FILTER (WHERE p.status = 'draft') AS drafts,
        COUNT(*) FILTER (WHERE p.status = 'archived') AS archived,
        COUNT(*) FILTER (WHERE p.public_id IS NOT NULL AND p.status <> 'archived') AS qr_codes,
        COUNT(*) FILTER (WHERE p.status <> 'archived' AND ${COMPLETENESS_EXPR} < 100) AS incomplete,
        COUNT(*) FILTER (WHERE p.status <> 'archived' AND checks.has_documents = 0) AS missing_documents,
        COUNT(*) FILTER (WHERE p.status <> 'archived' AND checks.has_photo = 0) AS missing_photo,
        COUNT(*) FILTER (WHERE p.status = 'draft' AND ${COMPLETENESS_EXPR} = 100) AS ready_to_publish,
        COUNT(*) FILTER (WHERE p.status = 'draft' AND p.public_id IS NULL) AS drafts_without_qr,
        COALESCE(ROUND(AVG(${COMPLETENESS_EXPR}) FILTER (WHERE p.status <> 'archived')), 0) AS avg_completeness,
        COUNT(*) FILTER (WHERE p.created_at >= date_trunc('month', now())) AS created_this_month,
        COUNT(*) FILTER (WHERE p.created_at >= date_trunc('month', now()) - interval '1 month'
                         AND p.created_at < date_trunc('month', now())) AS created_prev_month
      FROM products p
      ${CHECKS_JOIN}
      WHERE p.company_id = $1
    `,
      [companyId]
    ),
    queryRows(
      `
      WITH daily AS (
        SELECT date_trunc('day', s.scanned_at) AS day, COUNT(*) AS scans
        FROM scan_events s
        JOIN products p ON p.id = s.product_id
        WHERE p.company_id = $1 AND s.scanned_at >= date_trunc('day', now()) - interval '89 days'
        GROUP BY 1
      )
      SELECT d AS day, COALESCE(daily.scans, 0) AS scans
      FROM generate_series(date_trunc('day', now()) - interval '89 days', date_trunc('day', now()), interval '1 day') d
      LEFT JOIN daily ON daily.day = d
      ORDER BY d
    `,
      [companyId]
    ),
    queryRows(
      `
      SELECT COALESCE(NULLIF(category_label, ''), 'Zonder categorie') AS category, COUNT(*) AS n
      FROM products
      WHERE company_id = $1 AND status <> 'archived'
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 6
    `,
      [companyId]
    ),
    queryRows(
      `
      SELECT p.id, p.name, p.sku, p.status, p.public_id, p.updated_at,
             ${COMPLETENESS_EXPR} AS completeness
      FROM products p
      ${CHECKS_JOIN}
      WHERE p.company_id = $1
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT 8
    `,
      [companyId]
    ),
    queryOne(
      `SELECT COUNT(*) AS documents, COALESCE(SUM(file_size::bigint), 0) AS storage_bytes
       FROM documents WHERE company_id = $1`,
      [companyId]
    ),
    queryOne(
      `
      SELECT
        (c.logo IS NOT NULL) AS has_logo,
        EXISTS (SELECT 1 FROM products WHERE company_id = c.id) AS has_product,
        EXISTS (SELECT 1 FROM import_jobs WHERE company_id = c.id AND status IN ('completed', 'completed_with_errors')) AS has_import,
        EXISTS (SELECT 1 FROM products WHERE company_id = c.id AND public_id IS NOT NULL) AS has_qr,
        EXISTS (SELECT 1 FROM documents WHERE company_id = c.id) AS has_document
      FROM companies c WHERE c.id = $1
    `,
      [companyId]
    )
  ]);

  const scanTotals = await queryOne(
    `
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE s.scanned_at >= date_trunc('day', now())) AS today,
           COUNT(*) FILTER (WHERE s.scanned_at >= date_trunc('month', now())) AS this_month,
           COUNT(*) FILTER (WHERE s.scanned_at >= date_trunc('month', now()) - interval '1 month'
                            AND s.scanned_at < date_trunc('month', now())) AS prev_month
    FROM scan_events s
    JOIN products p ON p.id = s.product_id
    WHERE p.company_id = $1
  `,
    [companyId]
  );

  return {
    summary,
    scans: scanTotals,
    scansDaily: scansDaily.map((r) => ({ day: r.day, scans: r.scans })),
    categories,
    recent,
    documents: docs,
    onboarding
  };
}

// --- QR-beheer ------------------------------------------------------------------

// QR-status: geen (nog geen public_id), gereserveerd (wel QR, product nog concept:
// de QR kan al geprint worden), actief (gepubliceerd), gearchiveerd (QR blijft werken,
// paspoort toont "gearchiveerd").
const QR_STATUS_SQL = `CASE
  WHEN p.public_id IS NULL THEN 'none'
  WHEN p.status = 'published' THEN 'active'
  WHEN p.status = 'archived' THEN 'archived'
  ELSE 'reserved' END`;

function qrFilterSql({ companyId, q, category, qrStatus, ids }, params) {
  const where = ["p.company_id = $1"];
  params.push(companyId);
  if (q) {
    params.push(`%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.gtin ILIKE $${n})`);
  }
  if (category) {
    params.push(category);
    where.push(`p.category_label = $${params.length}`);
  }
  if (qrStatus) {
    params.push(qrStatus);
    where.push(`${QR_STATUS_SQL} = $${params.length}`);
  } else if (!ids) {
    // Standaard toont QR-beheer alleen producten die al een QR-code hebben; een
    // expliciete selectie (ids) levert ook producten zonder QR (bijv. voor export).
    where.push("p.public_id IS NOT NULL");
  }
  if (ids) {
    params.push(ids);
    where.push(`p.id = ANY($${params.length}::int[])`);
  }
  return `WHERE ${where.join(" AND ")}`;
}

async function listQrItems({ companyId, q, category, qrStatus, ids, page = 1, pageSize = 24, sort = "name" }) {
  const params = [];
  const whereSql = qrFilterSql({ companyId, q, category, qrStatus, ids }, params);
  const orderSql = sort === "scans" ? "scans_total DESC, p.name ASC" : sort === "recent" ? "p.updated_at DESC" : "p.name ASC";
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await queryRows(
    `
    SELECT p.id, p.name, p.sku, p.gtin, p.brand, p.manufacturer, p.model, p.country_of_origin,
           p.category_label, p.status, p.public_id, p.updated_at,
           ${QR_STATUS_SQL} AS qr_status,
           COALESCE(st.scans_total, 0) AS scans_total, st.last_scan,
           pc.ce_marked, ps.recyclable,
           COUNT(*) OVER() AS total
    FROM products p
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS scans_total, MAX(scanned_at) AS last_scan FROM scan_events WHERE product_id = p.id
    ) st ON TRUE
    LEFT JOIN product_compliance pc ON pc.product_id = p.id
    LEFT JOIN product_sustainability ps ON ps.product_id = p.id
    ${whereSql}
    ORDER BY ${orderSql}, p.id
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `,
    params
  );
  const total = rows.length ? rows[0].total : 0;
  return { items: rows.map(({ total: _t, ...row }) => row), total, page, pageSize };
}

async function getQrStats(companyId) {
  const [counts, top] = await Promise.all([
    queryOne(
      `
      SELECT
        COUNT(*) FILTER (WHERE p.public_id IS NOT NULL) AS total,
        COUNT(*) FILTER (WHERE p.public_id IS NOT NULL AND p.status = 'published') AS active,
        COUNT(*) FILTER (WHERE p.public_id IS NOT NULL AND p.status = 'draft') AS reserved,
        COUNT(*) FILTER (WHERE p.public_id IS NOT NULL AND p.status = 'archived') AS archived,
        COUNT(*) FILTER (WHERE p.public_id IS NULL AND p.status = 'draft') AS without_qr,
        (SELECT COUNT(*) FROM scan_events s JOIN products x ON x.id = s.product_id WHERE x.company_id = $1) AS scans_total,
        (SELECT COUNT(*) FROM scan_events s JOIN products x ON x.id = s.product_id
          WHERE x.company_id = $1 AND s.scanned_at >= date_trunc('day', now())) AS scans_today,
        (SELECT COUNT(*) FROM scan_events s JOIN products x ON x.id = s.product_id
          WHERE x.company_id = $1 AND s.scanned_at >= date_trunc('month', now())) AS scans_month
      FROM products p
      WHERE p.company_id = $1
    `,
      [companyId]
    ),
    queryRows(
      `
      SELECT p.id, p.name, p.sku, COUNT(s.id) AS scans
      FROM scan_events s
      JOIN products p ON p.id = s.product_id
      WHERE p.company_id = $1 AND s.scanned_at >= now() - interval '30 days'
      GROUP BY p.id, p.name, p.sku
      ORDER BY scans DESC
      LIMIT 5
    `,
      [companyId]
    )
  ]);
  return { ...counts, topScanned: top };
}

// --- bulkacties -------------------------------------------------------------------

// Selectie: óf expliciete ids (max. MAX_BULK_IDS), óf "alles wat aan dit filter
// voldoet". Beide altijd binnen het bedrijf van de gebruiker.
function selectionSql({ companyId, ids, filter }, params) {
  if (ids) {
    params.push(companyId, ids);
    return `p.company_id = $${params.length - 1} AND p.id = ANY($${params.length}::int[])`;
  }
  const whereSql = buildProductFilters({ companyId, ...(filter || {}) }, params);
  return whereSql.replace(/^WHERE /, "");
}

async function countSelection({ companyId, ids, filter }) {
  const params = [];
  const where = selectionSql({ companyId, ids, filter }, params);
  const row = await queryOne(`SELECT COUNT(*) AS n FROM products p ${CHECKS_JOIN} WHERE ${where}`, params);
  return row.n;
}

// Voert een bulkactie uit en geeft { affected, skipped, ids } terug. Alles in één
// transactie: een halve bulkactie bestaat niet.
async function runBulkAction({ companyId, ids, filter, action, category, includeIncomplete = false }) {
  return withTransaction(async (client) => {
    const params = [];
    let where = selectionSql({ companyId, ids, filter }, params);
    // Alleen producten waarop de actie iets doet tellen mee voor de limiet van 1000,
    // zodat bijv. "QR genereren voor alles" in rondes van 1000 kan.
    const relevant = {
      publish: "p.status = 'draft'",
      archive: "p.status <> 'archived'",
      restore: "p.status = 'archived'",
      reserve_qr: "p.public_id IS NULL AND p.status <> 'archived'"
    }[action];
    if (relevant && filter) where = `(${where}) AND ${relevant}`;
    const selected = await client.query(
      `SELECT p.id, p.status, p.public_id, ${COMPLETENESS_EXPR} AS completeness
       FROM products p ${CHECKS_JOIN} WHERE ${where} ORDER BY p.id LIMIT ${MAX_BULK_IDS + 1}`,
      params
    );
    if (selected.rows.length > MAX_BULK_IDS) {
      const error = new Error(`Te veel producten in één bulkactie (max. ${MAX_BULK_IDS}). Verfijn het filter.`);
      error.code = "BULK_TOO_LARGE";
      throw error;
    }

    let targets = selected.rows;
    let skipped = 0;

    if (action === "publish") {
      const eligible = targets.filter((r) => r.status !== "archived" && (includeIncomplete || r.completeness === 100));
      skipped = targets.length - eligible.length;
      targets = eligible.filter((r) => r.status !== "published");
      for (const row of targets) {
        await client.query(
          `UPDATE products SET public_id = COALESCE(public_id, $2::uuid), status = 'published',
                  published_at = now(), updated_at = now()
           WHERE id = $1 AND company_id = $3`,
          [row.id, crypto.randomUUID(), companyId]
        );
      }
    } else if (action === "archive") {
      targets = targets.filter((r) => r.status !== "archived");
      await client.query(
        `UPDATE products SET status = 'archived', updated_at = now() WHERE company_id = $1 AND id = ANY($2::int[])`,
        [companyId, targets.map((r) => r.id)]
      );
    } else if (action === "restore") {
      targets = targets.filter((r) => r.status === "archived");
      // Terug naar concept; een al uitgegeven QR (public_id) blijft behouden.
      await client.query(
        `UPDATE products SET status = 'draft', updated_at = now() WHERE company_id = $1 AND id = ANY($2::int[])`,
        [companyId, targets.map((r) => r.id)]
      );
    } else if (action === "set_category") {
      await client.query(
        `UPDATE products SET category_label = $3, updated_at = now() WHERE company_id = $1 AND id = ANY($2::int[])`,
        [companyId, targets.map((r) => r.id), category || null]
      );
    } else if (action === "reserve_qr") {
      // QR-code uitgeven zonder te publiceren: labels kunnen al geprint worden; de
      // publieke pagina toont tot publicatie "nog niet gepubliceerd".
      targets = targets.filter((r) => !r.public_id && r.status !== "archived");
      for (const row of targets) {
        await client.query(
          `UPDATE products SET public_id = $2::uuid, updated_at = now() WHERE id = $1 AND company_id = $3 AND public_id IS NULL`,
          [row.id, crypto.randomUUID(), companyId]
        );
      }
    } else {
      throw new Error(`Onbekende bulkactie: ${action}`);
    }

    return { selected: selected.rows.length, affected: targets.length, skipped, ids: targets.map((r) => r.id) };
  });
}

// Eén product een QR geven zonder te publiceren.
async function reserveQr(companyId, productId) {
  return queryOne(
    `UPDATE products SET public_id = COALESCE(public_id, $3::uuid), updated_at = now()
     WHERE id = $1 AND company_id = $2 AND status <> 'archived'
     RETURNING ${PUBLIC_COLUMNS}`,
    [productId, companyId, crypto.randomUUID()]
  );
}

// --- import -------------------------------------------------------------------------

// Bestaande producten van dit bedrijf met een van deze SKU's/GTIN's.
async function findExistingByKeys(companyId, skus, gtins) {
  if (!skus.length && !gtins.length) return [];
  return queryRows(
    `
    SELECT id, name, sku, gtin, status
    FROM products
    WHERE company_id = $1
      AND status <> 'archived'
      AND ((sku IS NOT NULL AND lower(sku) = ANY($2::text[])) OR (gtin IS NOT NULL AND gtin = ANY($3::text[])))
  `,
    [companyId, skus.map((s) => s.toLowerCase()), gtins]
  );
}

// --- zoeken ---------------------------------------------------------------------------

async function searchCompany(companyId, q, limit = 6) {
  const like = `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const [products, documents] = await Promise.all([
    queryRows(
      `SELECT id, name, sku, gtin, status, public_id FROM products
       WHERE company_id = $1 AND (name ILIKE $2 OR sku ILIKE $2 OR gtin ILIKE $2 OR public_id::text ILIKE $2)
       ORDER BY updated_at DESC LIMIT $3`,
      [companyId, like, limit]
    ),
    queryRows(
      `SELECT d.id, d.title, d.product_id, p.name AS product_name FROM documents d
       JOIN products p ON p.id = d.product_id
       WHERE d.company_id = $1 AND d.title ILIKE $2
       ORDER BY d.created_at DESC LIMIT $3`,
      [companyId, like, limit]
    )
  ]);
  return { products, documents };
}

module.exports = {
  MAX_BULK_IDS,
  getCompanyOverview,
  listQrItems,
  getQrStats,
  countSelection,
  runBulkAction,
  reserveQr,
  findExistingByKeys,
  searchCompany
};
