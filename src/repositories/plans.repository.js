const { getPool, sql } = require("../config/db");

// Effectieve seat-limit: Companies.max_users (override door de System Owner) gaat vóór
// Plans.max_users. Geeft null terug als geen van beide gezet is (dan geldt geen limiet) —
// een system_owner kan een company aanmaken zonder meteen een plan te kiezen.
async function getMaxUsersForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT COALESCE(c.max_users, p.max_users) AS max_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);

  const row = result.recordset[0];
  return row ? row.max_users : null;
}

const SELECT_PLAN = `
  SELECT p.id, p.name, p.description, p.max_users, p.max_products, p.is_active, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM dbo.Companies c WHERE c.plan_id = p.id) AS company_count
  FROM dbo.Plans p
`;

async function listPlans() {
  const pool = await getPool();
  const result = await pool.request().query(`${SELECT_PLAN} ORDER BY p.name, p.id`);
  return result.recordset;
}

async function getPlanById(id) {
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, id).query(`${SELECT_PLAN} WHERE p.id = @id`);
  return result.recordset[0] || null;
}

// Plannamen zijn niet uniek afgedwongen in de database; dit voorkomt verwarring in de
// keuzelijst. De collation is case-insensitive, dus "Basis" en "basis" botsen ook.
async function getPlanByName(name) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(100), name)
    .query("SELECT id, name FROM dbo.Plans WHERE name = @name");
  return result.recordset[0] || null;
}

const FIELD_DEFINITIONS = {
  name: { column: "name", type: sql.NVarChar(100) },
  description: { column: "description", type: sql.NVarChar(500) },
  maxUsers: { column: "max_users", type: sql.Int },
  maxProducts: { column: "max_products", type: sql.Int },
  isActive: { column: "is_active", type: sql.Bit }
};

const PLAN_FIELDS = Object.keys(FIELD_DEFINITIONS);

async function createPlan(fields) {
  const pool = await getPool();
  const request = pool.request();

  const columns = [];
  const params = [];
  for (const field of PLAN_FIELDS) {
    if (fields[field] === undefined) continue;
    const { column, type } = FIELD_DEFINITIONS[field];
    request.input(field, type, fields[field]);
    columns.push(column);
    params.push(`@${field}`);
  }

  const result = await request.query(`
    INSERT INTO dbo.Plans (${columns.join(", ")})
    OUTPUT INSERTED.id
    VALUES (${params.join(", ")})
  `);
  return getPlanById(result.recordset[0].id);
}

async function updatePlan(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of PLAN_FIELDS) {
    if (fields[field] === undefined) continue;
    const { column, type } = FIELD_DEFINITIONS[field];
    request.input(field, type, fields[field]);
    setClauses.push(`${column} = @${field}`);
  }

  if (setClauses.length === 0) {
    return getPlanById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`UPDATE dbo.Plans SET ${setClauses.join(", ")} WHERE id = @id`);
  if (result.rowsAffected[0] === 0) return null;
  return getPlanById(id);
}

module.exports = { getMaxUsersForCompany, listPlans, getPlanById, getPlanByName, createPlan, updatePlan };
