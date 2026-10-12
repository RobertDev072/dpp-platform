// Voert de PostgreSQL-migraties uit db/migrations uit (zie src/db/migrator.js).
//   npm run migrate      (tegen DATABASE_URL uit .env of de omgeving)
const { runMigrations } = require("../src/db/migrator");
const { close } = require("../src/config/db");

runMigrations({ log: (line) => console.log(line) })
  .then(async () => {
    console.log("Alle migraties zijn bijgewerkt.");
    await close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Migratie mislukt:");
    console.error(error.message);
    await close();
    process.exit(1);
  });
