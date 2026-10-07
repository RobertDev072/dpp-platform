const { query, queryOne, queryRows, withTransaction } = require("../config/db");
const { HttpError } = require("../middleware/errorHandler");
const { normalizeRow, SUSTAINABILITY_KEYS, COMPLIANCE_KEYS } = require("./importFields");
const { getLicenseUsage, STATUS } = require("./license.service");
const insights = require("../repositories/productInsights.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");

// Bulkimport van producten. De browser leest het bestand en stuurt de (al naar
// velden gekoppelde) rijen in blokken; deze service is de gezaghebbende validatie en
// schrijft per blok in één transactie. De tenant komt altijd uit de sessie.

const MAX_STORED_ERRORS = 2000;
const IMPORTED_STATUS = "draft"; // Import publiceert nooit: publiceren is een bewuste stap.

function rowKeys(values) {
  return {
    sku: values.sku ? values.sku.toLowerCase() : null,
    gtin: values.gtin || null
  };
}

function indexExisting(products) {
  const bySku = new Map();
  const byGtin = new Map();
  for (const p of products) {
    if (p.sku) bySku.set(p.sku.toLowerCase(), p);
    if (p.gtin) byGtin.set(p.gtin, p);
  }
  return { bySku, byGtin };
}

function findMatch(index, values) {
  const { sku, gtin } = rowKeys(values);
  return (sku && index.bySku.get(sku)) || (gtin && index.byGtin.get(gtin)) || null;
}

async function loadExistingIndex(companyId, normalizedRows) {
  const skus = [...new Set(normalizedRows.map((r) => r.values.sku).filter(Boolean))];
  const gtins = [...new Set(normalizedRows.map((r) => r.values.gtin).filter(Boolean))];
  return indexExisting(await insights.findExistingByKeys(companyId, skus, gtins));
}

function productLabel(row) {
  return row.values?.name || row.values?.sku || "";
}

// Voorvertoning: valideert rijen en meldt welke een bestaand product raken. Schrijft niets.
async function previewRows(companyId, rows) {
  const normalized = rows.map((row) => ({ row: row.row, ...normalizeRow(row.values || {}) }));
  const index = await loadExistingIndex(companyId, normalized);
  return normalized.map((r) => {
    const match = r.errors.length ? null : findMatch(index, r.values);
    return {
      row: r.row,
      errors: r.errors,
      warnings: r.warnings,
      existing: match ? { id: match.id, name: match.name, sku: match.sku, gtin: match.gtin } : null
    };
  });
}

