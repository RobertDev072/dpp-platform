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
    poolPromise = sql.connect(config).then((pool) => {
      // Een serverless Azure SQL-database kan zichzelf pauzeren of een bestaande
      // TCP-verbinding laten vallen (ECONNRESET) nadat de pool al langer bestaat -
      // dat gebeurt los van een nieuwe .connect()-poging, als een 'error'-event op de
      // pool zelf. Node.js beschouwt een EventEmitter-'error' zonder listener als
      // fataal en crasht het hele proces - dat was de werkelijke oorzaak van de
      // herhaalde volledige uitval (niet alleen trage queries). Met deze listener
      // wordt de kapotte pool simpelweg bij de eerstvolgende aanvraag opnieuw
      // opgebouwd, zonder het proces te laten crashen.
      pool.on("error", (err) => {
        console.error("SQL-pool-fout (verbinding verbroken), pool wordt bij volgende aanvraag herbouwd:", err.message);
        poolPromise = undefined;
      });
      return pool;
    }).catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { getPool, sql };
