require("dotenv").config();
const { Pool, types } = require("pg");

// Supabase Postgres via DATABASE_URL. Op Vercel altijd de Supavisor-pooler in
// transaction mode (poort 6543): elke serverless-instance houdt maar een paar
// verbindingen open, de pooler deelt ze. Lokaal/scripts mag ook de directe
// verbinding (poort 5432).
//
// Typeparsers: Postgres levert COUNT/SUM (int8) en DECIMAL (numeric) als string
// aan Node - de code en de frontend rekenen overal met getallen, dus die worden
// hier centraal teruggezet. DATE wordt (net als voorheen bij mssql) een Date op
// UTC-middernacht, onafhankelijk van de tijdzone van de server.
types.setTypeParser(20, (value) => parseInt(value, 10));
types.setTypeParser(1700, (value) => parseFloat(value));
types.setTypeParser(1082, (value) => new Date(`${value}T00:00:00Z`));

function isLocalDatabase(connectionString) {
  return /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString);
}

// sslmode in de URL wordt door pg-connection-string als verify-full behandeld en
// zou de expliciete ssl-instelling hieronder overschrijven; daarom eruit halen.
function stripSslMode(connectionString) {
  return connectionString.replace(/([?&])sslmode=[^&]*&?/i, "$1").replace(/[?&]$/, "");
}

function buildPoolConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL ontbreekt (Supabase → Project Settings → Database → Connection string).");
  }
  const connectionString = stripSslMode(raw);

  let ssl;
  if (isLocalDatabase(connectionString)) {
    ssl = false;
  } else if (process.env.DATABASE_CA_CERT) {
    // Supabase → Database → SSL Configuration → "Download certificate". In een
    // env-var mogen de regeleinden als \n geschreven zijn.
    ssl = { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  } else {
    ssl = { rejectUnauthorized: false };
  }

  return {
    connectionString,
    ssl,
    max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000
  };
}

let pgPool;

function getPgPool() {
  if (!pgPool) {
    pgPool = new Pool(buildPoolConfig());
    // Een verbroken idle-verbinding geeft een 'error'-event op de pool; zonder
    // listener crasht Node het hele proces. De pool vervangt de verbinding zelf.
    pgPool.on("error", (err) => {
      console.error("Postgres-pool-fout (verbinding wordt vervangen):", err.message);
    });
    if (process.env.VERCEL) {
      // Fluid compute: sluit idle verbindingen netjes af voordat een instance
      // bevriest, zodat de pooler geen zwevende verbindingen opstapelt.
      try {
        require("@vercel/functions").attachDatabasePool(pgPool);
      } catch {
        // Oudere @vercel/functions zonder attachDatabasePool: idleTimeout vangt het op.
      }
    }
  }
  return pgPool;
}

// --- compatibiliteitslaag --------------------------------------------------------
// De repositories gebruiken het request().input(naam, type, waarde).query(sql)-patroon
// met @naam-parameters. Deze laag vertaalt dat naar Postgres ($1, $2, ...) en geeft
// { recordset, rowsAffected } terug, zodat de queries zelf leesbaar blijven. Het
// type-argument is alleen documentatie: Postgres leidt het type af uit de kolom.

const PARAM_PATTERN = /@([A-Za-z_][A-Za-z0-9_]*)/g;

function toPositional(text, inputs) {
  const values = [];
  const positionByName = new Map();
  const converted = text.replace(PARAM_PATTERN, (match, name) => {
    if (!inputs.has(name)) return match;
    if (!positionByName.has(name)) {
      values.push(inputs.get(name));
      positionByName.set(name, values.length);
    }
    return `$${positionByName.get(name)}`;
  });
  return { text: converted, values };
}

class Request {
  constructor(executor) {
    this.executor = executor;
    this.inputs = new Map();
  }

  input(name, typeOrValue, value) {
    this.inputs.set(name, arguments.length >= 3 ? value : typeOrValue);
    return this;
  }

  async query(text) {
    const { text: positional, values } = toPositional(text, this.inputs);
    const result = await this.executor.query(positional, values);
    // Meerdere statements zonder parameters geven een array terug; de laatste telt.
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    return { recordset: last.rows, rowsAffected: [last.rowCount ?? 0] };
  }
}

class Transaction {
  constructor(pool) {
    this.pool = pool;
    this.client = null;
  }

  async begin() {
    this.client = await this.pool.connect();
    await this.client.query("BEGIN");
  }

  async commit() {
    try {
      await this.client.query("COMMIT");
    } finally {
      this.release();
    }
  }

  async rollback() {
    if (!this.client) return;
    try {
      await this.client.query("ROLLBACK");
    } finally {
      this.release();
    }
  }

  release() {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
  }

  query(text, values) {
    return this.client.query(text, values);
  }
}

const poolFacade = {
  request: () => new Request(getPgPool()),
  connect: () => getPgPool().connect(),
  query: (text, values) => getPgPool().query(text, values),
  get pg() {
    return getPgPool();
  }
};

async function getPool() {
  return poolFacade;
}

async function close() {
  if (pgPool) {
    const pool = pgPool;
    pgPool = undefined;
    await pool.end();
  }
}

// sql.Int, sql.NVarChar(200), sql.MAX, ... zijn no-ops (zie hierboven); alleen
// Request, Transaction en close hebben echte betekenis.
const typeStub = () => typeStub;
const sql = new Proxy(
  { Request, Transaction, close },
  { get: (target, prop) => (prop in target ? target[prop] : typeStub) }
);

module.exports = { getPool, sql, close };