async function createJob({ companyId, userId, fileName, totalRows, duplicateMode, mapping }) {
  const usage = await getLicenseUsage(companyId);
  if (usage?.status === STATUS.EXPIRED) {
    throw new HttpError(409, "De licentie van dit bedrijf is verlopen; importeren is niet mogelijk.", undefined, "LICENSE_EXPIRED");
  }
  return queryOne(
    `INSERT INTO import_jobs (company_id, created_by, file_name, total_rows, duplicate_mode, mapping)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [companyId, userId, fileName, totalRows, duplicateMode, JSON.stringify(mapping || {})]
  );
}

async function getJob(companyId, jobId) {
  if (!Number.isInteger(jobId)) return null;
  return queryOne(`SELECT * FROM import_jobs WHERE id = $1 AND company_id = $2`, [jobId, companyId]);
}

async function listJobs(companyId, { page = 1, pageSize = 20 } = {}) {
  const rows = await queryRows(
    `SELECT j.id, j.file_name, j.status, j.duplicate_mode, j.total_rows, j.processed_rows,
            j.created_count, j.updated_count, j.skipped_count, j.error_count,
            j.created_at, j.finished_at, u.email AS created_by_email,
            COUNT(*) OVER() AS total
     FROM import_jobs j
     LEFT JOIN users u ON u.id = j.created_by
     WHERE j.company_id = $1
     ORDER BY j.created_at DESC, j.id DESC
     LIMIT $2 OFFSET $3`,
    [companyId, pageSize, (page - 1) * pageSize]
  );
  return { items: rows.map(({ total: _t, ...r }) => r), total: rows.length ? rows[0].total : 0, page, pageSize };
}

function textOrNull(value) {
  return value === undefined || value === null || value === "" ? null : value;
}

// Verwerkt één blok rijen. Geeft per rij de uitkomst terug.
async function processRows({ companyId, userId, jobId, rows }) {
  return withTransaction(async (client) => {
    // Rij-lock op de job: gelijktijdige blokken van dezelfde import worden
    // geserialiseerd, zodat tellers en duplicaatdetectie kloppen.
    const jobResult = await client.query(
      `SELECT * FROM import_jobs WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [jobId, companyId]
    );
    const job = jobResult.rows[0];
    if (!job) throw new HttpError(404, "Import niet gevonden");
    if (job.status !== "running") throw new HttpError(409, "Deze import is al afgerond", undefined, "IMPORT_FINISHED");

    const normalized = rows.map((row) => ({ row: row.row, ...normalizeRow(row.values || {}) }));

    const skus = [...new Set(normalized.map((r) => r.values.sku).filter(Boolean).map((s) => s.toLowerCase()))];
    const gtins = [...new Set(normalized.map((r) => r.values.gtin).filter(Boolean))];
    const existingRows = skus.length || gtins.length
      ? (
          await client.query(
            `SELECT id, name, sku, gtin FROM products
             WHERE company_id = $1 AND status <> 'archived'
               AND ((sku IS NOT NULL AND lower(sku) = ANY($2::text[])) OR (gtin IS NOT NULL AND gtin = ANY($3::text[])))`,
            [companyId, skus, gtins]
          )
        ).rows
      : [];
    const index = indexExisting(existingRows);

    // Licentie: hoeveel nieuwe producten mogen er nog bij (per bedrijf).
    const usageRow = (
      await client.query(
        `SELECT pl.max_products,
                (SELECT COUNT(*) FROM products WHERE company_id = c.id AND status <> 'archived') AS used,
                c.license_end
         FROM companies c LEFT JOIN plans pl ON pl.id = c.plan_id WHERE c.id = $1`,
        [companyId]
      )
    ).rows[0];
    let remaining = usageRow?.max_products == null ? Infinity : Math.max(0, usageRow.max_products - usageRow.used);

    const results = [];
    const newErrors = [];
    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };

    for (const r of normalized) {
      if (r.errors.length) {
        counts.errors += 1;
        for (const e of r.errors) newErrors.push({ row: r.row, product: productLabel(r), ...e });
        results.push({ row: r.row, outcome: "error", errors: r.errors });
        continue;
      }

      const v = r.values;
      const match = findMatch(index, v);
      let productId;
      let outcome;

      if (match && job.duplicate_mode === "skip") {
        counts.skipped += 1;
        results.push({ row: r.row, outcome: "skipped", productId: match.id, reason: "Bestaat al (zelfde SKU/GTIN)" });
        continue;
      }

      if (match && job.duplicate_mode === "update") {
        // Alleen ingevulde cellen overschrijven; lege cellen wissen nooit bestaande data.
        const sets = [];
        const params = [match.id, companyId];
        const columns = {
          name: "name", sku: "sku", gtin: "gtin", brand: "brand", manufacturer: "manufacturer", model: "model",
          category: "category_label", countryOfOrigin: "country_of_origin", description: "description"
        };
        for (const [key, column] of Object.entries(columns)) {
          if (v[key] !== undefined) {
            params.push(v[key]);
            sets.push(`${column} = $${params.length}`);
          }
        }
        if (sets.length) {
          await client.query(
            `UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND company_id = $2`,
            params
          );
        }
        productId = match.id;
        outcome = "updated";
      } else {
        if (remaining <= 0) {
          counts.errors += 1;
          const error = { field: null, error: "Productlimiet van het abonnement bereikt", suggestion: "Upgrade het abonnement of archiveer producten" };
          newErrors.push({ row: r.row, product: productLabel(r), ...error });
          results.push({ row: r.row, outcome: "error", errors: [error] });
          continue;
        }
        const inserted = await client.query(
          `INSERT INTO products
             (company_id, name, sku, gtin, brand, manufacturer, model, category_label, country_of_origin,
              description, created_by, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, name, sku, gtin`,
          [
            companyId, v.name, textOrNull(v.sku), textOrNull(v.gtin), textOrNull(v.brand), textOrNull(v.manufacturer),
            textOrNull(v.model), textOrNull(v.category), textOrNull(v.countryOfOrigin), textOrNull(v.description),
            userId, IMPORTED_STATUS
          ]
        );
        remaining -= 1;
        productId = inserted.rows[0].id;
        outcome = "created";
        // Volgende rijen in dit blok met dezelfde SKU/GTIN zien dit product als bestaand.
        const created = inserted.rows[0];
        if (created.sku) index.bySku.set(created.sku.toLowerCase(), created);
        if (created.gtin) index.byGtin.set(created.gtin, created);
      }

      if (SUSTAINABILITY_KEYS.some((k) => v[k] !== undefined)) {
        await upsertSustainabilityInTx(client, productId, v);
      }
      if (COMPLIANCE_KEYS.some((k) => v[k] !== undefined)) {
        await client.query(
          `INSERT INTO product_compliance (product_id, ce_marked) VALUES ($1, $2)
           ON CONFLICT (product_id) DO UPDATE SET ce_marked = EXCLUDED.ce_marked, updated_at = now()`,
          [productId, v.ceMarked]
        );
      }

      counts[outcome] += 1;
      results.push({ row: r.row, outcome, productId, warnings: r.warnings });
    }

    const storedErrors = job.errors ? JSON.parse(job.errors) : [];
    const mergedErrors = storedErrors.concat(newErrors).slice(0, MAX_STORED_ERRORS);

    const updated = await client.query(
      `UPDATE import_jobs SET
         processed_rows = processed_rows + $2,
         created_count = created_count + $3,
         updated_count = updated_count + $4,
         skipped_count = skipped_count + $5,
         error_count = error_count + $6,
         errors = $7
       WHERE id = $1
       RETURNING *`,
      [jobId, rows.length, counts.created, counts.updated, counts.skipped, counts.errors, JSON.stringify(mergedErrors)]
    );

    return { results, job: publicJob(updated.rows[0]) };
  });
}

