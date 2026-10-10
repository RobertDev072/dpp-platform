// Vergelijkt twee PostgreSQL-databases (bron = huidige productie, doel = RDS) na
// pg_dump/pg_restore: per tabel in schema dbo het aantal rijen én een checksum over de
// volledige inhoud (md5 over de rijen in primaire-sleutelvolgorde). Leest alleen;
// schrijft niets. Uitvoer is een tabel die als bewijs bij de migratie-checklist hoort.
//
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/verify-db-copy.js
//
// TLS: zet SOURCE_DATABASE_CA_FILE / TARGET_DATABASE_CA_FILE voor certificaatcontrole
// (voor RDS: de AWS RDS CA-bundel).
const fs = require("fs");
const { Client } = require("pg");

function clientFor(prefix) {
  const url = process.env[`${prefix}_DATABASE_URL`];
  if (!url) throw new Error(`${prefix}_DATABASE_URL ontbreekt`);
  const caFile = process.env[`${prefix}_DATABASE_CA_FILE`];
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Client({
    connectionString: url.replace(/([?&])sslmode=[^&]*&?/i, "$1").replace(/[?&]$/, ""),
    ssl: local ? false : caFile ? { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: true }
  });
}

async function tableStats(client) {
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'dbo' ORDER BY tablename"
  );
  const stats = new Map();
  for (const { tablename } of tables.rows) {
    const count = await client.query(`SELECT COUNT(*)::bigint AS n FROM dbo."${tablename}"`);
    const checksum = await client.query(
      `SELECT md5(COALESCE(string_agg(md5(t::text), '' ORDER BY t::text), '')) AS sum FROM dbo."${tablename}" t`
    );
    stats.set(tablename, { rows: Number(count.rows[0].n), checksum: checksum.rows[0].sum });
  }
  return stats;
}

async function main() {
  const source = clientFor("SOURCE");
  const target = clientFor("TARGET");
  await source.connect();
  await target.connect();
  try {
    // Zelfde tekstweergave van tijdstempels aan beide kanten, anders verschillen de
    // checksums puur door een andere sessie-tijdzone.
    for (const client of [source, target]) {
      await client.query("SET TIME ZONE 'UTC'; SET DateStyle = 'ISO, YMD'; SET extra_float_digits = 3");
    }
    const [a, b] = [await tableStats(source), await tableStats(target)];
    const names = [...new Set([...a.keys(), ...b.keys()])].sort();
    let mismatches = 0;
    console.log("tabel | rijen bron | rijen doel | checksum gelijk");
    for (const name of names) {
      const s = a.get(name);
      const t = b.get(name);
      const equal = Boolean(s && t && s.rows === t.rows && s.checksum === t.checksum);
      if (!equal) mismatches += 1;
      console.log(`${name} | ${s ? s.rows : "-"} | ${t ? t.rows : "-"} | ${equal ? "ja" : "NEE"}`);
    }
    console.log(mismatches ? `\n${mismatches} tabel(len) wijken af.` : "\nAlle tabellen identiek.");
    if (mismatches) process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error("Vergelijken mislukt:", error.message);
  process.exitCode = 1;
});
