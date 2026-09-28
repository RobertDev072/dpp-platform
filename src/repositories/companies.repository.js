const { getPool, sql } = require("../config/db");

async function listCompanies() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, slug, status, plan_id, created_at, updated_at
    FROM dbo.Companies
    ORDER BY name
  `);
  return result.recordset;
}

async function getCompanyById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT id, name, slug, status, plan_id, created_at, updated_at
      FROM dbo.Companies
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function createCompany({ name, slug, planId, status }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(200), name)
    .input("slug", sql.NVarChar(100), slug)
    .input("planId", sql.Int, planId ?? null)
    .input("status", sql.NVarChar(20), status || "active")
    .query(`
      INSERT INTO dbo.Companies (name, slug, plan_id, status)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.slug, INSERTED.status, INSERTED.plan_id,
             INSERTED.created_at, INSERTED.updated_at
      VALUES (@name, @slug, @planId, @status)
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = ["name", "slug", "status", "planId"];
const FIELD_TO_COLUMN = { name: "name", slug: "slug", status: "status", planId: "plan_id" };

async function updateCompany(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${field}`);

    if (field === "planId") {
      request.input(field, sql.Int, fields[field] ?? null);
    } else if (field === "status") {
      request.input(field, sql.NVarChar(20), fields[field]);
    } else {
      request.input(field, sql.NVarChar(field === "name" ? 200 : 100), fields[field]);
    }
  }

  if (setClauses.length === 0) {
    return getCompanyById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Companies
    SET ${setClauses.join(", ")}
    OUTPUT INSERTED.id, INSERTED.name, INSERTED.slug, INSERTED.status, INSERTED.plan_id,
           INSERTED.created_at, INSERTED.updated_at
    WHERE id = @id
  `);

  return result.recordset[0] || null;
}

async function countCompanies() {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.Companies`);
  return result.recordset[0].total;
}

async function countActiveCompanies() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`SELECT COUNT(*) AS total FROM dbo.Companies WHERE status = 'active'`);
  return result.recordset[0].total;
}

module.exports = {
  listCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  countCompanies,
  countActiveCompanies
};
