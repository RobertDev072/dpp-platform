const { getPool, sql } = require("../config/db");

// Geeft null terug als de company nog geen plan heeft (dan geldt geen limiet) — een
// system_owner kan een company aanmaken zonder meteen een plan te kiezen.
async function getMaxUsersForCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT p.max_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);

  const row = result.recordset[0];
  return row ? row.max_users : null;
}

async function listPlans() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, max_users, max_products, feature_flags, created_at, updated_at
    FROM dbo.Plans
    ORDER BY name
  `);
  return result.recordset;
}

async function getPlanById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT id, name, max_users, max_products, feature_flags, created_at, updated_at
      FROM dbo.Plans
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function createPlan({ name, maxUsers, maxProducts, featureFlags }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(100), name)
    .input("maxUsers", sql.Int, maxUsers)
    .input("maxProducts", sql.Int, maxProducts)
    .input("featureFlags", sql.NVarChar(sql.MAX), featureFlags ?? null)
    .query(`
      INSERT INTO dbo.Plans (name, max_users, max_products, feature_flags)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.max_users, INSERTED.max_products,
             INSERTED.feature_flags, INSERTED.created_at, INSERTED.updated_at
      VALUES (@name, @maxUsers, @maxProducts, @featureFlags)
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = ["name", "maxUsers", "maxProducts", "featureFlags"];
const FIELD_TO_COLUMN = {
  name: "name",
  maxUsers: "max_users",
  maxProducts: "max_products",
  featureFlags: "feature_flags"
};

async function updatePlan(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${field}`);

    if (field === "name") {
      request.input(field, sql.NVarChar(100), fields[field]);
    } else if (field === "featureFlags") {
      request.input(field, sql.NVarChar(sql.MAX), fields[field]);
    } else {
      request.input(field, sql.Int, fields[field]);
    }
  }

  if (setClauses.length === 0) {
    return getPlanById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Plans
    SET ${setClauses.join(", ")}
    OUTPUT INSERTED.id, INSERTED.name, INSERTED.max_users, INSERTED.max_products,
           INSERTED.feature_flags, INSERTED.created_at, INSERTED.updated_at
    WHERE id = @id
  `);

  return result.recordset[0] || null;
}

module.exports = {
  getMaxUsersForCompany,
  listPlans,
  getPlanById,
  createPlan,
  updatePlan
};
