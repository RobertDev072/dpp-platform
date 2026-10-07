// EENMALIGE datamigratie Azure -> Supabase. Kopieert:
//   1. alle tabellen uit Azure SQL naar Supabase Postgres (zelfde id's, zelfde
//      public_id's - gedrukte QR-codes blijven dus naar hetzelfde product wijzen);
//   2. alle bestanden uit de Azure Blob-containers naar de Supabase Storage-buckets
//      (zelfde objectnamen, dus photo_blob_name/blob_name kloppen zonder aanpassing);
//   3. en controleert daarna aantallen + of elk verwezen bestand echt is overgekomen.
//
// Voorbereiding (zie docs/migratie-azure-naar-vercel-supabase.md):
//   - Supabase-schema staat er al:   npm run migrate
//   - Azure-pakketten alleen tijdelijk, niet in package.json:
//       npm install --no-save mssql @azure/storage-blob @azure/identity
//   - `az login` (voor Blob Storage via DefaultAzureCredential), of
//     AZURE_STORAGE_CONNECTION_STRING zetten.
//   - In .env naast DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY:
//       AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, AZURE_SQL_PASSWORD,
//       AZURE_STORAGE_ACCOUNT_NAME
//
// Gebruik:
//   node scripts/migrate-from-azure.js            -> database + bestanden
//   node scripts/migrate-from-azure.js --db-only
//   node scripts/migrate-from-azure.js --files-only
//
// Veiligheid: weigert de database te vullen als dbo.users in Supabase al rijen
// heeft (nooit per ongeluk dubbel/over bestaande data heen). De database-stap is
// één transactie: lukt iets niet, dan blijft Supabase leeg. Bestanden mogen opnieuw
// (upsert), dus een afgebroken bestandsstap kun je gewoon herhalen.
require("dotenv").config();
const { getPool, close } = require("../src/config/db");
const { createClient } = require("@supabase/supabase-js");

// Volgorde respecteert de foreign keys. Sessions worden bewust niet gekopieerd:
// iedereen logt na de overstap gewoon opnieuw in.
const TABLES = [
  "Plans",
  "Companies",
  "Users",
  "CompanyAdminInvites",
  "Products",
  "Documents",
  "ProductParts",
  "ProductSustainability",
  "ProductCompliance",
  "ProductBatches",
  "ScanEvents",
  "AuditLogs",
  "SystemMetricsSnapshots",
  "SystemRequestMetricsHourly"
];

const PAGE_SIZE = 2000;
const INSERT_CHUNK = 500;

const CONTAINERS = [
  { azure: process.env.AZURE_STORAGE_IMAGES_CONTAINER || "product-images", bucket: process.env.SUPABASE_STORAGE_IMAGES_BUCKET || "product-images" },
  { azure: process.env.AZURE_STORAGE_DOCUMENTS_CONTAINER || "product-documents", bucket: process.env.SUPABASE_STORAGE_DOCUMENTS_BUCKET || "product-documents" }
];

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Ontbrekende env vars: ${missing.join(", ")}`);
}

function requireOptional(name) {
  try {
    return require(name);
  } catch {
    throw new Error(`Pakket "${name}" ontbreekt. Draai eerst: npm install --no-save mssql @azure/storage-blob @azure/identity`);
  }
}

async function connectAzureSql() {
  requireEnv(["AZURE_SQL_SERVER", "AZURE_SQL_DATABASE", "AZURE_SQL_USER", "AZURE_SQL_PASSWORD"]);
  const mssql = requireOptional("mssql");
  return mssql.connect({
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false },
    // Serverless Azure SQL kan gepauzeerd zijn en moet eerst ontwaken.
    connectionTimeout: 60000,
    requestTimeout: 120000
  });
}

async function targetColumns(client, table) {
  const result = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = $1",
    [table.toLowerCase()]
  );
  return new Set(result.rows.map((r) => r.column_name));
}

function normalizeValue(value) {
  // mssql levert BIGINT als string; Postgres accepteert dat als tekst prima. Datums
  // komen als Date (UTC) binnen en gaan als timestamptz weer weg.
  return value === undefined ? null : value;
}

async function insertRows(client, table, columns, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const values = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(normalizeValue(row[column]));
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO dbo.${table.toLowerCase()} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`,
      values
    );
  }
}

