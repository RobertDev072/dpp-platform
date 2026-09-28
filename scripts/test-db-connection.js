const { getPool, sql } = require("../src/config/db");

async function testConnection() {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS databaseName,
        GETDATE() AS serverTime
    `);

    console.log("✅ Verbonden met Azure SQL!");
    console.log(result.recordset);
  } catch (error) {
    console.error("❌ Databaseverbinding mislukt:");
    console.error(error.message);
  } finally {
    await sql.close();
  }
}

testConnection();
