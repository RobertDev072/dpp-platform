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
      SELECT id, name, slug, status, plan_id, logo, kind, partner_id,
             license_start, license_end, created_at, updated_at
      FROM dbo.Companies
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function createCompany({ name, slug, planId, status, kind, partnerId, licenseStart, licenseEnd }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar(200), name)
    .input("slug", sql.NVarChar(100), slug)
    .input("planId", sql.Int, planId ?? null)
    .input("status", sql.NVarChar(20), status || "active")
    .input("kind", sql.NVarChar(20), kind || "customer")
    .input("partnerId", sql.Int, partnerId ?? null)
    .input("licenseStart", sql.Date, licenseStart ?? null)
    .input("licenseEnd", sql.Date, licenseEnd ?? null)
    .query(`
      INSERT INTO dbo.Companies (name, slug, plan_id, status, kind, partner_id, license_start, license_end)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.slug, INSERTED.status, INSERTED.plan_id,
             INSERTED.kind, INSERTED.partner_id, INSERTED.license_start, INSERTED.license_end,
             INSERTED.created_at, INSERTED.updated_at
      VALUES (@name, @slug, @planId, @status, @kind, @partnerId, @licenseStart, @licenseEnd)
    `);
  return result.recordset[0];
}

const UPDATABLE_FIELDS = ["name", "slug", "status", "planId", "logo", "licenseStart", "licenseEnd", "partnerId"];
const FIELD_TO_COLUMN = {
  name: "name",
  slug: "slug",
  status: "status",
  planId: "plan_id",
  logo: "logo",
  licenseStart: "license_start",
  licenseEnd: "license_end",
  partnerId: "partner_id"
};

// Verrijkte lijst voor het platformbeheer-overzicht: aantallen, beheerder en
// laatste activiteit per bedrijf in één query (schaal is hier beperkt: bedrijven,
// niet producten).
async function listCompaniesWithStats({ partnerId, kind } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const where = [];
  if (partnerId !== undefined) {
    request.input("partnerId", sql.Int, partnerId);
    where.push("c.partner_id = @partnerId");
  }
  if (kind !== undefined) {
    request.input("kind", sql.NVarChar(20), kind);
    where.push("c.kind = @kind");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await request.query(`
    SELECT c.id, c.name, c.slug, c.status, c.plan_id, c.logo, c.kind, c.partner_id,
           partner.name AS partner_name,
           c.license_start, c.license_end, c.created_at, c.updated_at,
           pl.name AS plan_name, pl.max_users, pl.max_products,
           (SELECT COUNT(*) FROM dbo.Products p WHERE p.company_id = c.id AND p.status <> 'archived') AS product_count,
           (SELECT COUNT(*) FROM dbo.Users u WHERE u.company_id = c.id AND u.status = 'active') AS active_user_count,
           (SELECT TOP 1 u.email FROM dbo.Users u
             WHERE u.company_id = c.id AND u.role = 'company_admin' AND u.status = 'active'
             ORDER BY u.id) AS admin_email,
           (SELECT MAX(a.timestamp) FROM dbo.AuditLogs a WHERE a.company_id = c.id) AS last_activity
    FROM dbo.Companies c
    LEFT JOIN dbo.Plans pl ON pl.id = c.plan_id
    LEFT JOIN dbo.Companies partner ON partner.id = c.partner_id
    ${whereSql}
    ORDER BY c.name
  `);
  return result.recordset;
}

async function updateCompany(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${field}`);

    if (field === "planId" || field === "partnerId") {
      request.input(field, sql.Int, fields[field] ?? null);
    } else if (field === "status") {
      request.input(field, sql.NVarChar(20), fields[field]);
    } else if (field === "logo") {
      request.input(field, sql.NVarChar(sql.MAX), fields[field] ?? null);
    } else if (field === "licenseStart" || field === "licenseEnd") {
      request.input(field, sql.Date, fields[field] ?? null);
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
  listCompaniesWithStats,
  getCompanyById,
  createCompany,
  updateCompany,
  countCompanies,
  countActiveCompanies
};