async function copyTable(azure, client, table) {
  const wanted = await targetColumns(client, table);
  let offset = 0;
  let copied = 0;
  let columns = null;
  const deferredPartners = [];

  for (;;) {
    const page = await azure
      .request()
      .query(`SELECT * FROM dbo.${table} ORDER BY 1 OFFSET ${offset} ROWS FETCH NEXT ${PAGE_SIZE} ROWS ONLY`);
    const rows = page.recordset.map((row) => {
      const lower = {};
      for (const [key, value] of Object.entries(row)) lower[key.toLowerCase()] = value;
      return lower;
    });
    if (!rows.length) break;

    if (!columns) {
      columns = Object.keys(rows[0]).filter((c) => wanted.has(c));
    }

    // Companies verwijst naar zichzelf (partner_id): eerst zonder, daarna bijwerken.
    if (table === "Companies") {
      for (const row of rows) {
        if (row.partner_id != null) deferredPartners.push({ id: row.id, partnerId: row.partner_id });
        row.partner_id = null;
      }
    }

    await insertRows(client, table, columns, rows);
    copied += rows.length;
    offset += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

  for (const { id, partnerId } of deferredPartners) {
    await client.query("UPDATE dbo.companies SET partner_id = $1 WHERE id = $2", [partnerId, id]);
  }

  // Identity-teller voorbij het hoogste gekopieerde id zetten, anders botst de
  // eerstvolgende INSERT met een bestaand id.
  if (wanted.has("id")) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('dbo.${table.toLowerCase()}', 'id'),
                     COALESCE((SELECT MAX(id) FROM dbo.${table.toLowerCase()}), 0) + 1, false)`
    );
  }

  return copied;
}

async function migrateDatabase() {
  requireEnv(["DATABASE_URL"]);
  const pool = await getPool();

  const existing = await pool.query("SELECT COUNT(*) AS n FROM dbo.users");
  if (existing.rows[0].n > 0) {
    throw new Error("dbo.users in Supabase is niet leeg - migratie afgebroken om bestaande data te beschermen.");
  }

  const azure = await connectAzureSql();
  const client = await pool.connect();
  const report = [];
  try {
    await client.query("BEGIN");
    for (const table of TABLES) {
      const sourceCount = (await azure.request().query(`SELECT COUNT(*) AS n FROM dbo.${table}`)).recordset[0].n;
      const copied = await copyTable(azure, client, table);
      const targetCount = (await client.query(`SELECT COUNT(*) AS n FROM dbo.${table.toLowerCase()}`)).rows[0].n;
      report.push({ tabel: table, azure: sourceCount, gekopieerd: copied, supabase: targetCount, ok: sourceCount === targetCount ? "✔" : "✘" });
      console.log(`  ${table}: ${copied} rij(en)`);
    }
    if (report.some((r) => r.ok !== "✔")) {
      throw new Error("Aantallen komen niet overeen (zie tabel hieronder) - alles teruggedraaid.");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.table(report);
    throw error;
  } finally {
    client.release();
    await azure.close();
  }
  console.table(report);

  // Steekproef op de QR-sleutel: public_id's moeten 1-op-1 overgekomen zijn.
  const published = await pool.query("SELECT COUNT(*) AS n FROM dbo.products WHERE public_id IS NOT NULL");
  console.log(`✅ Database gemigreerd. Producten met QR-sleutel (public_id): ${published.rows[0].n}`);
}

function azureBlobClient() {
  const { BlobServiceClient } = requireOptional("@azure/storage-blob");
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  requireEnv(["AZURE_STORAGE_ACCOUNT_NAME"]);
  const { DefaultAzureCredential } = requireOptional("@azure/identity");
  return new BlobServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

async function migrateFiles() {
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const blobService = azureBlobClient();

  for (const { azure, bucket } of CONTAINERS) {
    const container = blobService.getContainerClient(azure);
    let copied = 0;
    let failed = 0;
    for await (const blob of container.listBlobsFlat()) {
      try {
        const buffer = await container.getBlobClient(blob.name).downloadToBuffer();
        const { error } = await supabase.storage.from(bucket).upload(blob.name, buffer, {
          contentType: blob.properties.contentType || "application/octet-stream",
          upsert: true
        });
        if (error) throw new Error(error.message);
        copied += 1;
        if (copied % 50 === 0) console.log(`  ${azure}: ${copied} bestand(en)...`);
      } catch (error) {
        failed += 1;
        console.error(`  ✘ ${azure}/${blob.name}: ${error.message}`);
      }
    }
    console.log(`  ${azure} -> ${bucket}: ${copied} gekopieerd, ${failed} mislukt`);
  }
}

// Elk bestand waar de database naar verwijst moet in Supabase Storage staan,
// anders breekt een foto/document op een (gedrukt) productpaspoort.
async function verifyReferencedFiles() {
  const pool = await getPool();
  const [images, documents] = CONTAINERS.map((c) => c.bucket);
  const result = await pool.query(
    `
    SELECT r.bucket, r.name, r.ref
    FROM (
      SELECT $1::text AS bucket, p.photo_blob_name AS name, 'product ' || p.id AS ref
      FROM dbo.products p WHERE p.photo_blob_name IS NOT NULL
      UNION ALL
      SELECT $2::text, d.blob_name, 'document ' || d.id
      FROM dbo.documents d WHERE d.blob_name IS NOT NULL
    ) r
    LEFT JOIN storage.objects o ON o.bucket_id = r.bucket AND o.name = r.name
    WHERE o.id IS NULL
  `,
    [images, documents]
  );
  const missing = result.rows;
  if (missing.length) {
    console.error(`✘ ${missing.length} verwezen bestand(en) ontbreken in Supabase Storage:`);
    console.table(missing);
    process.exitCode = 1;
  } else {
    console.log("✅ Alle bestanden waar producten/documenten naar verwijzen staan in Supabase Storage.");
  }
}

async function run() {
  const dbOnly = process.argv.includes("--db-only");
  const filesOnly = process.argv.includes("--files-only");

  if (!filesOnly) {
    console.log("1/3 Database kopiëren (Azure SQL -> Supabase Postgres)...");
    await migrateDatabase();
  }
  if (!dbOnly) {
    console.log("2/3 Bestanden kopiëren (Azure Blob -> Supabase Storage)...");
    await migrateFiles();
  }
  console.log("3/3 Controle verwezen bestanden...");
  await verifyReferencedFiles();
}

run()
  .then(() => close())
  .catch(async (error) => {
    console.error("❌ Migratie mislukt:", error.message);
    await close();
    process.exit(1);
  });
