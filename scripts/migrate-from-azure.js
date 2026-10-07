// EENMALIGE migratie van de live Azure-omgeving naar Supabase:
//   1. db    - alle tabellen uit Azure SQL naar Supabase Postgres (ids blijven gelijk,
//              dus ook alle public_id's in geprinte QR-codes);
//   2. blobs - alle bestanden uit Azure Blob Storage naar de privé Supabase-buckets
//              (zelfde objectnamen, dus de verwijzingen in de database kloppen);
//   3. auth  - een Supabase Auth-account voor elke (voormalige) Entra-gebruiker.
//              Entra kan geen wachtwoorden exporteren: iedereen krijgt een nieuw,
//              tijdelijk wachtwoord en moet bij de eerste login een eigen wachtwoord
//              kiezen (must_change_password). De tijdelijke wachtwoorden komen in een
//              CSV in migration-output/ (staat in .gitignore - behandel als geheim!).
//   4. verificatie - aantallen per tabel, alle QR-public_id's, bestanden.
//
// Vereist (alleen lokaal in .env, tijdens de migratie):
//   AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, AZURE_SQL_PASSWORD
//   AZURE_STORAGE_ACCOUNT_NAME (+ `az login` met leesrechten op de containers), of
//   AZURE_STORAGE_CONNECTION_STRING
//   DATABASE_URL (Supabase, bij voorkeur de directe/sessie-verbinding, poort 5432)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// De dev-dependencies mssql, @azure/storage-blob en @azure/identity zijn alleen
// hiervoor nodig en kunnen na de migratie uit package.json.
//
// Gebruik:
//   node scripts/migrate-from-azure.js --dry-run            alleen tellen, niets schrijven
//   node scripts/migrate-from-azure.js                      alles (db, blobs, auth, verify)
//   node scripts/migrate-from-azure.js --only=blobs,verify  losse stappen (herhaalbaar)
//   --auth-mode=reset   geen tijdelijke wachtwoorden; gebruikers kiezen zelf een
//                       wachtwoord via "Wachtwoord vergeten" (vereist werkende SMTP)
//
// De db-stap weigert te draaien als de doeltabellen al data bevatten (geen dubbele
// import); blobs en auth zijn veilig herhaalbaar.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getPool, closePool } = require("../src/config/db");
const { isSupabaseConfigured, getSupabaseAdmin, IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../src/config/supabase");
const { generateTempPassword } = require("../src/utils/tempPassword");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only="));
const STEPS = onlyArg ? onlyArg.slice(7).split(",") : ["db", "blobs", "auth", "verify"];
const AUTH_MODE = (args.find((a) => a.startsWith("--auth-mode=")) || "--auth-mode=temp").slice(12);

const AZURE_CONTAINERS = {
  [process.env.AZURE_STORAGE_IMAGES_CONTAINER || "product-images"]: IMAGES_BUCKET,
  [process.env.AZURE_STORAGE_DOCUMENTS_CONTAINER || "product-documents"]: DOCUMENTS_BUCKET
};

// Tabellen in FK-volgorde. columns = kolommen in Postgres; bron = Azure SQL-tabel.
// Sessies worden bewust NIET gemigreerd: iedereen logt na de overstap opnieuw in.
const TABLES = [
  {
    target: "plans",
    source: "dbo.Plans",
    columns: ["id", "name", "max_users", "max_products", "feature_flags", "partner_assignable", "created_at", "updated_at"]
  },
  {
    target: "companies",
    source: "dbo.Companies",
    columns: [
      "id", "name", "slug", "status", "plan_id", "logo", "kind", "partner_id",
      "license_start", "license_end", "created_at", "updated_at"
    ],
    // Zelfverwijzing (partner_id): eerst zonder, daarna bijwerken.
    deferColumns: ["partner_id"]
  },
  {
    target: "users",
    source: "dbo.Users",
    columns: [
      "id", "company_id", "email", "password_hash", "first_name", "last_name", "role", "status",
      "must_change_password", "created_at", "updated_at"
    ]
  },
  {
    target: "products",
    source: "dbo.Products",
    columns: [
      "id", "company_id", "name", "brand", "model", "sku", "gtin", "category_id", "category_label",
      "description", "manufacturer", "country_of_origin", "photo_url", "photo_blob_name", "status",
      "highlights", "public_id", "published_at", "created_by", "created_at", "updated_at"
    ]
  },
  {
    target: "documents",
    source: "dbo.Documents",
    columns: [
      "id", "company_id", "product_id", "type", "title", "language", "storage_url", "blob_name",
      "file_size", "mime_type", "is_public", "category", "created_at"
    ]
  },
  { target: "scan_events", source: "dbo.ScanEvents", columns: ["id", "product_id", "scanned_at", "user_agent", "referrer"] },
  {
    target: "audit_logs",
    source: "dbo.AuditLogs",
    columns: [
      "id", "company_id", "user_id", "impersonator_user_id", "action", "entity_type", "entity_id",
      "timestamp", "metadata"
    ]
  },
  {
    target: "company_admin_invites",
    source: "dbo.CompanyAdminInvites",
    columns: [
      "id", "company_id", "email", "first_name", "last_name", "token_hash", "status", "invited_by",
      "expires_at", "accepted_at", "created_at"
    ]
  },
  {
    target: "product_parts",
    source: "dbo.ProductParts",
    columns: ["id", "product_id", "company_id", "part_number", "name", "description", "image_url", "created_at"]
  },
  {
    target: "product_sustainability",
    source: "dbo.ProductSustainability",
    columns: [
      "product_id", "co2_footprint_kg", "co2_reduction_pct", "recycled_material_pct", "materials",
      "epd_url", "recyclable", "reach_conform", "rohs_conform", "expected_lifespan_years", "updated_at"
    ],
    noIdSequence: true
  },
  {
    target: "product_compliance",
    source: "dbo.ProductCompliance",
    columns: ["product_id", "ce_marked", "applicable_regulations", "updated_at"],
    noIdSequence: true
  },
  {
    target: "product_batches",
    source: "dbo.ProductBatches",
    columns: ["id", "product_id", "company_id", "batch_number", "production_date", "quantity", "created_at"]
  },
  {
    target: "system_metrics_snapshots",
    source: "dbo.SystemMetricsSnapshots",
    columns: [
      "id", "taken_at", "database_size_bytes", "database_max_bytes", "blob_storage_bytes", "blob_count",
      "partner_count", "company_count", "user_count", "active_user_count", "product_count",
      "document_count", "audit_log_count", "scan_event_count", "invite_count", "table_stats", "blob_stats"
    ],
    optional: true
  },
  {
    target: "system_request_metrics_hourly",
    source: "dbo.SystemRequestMetricsHourly",
    columns: [
      "id", "bucket_start", "scope", "route", "method", "request_count", "error_4xx_count",
      "error_5xx_count", "duration_sum_ms", "duration_max_ms", "p50_ms", "p95_ms", "p99_ms"
    ],
    optional: true
  }
];

// DATE-kolommen als 'YYYY-MM-DD' doorgeven: mssql levert ze als Date op UTC-
// middernacht; als string kan er nooit een tijdzoneverschuiving optreden.
const DATE_COLUMNS = new Set(["license_start", "license_end", "production_date"]);

function log(...parts) {
  console.log(...parts);
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Ontbrekende env vars: ${missing.join(", ")}`);
}

let mssqlPool;
async function getMssql() {
  if (!mssqlPool) {
    requireEnv(["AZURE_SQL_SERVER", "AZURE_SQL_DATABASE", "AZURE_SQL_USER", "AZURE_SQL_PASSWORD"]);
    const sql = require("mssql");
    mssqlPool = await sql.connect({
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
  return mssqlPool;
}

async function sourceTableExists(source) {
  const pool = await getMssql();
  const result = await pool.request().query(`SELECT OBJECT_ID('${source}', 'U') AS id`);
  return result.recordset[0].id != null;
}

function convertValue(column, value) {
  if (value === undefined || value === null) return null;
  if (DATE_COLUMNS.has(column) && value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

// ------------------------------------------------------------------ stap 1: db --

async function migrateDatabase() {
  log("\n=== Stap 1: database (Azure SQL → Supabase Postgres) ===");
  const pg = getPool();
  const mssql = await getMssql();

  const nonEmpty = [];
  for (const table of TABLES) {
    const { rows } = await pg.query(`SELECT EXISTS (SELECT 1 FROM ${table.target}) AS has_rows`);
    if (rows[0].has_rows) nonEmpty.push(table.target);
  }
  if (nonEmpty.length && !DRY_RUN) {
    throw new Error(
      `Doeltabellen bevatten al data (${nonEmpty.join(", ")}). De db-stap draait alleen op een lege database ` +
        "(npm run migrate op een vers Supabase-project). Gebruik --only=blobs,auth,verify voor de overige stappen."
    );
  }

  const client = await pg.connect();
  try {
    if (!DRY_RUN) {
      await client.query("BEGIN");
      // Voormalige Entra-accounts hebben (nog) geen inlogmethode: hun Supabase-account
      // ontstaat pas in stap 3. Tot dan geldt de controle alleen voor nieuwe/gewijzigde
      // rijen (NOT VALID); stap 3 valideert hem weer volledig.
      await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_has_auth_method");
    }

    for (const table of TABLES) {
      if (!(await sourceTableExists(table.source))) {
        if (table.optional) {
          log(`↷ ${table.source} bestaat niet in de bron - overgeslagen`);
          continue;
        }
        throw new Error(`Brontabel ${table.source} ontbreekt. Draaide de Azure-database alle migraties (t/m 017)?`);
      }

      const result = await mssql.request().query(`SELECT * FROM ${table.source} ORDER BY 1`);
      const rows = result.recordset;
      log(`• ${table.source} → ${table.target}: ${rows.length} rij(en)`);
      if (DRY_RUN || rows.length === 0) continue;

      const insertColumns = table.columns.filter((c) => !(table.deferColumns || []).includes(c));
      const chunkSize = Math.max(1, Math.floor(5000 / insertColumns.length));
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const params = [];
        const valuesSql = chunk
          .map((row) => {
            const placeholders = insertColumns.map((column) => {
              params.push(convertValue(column, row[column]));
              return `$${params.length}`;
            });
            return `(${placeholders.join(", ")})`;
          })
          .join(", ");
        await client.query(`INSERT INTO ${table.target} (${insertColumns.join(", ")}) VALUES ${valuesSql}`, params);
      }

      for (const column of table.deferColumns || []) {
        for (const row of rows.filter((r) => r[column] != null)) {
          await client.query(`UPDATE ${table.target} SET ${column} = $1 WHERE id = $2`, [row[column], row.id]);
        }
      }

      if (!table.noIdSequence) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table.target}', 'id'), GREATEST((SELECT MAX(id) FROM ${table.target}), 1))`
        );
      }
    }

    if (!DRY_RUN) {
      await client.query(`
        ALTER TABLE users ADD CONSTRAINT chk_users_has_auth_method
        CHECK (password_hash IS NOT NULL OR auth_user_id IS NOT NULL OR status = 'deleted') NOT VALID
      `);
      await client.query("COMMIT");
      log("✅ Database gemigreerd (één transactie).");
    }
  } catch (error) {
    if (!DRY_RUN) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------- stap 2: blobs --

function getBlobServiceClient() {
  const { BlobServiceClient } = require("@azure/storage-blob");
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  requireEnv(["AZURE_STORAGE_ACCOUNT_NAME"]);
  const { DefaultAzureCredential } = require("@azure/identity");
  return new BlobServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

async function migrateBlobs() {
  log("\n=== Stap 2: bestanden (Azure Blob Storage → Supabase Storage) ===");
  if (!isSupabaseConfigured()) throw new Error("Supabase niet geconfigureerd (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
  const service = getBlobServiceClient();
  const storage = getSupabaseAdmin().storage;

  for (const [containerName, bucket] of Object.entries(AZURE_CONTAINERS)) {
    const container = service.getContainerClient(containerName);
    let copied = 0;
    let skipped = 0;
    let total = 0;
    for await (const blob of container.listBlobsFlat()) {
      total += 1;
      if (DRY_RUN) continue;
      const download = await container.getBlobClient(blob.name).downloadToBuffer();
      const contentType = blob.properties.contentType || "application/octet-stream";
      const { error } = await storage.from(bucket).upload(blob.name, download, { contentType, upsert: false });
      if (error) {
        if (/exists|duplicate/i.test(error.message || "") || error.statusCode === "409") {
          skipped += 1;
          continue;
        }
        throw new Error(`Upload ${containerName}/${blob.name} → ${bucket} mislukt: ${error.message}`);
      }
      copied += 1;
    }
    log(`• ${containerName} → ${bucket}: ${total} bestand(en)${DRY_RUN ? "" : `, ${copied} gekopieerd, ${skipped} bestonden al`}`);
  }
}

// ---------------------------------------------------------------- stap 3: auth --

async function listAllAuthUsers(admin) {
  const byEmail = new Map();
  for (let page = 1; page < 1000; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Supabase-gebruikers ophalen mislukt: ${error.message}`);
    for (const u of data.users) byEmail.set(String(u.email).toLowerCase(), u);
    if (data.users.length < 1000) break;
  }
  return byEmail;
}

async function migrateAuth() {
  log("\n=== Stap 3: accounts (Entra → Supabase Auth) ===");
  if (!isSupabaseConfigured()) throw new Error("Supabase niet geconfigureerd (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
  const pg = getPool();
  const admin = getSupabaseAdmin().auth.admin;

  // Alle accounts zonder lokaal wachtwoord die nog bestaan: dat zijn de (voormalige)
  // Entra-accounts. Het Platform Owner-account (bcrypt) blijft ongewijzigd werken.
  const { rows: users } = await pg.query(`
    SELECT id, email, first_name, last_name, status, auth_user_id
    FROM users
    WHERE password_hash IS NULL AND status <> 'deleted'
    ORDER BY id
  `);
  log(`• ${users.length} account(s) zonder lokaal wachtwoord`);
  if (DRY_RUN) return;
  if (users.length === 0) {
    await pg.query("ALTER TABLE users VALIDATE CONSTRAINT chk_users_has_auth_method");
    return;
  }

  const existing = await listAllAuthUsers(admin);
  const credentials = [];

  for (const user of users) {
    const password = generateTempPassword(AUTH_MODE === "temp" ? 16 : 32);
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
    let authUser = existing.get(String(user.email).toLowerCase());

    if (authUser) {
      const { error } = await admin.updateUserById(authUser.id, { password });
      if (error) throw new Error(`Wachtwoord zetten voor ${user.email} mislukt: ${error.message}`);
    } else {
      const { data, error } = await admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName }
      });
      if (error) throw new Error(`Account aanmaken voor ${user.email} mislukt: ${error.message}`);
      authUser = data.user;
    }

    if (user.status !== "active") {
      await admin.updateUserById(authUser.id, { ban_duration: "876000h" });
    }

    await pg.query(
      `UPDATE users SET auth_user_id = $2, must_change_password = $3, updated_at = now() WHERE id = $1`,
      [user.id, authUser.id, AUTH_MODE === "temp"]
    );
    // Eventuele sessies (zou leeg moeten zijn) ongeldig maken.
    await pg.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);

    if (AUTH_MODE === "temp" && user.status === "active") {
      credentials.push({ email: user.email, password });
    }
  }

  // Nu heeft elk niet-verwijderd account een inlogmethode: controle weer volledig.
  await pg.query("ALTER TABLE users VALIDATE CONSTRAINT chk_users_has_auth_method");

  if (credentials.length) {
    const dir = path.join(__dirname, "..", "migration-output");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `tijdelijke-wachtwoorden-${new Date().toISOString().slice(0, 10)}.csv`);
    const csv = ["email;tijdelijk_wachtwoord", ...credentials.map((c) => `${c.email};${c.password}`)].join("\n");
    fs.writeFileSync(file, `${csv}\n`, { mode: 0o600 });
    log(`✅ ${users.length} account(s) gekoppeld. Tijdelijke wachtwoorden van ${credentials.length} actieve account(s):`);
    log(`   ${file}`);
    log("   Deel ze veilig (niet per gewone e-mail), en verwijder dit bestand daarna.");
  } else {
    log(`✅ ${users.length} account(s) gekoppeld.${AUTH_MODE === "reset" ? ' Gebruikers stellen zelf een wachtwoord in via "Wachtwoord vergeten".' : ""}`);
  }
}

// -------------------------------------------------------------- stap 4: verify --

async function verify() {
  log("\n=== Stap 4: verificatie ===");
  const pg = getPool();
  const mssql = await getMssql();
  let ok = true;

  for (const table of TABLES) {
    if (!(await sourceTableExists(table.source))) continue;
    const src = (await mssql.request().query(`SELECT COUNT_BIG(*) AS n FROM ${table.source}`)).recordset[0].n;
    const dst = (await pg.query(`SELECT COUNT(*) AS n FROM ${table.target}`)).rows[0].n;
    const same = Number(src) === Number(dst);
    ok = ok && same;
    log(`${same ? "✔" : "✘"} ${table.target}: bron ${src}, doel ${dst}`);
  }

  // QR-continuïteit: elke public_id uit Azure moet (hoofdletterongevoelig) bestaan,
  // bij hetzelfde product-id en met een status die het paspoort publiek toont.
  const srcIds = (
    await mssql.request().query("SELECT id, CONVERT(NVARCHAR(36), public_id) AS public_id, status FROM dbo.Products WHERE public_id IS NOT NULL")
  ).recordset;
  const dstRows = (await pg.query("SELECT id, public_id::text AS public_id, status FROM products WHERE public_id IS NOT NULL")).rows;
  const dstById = new Map(dstRows.map((r) => [r.id, r]));
  const missing = srcIds.filter((r) => {
    const d = dstById.get(r.id);
    return !d || d.public_id.toLowerCase() !== r.public_id.toLowerCase() || d.status !== r.status;
  });
  ok = ok && missing.length === 0;
  log(
    `${missing.length === 0 ? "✔" : "✘"} QR-codes: ${srcIds.length} public_id('s) in Azure, ${missing.length} ontbrekend/afwijkend in Supabase` +
      (missing.length ? ` (product-id's: ${missing.slice(0, 20).map((m) => m.id).join(", ")})` : "")
  );

  // Bestanden: elke verwijzing uit de database moet in Supabase Storage bestaan.
  if (isSupabaseConfigured()) {
    const storage = getSupabaseAdmin().storage;
    const refs = (
      await pg.query(`
        SELECT 'photo' AS kind, photo_blob_name AS name FROM products WHERE photo_blob_name IS NOT NULL
        UNION ALL
        SELECT 'document', blob_name FROM documents WHERE blob_name IS NOT NULL
      `)
    ).rows;
    let missingFiles = 0;
    for (const ref of refs) {
      const bucket = ref.kind === "photo" ? IMAGES_BUCKET : DOCUMENTS_BUCKET;
      const { data } = await storage.from(bucket).exists(ref.name);
      if (!data) {
        missingFiles += 1;
        if (missingFiles <= 20) log(`   ontbreekt: ${bucket}/${ref.name}`);
      }
    }
    ok = ok && missingFiles === 0;
    log(`${missingFiles === 0 ? "✔" : "✘"} Bestanden: ${refs.length} verwijzing(en), ${missingFiles} ontbrekend in Supabase Storage`);

    const unlinked = (
      await pg.query("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NULL AND auth_user_id IS NULL AND status <> 'deleted'")
    ).rows[0].n;
    ok = ok && unlinked === 0;
    log(`${unlinked === 0 ? "✔" : "✘"} Accounts: ${unlinked} actief/geblokkeerd account(s) zonder inlogmethode`);
  }

  log(ok ? "\n✅ Verificatie geslaagd." : "\n❌ Verificatie NIET geslaagd - zie ✘ hierboven.");
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------- main --

(async () => {
  log(`Migratie Azure → Supabase${DRY_RUN ? " (DRY RUN - er wordt niets geschreven)" : ""}; stappen: ${STEPS.join(", ")}`);
  if (STEPS.includes("db")) await migrateDatabase();
  if (STEPS.includes("blobs")) await migrateBlobs();
  if (STEPS.includes("auth")) await migrateAuth();
  if (STEPS.includes("verify") && !DRY_RUN) await verify();
})()
  .catch((error) => {
    console.error(`\n❌ Migratie gestopt: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
    if (mssqlPool) await mssqlPool.close().catch(() => {});
  });
