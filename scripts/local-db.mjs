// Lokale ontwikkeldatabase: echte PostgreSQL 17 (officiële binaries via het npm-pakket
// embedded-postgres), zonder installatie of Docker. Data blijft bewaard in .localdb/
// (staat in .gitignore). Laat dit venster open zolang je ontwikkelt; stoppen met Ctrl+C.
//
//   npm run db:local      (in een eigen terminal)
//   npm run migrate       (eenmalig of na nieuwe migraties)
//   npm run seed:owner    (eenmalig: Platform Owner uit SYSTEM_OWNER_* in .env)
//   npm run dev
//
// Verbinding: postgresql://postgres:postgres@127.0.0.1:5433/veripasso
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".localdb");
const port = Number(process.env.LOCAL_DB_PORT) || 5433;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"]
});

if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Eerste start: lokale database aanmaken in .localdb/ ...");
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient();
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'veripasso'");
if (!exists.rowCount) {
  await client.query("CREATE DATABASE veripasso");
  console.log("Database 'veripasso' aangemaakt. Voer nu `npm run migrate` en `npm run seed:owner` uit.");
}
await client.end();

console.log(`Lokale PostgreSQL 17 draait: postgresql://postgres:postgres@127.0.0.1:${port}/veripasso`);
console.log("Stoppen: Ctrl+C");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
