const { getPool } = require("../config/db");
const { HttpError } = require("../middleware/errorHandler");
const { validateRow, identityKeys, CHUNK_SIZE } = require("./productImport.service");
const { getLicenseUsage, STATUS } = require("./license.service");
const { logAudit } = require("../utils/auditLog");

// Verwerkt precies één chunk (max. CHUNK_SIZE rijen) van een gevalideerde import.
//
// - De job wordt met SELECT ... FOR UPDATE vergrendeld: twee gelijktijdige aanroepen
//   (dubbelklik, twee tabbladen, herstart na een refresh) verwerken nooit dezelfde
//   rijen; de tweede wacht en gaat verder vanaf de nieuwe processed_rows.
// - Chunk + voortgang worden in één transactie vastgelegd: faalt er iets, dan rolt de
//   hele chunk terug en kan hij veilig opnieuw worden aangeroepen.
// - Elke rij krijgt een SAVEPOINT: één kapotte rij laat de rest van de chunk door.
// - De tenant komt uit de job zelf, die alleen met de companyId van de sessie wordt
//   opgehaald.

const EDITABLE_PRODUCT_COLUMNS = [
  ["name", "name"],
  ["brand", "brand"],
  ["model", "model"],
  ["sku", "sku"],
  ["gtin", "gtin"],
  ["category", "category_label"],
  ["description", "description"],
  ["manufacturer", "manufacturer"],
  ["country_of_origin", "country_of_origin"],
  ["photo_url", "photo_url"]
];

const SUSTAINABILITY_FIELDS = [
  ["carbon_footprint_kg", "co2_footprint_kg"],
  ["recycled_material_percentage", "recycled_material_pct"],
  ["materials", "materials"],
  ["recyclable", "recyclable"],
  ["reach_compliant", "reach_conform"],
  ["rohs_compliant", "rohs_conform"],
  ["expected_lifespan_years", "expected_lifespan_years"]
];

const COMPLIANCE_FIELDS = [
  ["ce_marked", "ce_marked"],
  ["regulations", "applicable_regulations"]
];

function dbValue(key, value) {
  if (key === "materials" || key === "regulations") return JSON.stringify(value);
  return value;
}

async function upsertChildren(client, productId, values) {
  const sustainability = SUSTAINABILITY_FIELDS.filter(([key]) => values[key] !== undefined);
  if (sustainability.length) {
    const cols = sustainability.map(([, col]) => col);
    const params = sustainability.map(([key]) => dbValue(key, values[key]));
    // Bijwerken zonder bestaande waarden te wissen: alleen meegeleverde kolommen.
    await client.query(
      `INSERT INTO dbo.ProductSustainability (product_id, ${cols.join(", ")})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
       ON CONFLICT (product_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, updated_at = now()`,
      [productId, ...params]
    );
  }
  const compliance = COMPLIANCE_FIELDS.filter(([key]) => values[key] !== undefined);
  if (compliance.length) {
    const cols = compliance.map(([, col]) => col);
    const params = compliance.map(([key]) => dbValue(key, values[key]));
    await client.query(
      `INSERT INTO dbo.ProductCompliance (product_id, ${cols.join(", ")})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
       ON CONFLICT (product_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, updated_at = now()`,
      [productId, ...params]
    );
  }
}

async function createProductRow(client, job, values) {
  const cols = EDITABLE_PRODUCT_COLUMNS.filter(([key]) => values[key] !== undefined);
  const params = [job.company_id, job.created_by, ...cols.map(([key]) => values[key])];
  const result = await client.query(
    `INSERT INTO dbo.Products (company_id, created_by, status${cols.map(([, col]) => `, ${col}`).join("")})
     VALUES ($1, $2, 'draft'${cols.map((_, i) => `, $${i + 3}`).join("")})
     RETURNING id`,
    params
  );
  const productId = result.rows[0].id;
  await upsertChildren(client, productId, values);
  return productId;
}

