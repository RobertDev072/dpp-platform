// Legt voor alle gepubliceerde/gearchiveerde paspoorten zonder versie een basisversie
// vast (EN 18221 §4.2) en controleert daarna steekproefsgewijs de hash-keten.
// Normaal doet het dagelijkse onderhoud dit zelf.
//
//   npm run backfill:versions            (tegen DATABASE_URL)
const { backfillInitialVersions } = require("../src/services/passportArchive.service");
const { close } = require("../src/config/db");

async function main() {
  let total = 0;
  for (;;) {
    const created = await backfillInitialVersions({ limit: 500 });
    total += created;
    console.log(`Basisversies vastgelegd: ${created} (totaal ${total})`);
    if (created < 500) break;
  }
  console.log("Klaar.");
}

main()
  .catch((error) => {
    console.error("Backfill mislukt:", error.message);
    process.exitCode = 1;
  })
  .finally(() => close());
