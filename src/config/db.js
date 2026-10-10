require("dotenv").config();
const fs = require("fs");
const { Pool, types } = require("pg");
const logger = require("../utils/logger");

// PostgreSQL (op AWS: Amazon RDS for PostgreSQL). Twee manieren van configureren:
// 1. DATABASE_URL - lokaal en voor scripts (postgres://gebruiker:wachtwoord@host/db).
// 2. DB_HOST/DB_PORT/DB_NAME/DB_USER + DB_SECRET_ARN - op AWS. Het wachtwoord wordt
//    dan bij elke nieuwe verbinding (met korte cache) uit AWS Secrets Manager gelezen.
//    Zo blijft de app werken als RDS het wachtwoord automatisch roteert; er staat
//    nooit een wachtwoord in een env-var of in de taakdefinitie.
//
// TLS: naar RDS altijd versleuteld én met certificaatcontrole tegen de CA-bundel van
// AWS (DATABASE_CA_CERT_FILE, in het Docker-image meegeleverd). Zonder CA-bestand
// alleen lokaal (localhost) zonder TLS.
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

function readCaCertificate() {
  if (process.env.DATABASE_CA_CERT_FILE) {
    return fs.readFileSync(process.env.DATABASE_CA_CERT_FILE, "utf8");
  }
  if (process.env.DATABASE_CA_CERT) {
    // In een env-var mogen de regeleinden als \n geschreven zijn.
    return process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n");
  }
  return null;
}

function buildSslConfig(isLocal) {
  const ca = readCaCertificate();
  if (ca) return { ca, rejectUnauthorized: true };
  if (isLocal) return false;
  // Expliciete opt-out, alleen bedoeld voor een eenmalig script tegen een externe
  // database zonder CA-bundel; nooit op AWS (de taakdefinitie zet het CA-bestand).
  if (process.env.DATABASE_SSL_INSECURE === "true") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

// --- wachtwoord uit Secrets Manager -----------------------------------------------
const SECRET_CACHE_MS = 60 * 1000;
let secretCache = null;

async function readDatabaseSecret() {
  if (secretCache && Date.now() - secretCache.at < SECRET_CACHE_MS) {
    return secretCache.value;
  }
  const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const value = JSON.parse(response.SecretString || "{}");
  secretCache = { at: Date.now(), value };
  return value;
}

// Na een mislukte login (bijv. net geroteerd wachtwoord) de cache legen, zodat de
// volgende verbinding het nieuwe wachtwoord ophaalt.
function invalidateSecretCache() {
  secretCache = null;
}

function buildPoolConfig() {
  const common = {
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // Bescherming tegen hangende queries: na 60s breekt Postgres de query af.
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 60000,
    application_name: "veripasso"
  };

  if (process.env.DB_HOST) {
    const host = process.env.DB_HOST;
    return {
      ...common,
      host,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || "veripasso",
      user: process.env.DB_USER || undefined,
      // pg roept deze functie aan bij elke nieuwe verbinding.
      password: process.env.DB_SECRET_ARN
        ? async () => (await readDatabaseSecret()).password
        : process.env.DB_PASSWORD,
      ssl: buildSslConfig(/^(localhost|127\.0\.0\.1)$/.test(host))
    };
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("Databaseconfiguratie ontbreekt: zet DATABASE_URL (lokaal) of DB_HOST + DB_SECRET_ARN (AWS).");
  }
  const connectionString = stripSslMode(raw);
  return { ...common, connectionString, ssl: buildSslConfig(isLocalDatabase(connectionString)) };
}

let pgPool;

function getPgPool() {
  if (!pgPool) {
    pgPool = new Pool(buildPoolConfig());
    // Een verbroken idle-verbinding geeft een 'error'-event op de pool; zonder
    // listener crasht Node het hele proces. De pool vervangt de verbinding zelf.
    pgPool.on("error", (err) => {
      if (err && err.code === "28P01") invalidateSecretCache();
      logger.error("db_pool_error", { errorMessage: err.message, code: err.code });
    });
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
    let result;
    try {
      result = await this.executor.query(positional, values);
    } catch (error) {
      // 28P01 = wachtwoord geweigerd (bijv. net geroteerd): de volgende verbinding
      // haalt het nieuwe wachtwoord op.
      if (error && error.code === "28P01") invalidateSecretCache();
      throw error;
    }
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

// Alleen niet-geheime informatie voor het config-diagnose-endpoint.
function getDatabaseDiagnostics() {
  return {
    configured: Boolean(process.env.DATABASE_URL || process.env.DB_HOST),
    host: process.env.DB_HOST || null,
    database: process.env.DB_NAME || null,
    passwordFromSecretsManager: Boolean(process.env.DB_SECRET_ARN),
    tlsCaConfigured: Boolean(process.env.DATABASE_CA_CERT_FILE || process.env.DATABASE_CA_CERT)
  };
}

module.exports = { getPool, sql, close, getDatabaseDiagnostics };
