require("dotenv").config();
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  options: {
    encrypt: true,
    trustServerCertificate: false
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
