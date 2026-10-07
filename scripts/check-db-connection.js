const { getPool, close } = require("../src/config/db");

async function testConnection() {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT current_database() AS "databaseName",
             now() AS "serverTime",
             version() AS "version"
    `);

    console.log("✅ Verbonden met Supabase Postgres!");
    console.log(result.recordset);
  } catch (error) {
    console.error("❌ Databaseverbinding mislukt:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

testConnection();
