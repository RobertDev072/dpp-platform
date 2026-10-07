require("dotenv").config();
const { Pool, types } = require("pg");

// Typeconversies zodat de API exact dezelfde JSON blijft geven als onder Azure SQL
// (mssql gaf getallen terug, pg standaard strings voor 64-bit/decimal):
// - BIGINT (COUNT(*), SUM(...)) -> number. Onze tellingen/bytes blijven ruim onder
//   Number.MAX_SAFE_INTEGER (9 PB).
// - NUMERIC (co2_footprint_kg e.d.) -> number.
// - DATE (license_start/-end, production_date) -> Date op UTC-middernacht, net als
//   mssql deed. pg's standaard (lokale middernacht) zou datums een dag laten
//   verschuiven op machines die niet in UTC draaien.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
types.setTypeParser(1082, (value) => (value === null ? null : new Date(`${value}T00:00:00Z`)));

// Supabase vereist TLS. Standaard wordt het servercertificaat niet tegen een CA
// gecontroleerd (wel versleuteld); zet DATABASE_SSL_CA (de inhoud van het
// "SSL certificate" uit Supabase → Project Settings → Database) voor volledige
// verificatie. DATABASE_SSL=false alleen voor een lokale Postgres zonder TLS.
function sslConfig() {
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.DATABASE_SSL_CA) {
    return { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

let pool;

// Eén pool per (serverless) instance. Op Vercel loopt DATABASE_URL via de
// Supabase-pooler (Supavisor, transaction mode, poort 6543): die deelt een klein
// aantal echte Postgres-verbindingen over alle function-instances, dus per instance
// houden we de pool bewust klein en laten we ongebruikte verbindingen snel los.
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL ontbreekt (Supabase → Project Settings → Database → Connection string).");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      // Voorkomt dat één hangende query een function tot de Vercel-timeout vasthoudt.
      // Client-side (query_timeout) i.p.v. statement_timeout: de Supabase-pooler in
      // transaction mode accepteert geen willekeurige startup-parameters.
      query_timeout: 30000
    });
    // Een verbroken idle-verbinding (pooler-herstart, netwerk) geeft een 'error'-event
    // op de pool. Zonder listener crasht Node het hele proces; met listener ruimt pg
    // de kapotte client op en maakt de volgende query gewoon een nieuwe.
    pool.on("error", (err) => {
      console.error("Postgres-pool-fout (verbinding verbroken, wordt vanzelf hersteld):", err.message);
    });
  }
  return pool;
}

// Geparametriseerde query ($1, $2, ...). Geeft het volledige pg-resultaat terug
// (rows, rowCount).
async function query(text, params = []) {
  return getPool().query(text, params);
}

// Handige varianten voor de repositories.
async function queryRows(text, params) {
  return (await query(text, params)).rows;
}

async function queryOne(text, params) {
  return (await query(text, params)).rows[0] || null;
}

// Voert fn(client) uit binnen één transactie; rollback bij elke fout.
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

module.exports = { getPool, query, queryRows, queryOne, withTransaction, closePool };