// Samenvoegen met bestaande duurzaamheidsdata: alleen ingevulde cellen overschrijven.
async function upsertSustainabilityInTx(client, productId, v) {
  const materials = v.material !== undefined ? JSON.stringify([{ material: v.material, pct: null }]) : null;
  await client.query(
    `INSERT INTO product_sustainability
       (product_id, co2_footprint_kg, recycled_material_pct, materials, recyclable, reach_conform, rohs_conform)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (product_id) DO UPDATE SET
       co2_footprint_kg = COALESCE(EXCLUDED.co2_footprint_kg, product_sustainability.co2_footprint_kg),
       recycled_material_pct = COALESCE(EXCLUDED.recycled_material_pct, product_sustainability.recycled_material_pct),
       materials = COALESCE(EXCLUDED.materials, product_sustainability.materials),
       recyclable = COALESCE(EXCLUDED.recyclable, product_sustainability.recyclable),
       reach_conform = COALESCE(EXCLUDED.reach_conform, product_sustainability.reach_conform),
       rohs_conform = COALESCE(EXCLUDED.rohs_conform, product_sustainability.rohs_conform),
       updated_at = now()`,
    [
      productId,
      v.co2FootprintKg ?? null,
      v.recycledMaterialPct ?? null,
      materials,
      v.recyclable ?? null,
      v.reachConform ?? null,
      v.rohsConform ?? null
    ]
  );
}

async function finishJob({ companyId, jobId, cancelled = false }) {
  const job = await queryOne(
    `UPDATE import_jobs SET
       status = CASE WHEN $3 THEN 'cancelled'
                     WHEN error_count > 0 THEN 'completed_with_errors'
                     ELSE 'completed' END,
       finished_at = now()
     WHERE id = $1 AND company_id = $2 AND status = 'running'
     RETURNING *`,
    [jobId, companyId, cancelled]
  );
  return job ? publicJob(job) : null;
}

// Jobs die langer dan een uur "running" staan (bijv. browser gesloten midden in de
// import) worden als afgebroken gemarkeerd - draait mee in de dagelijkse cron.
async function expireStaleJobs() {
  await query(
    `UPDATE import_jobs SET status = 'cancelled', finished_at = now()
     WHERE status = 'running' AND created_at < now() - interval '1 hour'`
  );
}

function publicJob(job, { includeErrors = false } = {}) {
  if (!job) return null;
  const { errors, mapping, company_id: _c, ...rest } = job;
  const result = { ...rest };
  if (includeErrors) {
    result.errors = errors ? JSON.parse(errors) : [];
    result.mapping = mapping ? JSON.parse(mapping) : {};
  }
  return result;
}

module.exports = {
  previewRows,
  createJob,
  getJob,
  listJobs,
  processRows,
  finishJob,
  expireStaleJobs,
  publicJob
};
