const fs = require("fs");
const path = require("path");
const { getPool, sql } = require("../src/config/db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function ensureMigrationsTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.SchemaMigrations', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SchemaMigrations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename NVARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.request().query("SELECT filename FROM dbo.SchemaMigrations");
  return new Set(result.recordset.map((row) => row.filename));
}

async function runMigrations() {
  const pool = await getPool();
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

    const filePath = path.join(MIGRATIONS_DIR, file);
    const migrationSql = fs.readFileSync(filePath, "utf8");

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await new sql.Request(transaction).batch(migrationSql);
      await new sql.Request(transaction)
        .input("filename", sql.NVarChar(255), file)
        .query("INSERT INTO dbo.SchemaMigrations (filename) VALUES (@filename)");

      await transaction.commit();
      console.log(`✅ toegepast: ${file}`);
    } catch (error) {
      await transaction.rollback();
      throw new Error(`Migratie mislukt (${file}): ${error.message}`);
    }
  }
}

runMigrations()
  .then(() => {
    console.log("Alle migraties zijn bijgewerkt.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Migratie mislukt:");
    console.error(error.message);
    process.exit(1);
  });
