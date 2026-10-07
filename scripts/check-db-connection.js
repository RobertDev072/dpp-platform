const { queryOne, closePool } = require("../src/config/db");

async function testConnection() {
  try {
    const row = await queryOne("SELECT current_database() AS database_name, now() AS server_time, version() AS version");
    console.log("✅ Verbonden met Postgres (Supabase)!");
    console.log(row);
  } catch (error) {
    console.error("❌ Databaseverbinding mislukt:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

testConnection();