// Bijwerken van een bestaand product: alleen ingevulde velden, nooit status of
// public_id - een import kan dus niets publiceren of een QR-code wijzigen.
async function updateProductRow(client, job, productId, values) {
  const cols = EDITABLE_PRODUCT_COLUMNS.filter(([key]) => values[key] !== undefined);
  if (cols.length) {
    await client.query(
      `UPDATE dbo.Products SET ${cols.map(([, col], i) => `${col} = $${i + 3}`).join(", ")}, updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [productId, job.company_id, ...cols.map(([key]) => values[key])]
    );
  }
  await upsertChildren(client, productId, values);
}

async function findExisting(client, companyId, entries) {
  const skus = [...new Set(entries.map((e) => e.keys.sku).filter(Boolean))];
  const gtins = [...new Set(entries.map((e) => e.keys.gtin).filter(Boolean))];
  if (!skus.length && !gtins.length) return { bySku: new Map(), byGtin: new Map() };
  const result = await client.query(
    `SELECT id, lower(sku) AS sku_key, gtin FROM dbo.Products
     WHERE company_id = $1 AND status <> 'archived' AND (lower(sku) = ANY($2::text[]) OR gtin = ANY($3::text[]))
     ORDER BY id`,
    [companyId, skus, gtins]
  );
  const bySku = new Map();
  const byGtin = new Map();
  for (const row of result.rows) {
    if (row.sku_key && !bySku.has(row.sku_key)) bySku.set(row.sku_key, row.id);
    if (row.gtin && !byGtin.has(row.gtin)) byGtin.set(row.gtin, row.id);
  }
  return { bySku, byGtin };
}

const JOB_COLUMNS = `id, company_id, created_by, status, column_mapping, duplicate_strategy, total_rows,
  processed_rows, current_chunk, created_count, updated_count, skipped_count, error_count, success_count,
  error_rows, jsonb_array_length(errors) AS stored_errors`;

async function runImportChunk({ importId, companyId }) {
  // Licentie vóór de transactie ophalen: binnen een open transactie een tweede
  // verbinding uit de (kleine) pool vragen kan onder belasting vastlopen.
  const usage = await getLicenseUsage(companyId);
  const pool = await getPool();
  const client = await pool.connect();
  let completedJob = null;
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(
      `SELECT ${JOB_COLUMNS} FROM dbo.ProductImports WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [importId, companyId]
    );
    const job = jobResult.rows[0];
    if (!job) throw new HttpError(404, "Niet gevonden");
    if (["completed", "cancelled", "failed"].includes(job.status)) {
      await client.query("COMMIT");
      return { done: true };
    }
    if (job.status === "pending") {
      throw new HttpError(409, "Controleer eerst de kolomkoppeling en validatie voordat je importeert.");
    }

    if (!usage || usage.status === STATUS.EXPIRED) {
      throw new HttpError(409, "De licentie van dit bedrijf is verlopen; importeren is niet mogelijk.", undefined, "LICENSE_EXPIRED");
    }

    if (job.status === "validating") {
      // Eerste chunk: foutteller resetten (de validatietelling was een voorspelling;
      // tijdens het importeren telt elke rij precies één keer).
      await client.query(
        `UPDATE dbo.ProductImports SET status = 'importing', started_at = now(), error_count = 0
         WHERE id = $1`,
        [job.id]
      );
      job.error_count = 0;
    }

    const from = job.processed_rows;
    const to = Math.min(job.total_rows, from + CHUNK_SIZE);
    const rowsResult = await client.query(
      `SELECT jsonb_path_query_array(rows, '$[$from to $to]', jsonb_build_object('from', $2::int, 'to', $3::int)) AS chunk
       FROM dbo.ProductImports WHERE id = $1`,
      [job.id, from, to - 1]
    );
    const chunk = rowsResult.rows[0]?.chunk || [];
    const mapping = job.column_mapping;
    const errorRows = new Set(job.error_rows || []);

    const entries = chunk.map((row, i) => {
      const rowNumber = from + i + 2;
      const { values } = validateRow(row, mapping);
      return { rowNumber, values, keys: identityKeys(values), blocked: errorRows.has(rowNumber) };
    });
    const existing = await findExisting(client, companyId, entries.filter((e) => !e.blocked));

    // Verbruik opnieuw tellen ná de lock: een gelijktijdige chunk kan intussen
    // producten hebben aangemaakt.
    let capacity = Infinity;
    if (usage.products.max != null) {
      const used = await client.query(
        "SELECT COUNT(*) AS n FROM dbo.Products WHERE company_id = $1 AND status <> 'archived'",
        [companyId]
      );
      capacity = Math.max(0, usage.products.max - used.rows[0].n);
    }
    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const newErrors = [];
    const newErrorRows = [];

    for (const entry of entries) {
      if (entry.blocked) {
        counts.errors += 1;
        continue;
      }
      const existingId =
        (entry.keys.sku && existing.bySku.get(entry.keys.sku)) || (entry.keys.gtin && existing.byGtin.get(entry.keys.gtin)) || null;
      let action = "create";
      if (existingId) {
        action = job.duplicate_strategy === "update" ? "update" : job.duplicate_strategy === "create" ? "create" : "skip";
      }
      if (action === "skip") {
        counts.skipped += 1;
        continue;
      }
      if (action === "create" && capacity <= 0) {
        counts.errors += 1;
        newErrorRows.push(entry.rowNumber);
        newErrors.push({
          row: entry.rowNumber,
          product: entry.values.name || "",
          field: "",
          fieldLabel: "",
          severity: "error",
          message: "Productlimiet van het abonnement bereikt; niet aangemaakt",
          suggestion: "Upgrade het abonnement of archiveer producten en importeer deze rijen opnieuw"
        });
        continue;
      }

      await client.query("SAVEPOINT import_row");
      try {
        if (action === "update") {
          await updateProductRow(client, job, existingId, entry.values);
          counts.updated += 1;
        } else {
          const id = await createProductRow(client, job, entry.values);
          capacity -= 1;
          counts.created += 1;
          // Volgende rijen in dezelfde chunk met dezelfde sleutel zien dit product.
          if (entry.keys.sku) existing.bySku.set(entry.keys.sku, id);
          if (entry.keys.gtin) existing.byGtin.set(entry.keys.gtin, id);
        }
        await client.query("RELEASE SAVEPOINT import_row");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT import_row");
        counts.errors += 1;
        newErrorRows.push(entry.rowNumber);
        newErrors.push({
          row: entry.rowNumber,
          product: entry.values.name || "",
          field: "",
          fieldLabel: "",
          severity: "error",
          message: "Opslaan mislukt",
          suggestion: "Controleer de waarden in deze rij en probeer het opnieuw"
        });
        console.error(`Import ${job.id} rij ${entry.rowNumber} mislukt:`, error.message);
      }
    }

    const finished = to >= job.total_rows;
    const storedRoom = Math.max(0, 5000 - (job.stored_errors || 0));
    await client.query(
      `UPDATE dbo.ProductImports
       SET processed_rows = $2, current_chunk = current_chunk + 1,
           created_count = created_count + $3, updated_count = updated_count + $4,
           skipped_count = skipped_count + $5, error_count = error_count + $6,
           success_count = success_count + $3 + $4,
           errors = errors || $7::jsonb, error_rows = error_rows || $8::int[],
           status = CASE WHEN $9 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN $9 THEN now() ELSE completed_at END,
           rows = CASE WHEN $9 THEN NULL ELSE rows END,
           updated_at = now()
       WHERE id = $1`,
      [job.id, to, counts.created, counts.updated, counts.skipped, counts.errors,
        JSON.stringify(newErrors.slice(0, storedRoom)), newErrorRows, finished]
    );
    await client.query("COMMIT");
    if (finished) completedJob = job;
    return { done: finished };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    if (completedJob) {
      await logAudit({
        companyId: completedJob.company_id,
        userId: completedJob.created_by,
        action: "import",
        entityType: "ProductImport",
        entityId: completedJob.id
      });
    }
  }
}

module.exports = { runImportChunk };
