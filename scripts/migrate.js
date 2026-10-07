const fs = require("fs");
const path = require("path");
const { getPool, closePool } = require("../src/config/db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Ook deze tabel hoort niet via de Supabase REST-API leesbaar te zijn.
  await pool.query("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY");
}

async function getAppliedMigrations(pool) {
  const result = await pool.query("SELECT filename FROM schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
}

async function runMigrations() {
  const pool = getPool();
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`↷ overslaan (al toegepast): ${file}`);
      continue;
    }

    const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // Postgres kent transactionele DDL: een halve migratie bestaat niet.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migrationSql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✅ toegepast: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migratie mislukt (${file}): ${error.message}`);
    } finally {
      client.release();
    }
  }
}

runMigrations()
  .then(async () => {
    console.log("Alle migraties zijn bijgewerkt.");
    await closePool();
  })
  .catch(async (error) => {
    console.error("❌ Migratie mislukt:");
    console.error(error.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
