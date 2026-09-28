require("dotenv").config();
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  options: {
    encrypt: true,
    // Alleen voor een lokale SQL Server-container (self-signed cert) bij het draaien van
    // de testsuite. Staat standaard uit en hoort NOOIT aan op Azure SQL.
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true"
  },

  // Serverless Azure SQL kan gepauzeerd zijn en heeft tijd nodig om te ontwaken.
  connectionTimeout: 30000,
  requestTimeout: 30000
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config);
  }
  return poolPromise;
}

module.exports = { getPool, sql };
