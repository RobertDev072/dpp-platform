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
    // Als deze verbindingspoging mislukt (bijv. een serverless Azure SQL-database die
    // nog aan het ontwaken is), mag dat niet blijvend gecachet worden - anders blijft
    // elke volgende aanvraag dezelfde mislukte poging hergebruiken, ook lang nadat de
    // database allang weer bereikbaar is. Zonder deze reset was dat precies wat er
    // gebeurde: een enkele ETIMEOUT maakte de hele instance blijvend onbruikbaar tot
    // een herstart.
    poolPromise = sql.connect(config).catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { getPool, sql };
