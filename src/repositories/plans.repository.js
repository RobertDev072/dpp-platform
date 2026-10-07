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
    SELECT id, name, max_users, max_products, feature_flags, partner_assignable, created_at, updated_at
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
      SELECT id, name, max_users, max_products, feature_flags, partner_assignable, created_at, updated_at
      FROM dbo.Plans
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function createPlan({ name, maxUsers, maxProducts, featureFlags, partnerAssignable }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(100), name)
    .input("maxUsers", sql.Int, maxUsers)
    .input("maxProducts", sql.Int, maxProducts)
    .input("featureFlags", sql.NVarChar(sql.MAX), featureFlags ?? null)
    .input("partnerAssignable", sql.Bit, partnerAssignable !== false)
    .query(`
      INSERT INTO dbo.Plans (name, max_users, max_products, feature_flags, partner_assignable)
      VALUES (@name, @maxUsers, @maxProducts, @featureFlags, @partnerAssignable)
      RETURNING id, name, max_users, max_products, feature_flags, partner_assignable, created_at, updated_at
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = ["name", "maxUsers", "maxProducts", "featureFlags", "partnerAssignable"];
const FIELD_TO_COLUMN = {
  name: "name",
  maxUsers: "max_users",
  maxProducts: "max_products",
  partnerAssignable: "partner_assignable",
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
    } else if (field === "partnerAssignable") {
      request.input(field, sql.Bit, Boolean(fields[field]));
    } else {
      request.input(field, sql.Int, fields[field]);
    }
  }

  if (setClauses.length === 0) {
    return getPlanById(id);
  }

  setClauses.push("updated_at = now()");

  const result = await request.query(`
    UPDATE dbo.Plans
    SET ${setClauses.join(", ")}
    WHERE id = @id
    RETURNING id, name, max_users, max_products, feature_flags, partner_assignable, created_at, updated_at
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
