const { queryRows, queryOne } = require("../config/db");

async function listCompanies() {
  return queryRows(`
    SELECT id, name, slug, status, plan_id, created_at, updated_at
    FROM companies
    ORDER BY name
  `);
}

async function getCompanyById(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(
    `
    SELECT id, name, slug, status, plan_id, logo, kind, partner_id,
           license_start, license_end, created_at, updated_at
    FROM companies
    WHERE id = $1
  `,
    [id]
  );
}

async function createCompany({ name, slug, planId, status, kind, partnerId, licenseStart, licenseEnd }) {
  return queryOne(
    `
    INSERT INTO companies (name, slug, plan_id, status, kind, partner_id, license_start, license_end)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, name, slug, status, plan_id, kind, partner_id, license_start, license_end,
              created_at, updated_at
  `,
    [
      name,
      slug,
      planId ?? null,
      status || "active",
      kind || "customer",
      partnerId ?? null,
      licenseStart ?? null,
      licenseEnd ?? null
    ]
  );
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
  const params = [];
  const where = [];
  if (partnerId !== undefined) {
    params.push(partnerId);
    where.push(`c.partner_id = $${params.length}`);
  }
  if (kind !== undefined) {
    params.push(kind);
    where.push(`c.kind = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return queryRows(
    `
    SELECT c.id, c.name, c.slug, c.status, c.plan_id, c.logo, c.kind, c.partner_id,
           partner.name AS partner_name,
           c.license_start, c.license_end, c.created_at, c.updated_at,
           pl.name AS plan_name, pl.max_users, pl.max_products,
           (SELECT COUNT(*) FROM products p WHERE p.company_id = c.id AND p.status <> 'archived') AS product_count,
           (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active') AS active_user_count,
           (SELECT u.email FROM users u
             WHERE u.company_id = c.id AND u.role = 'company_admin' AND u.status = 'active'
             ORDER BY u.id LIMIT 1) AS admin_email,
           (SELECT MAX(a.timestamp) FROM audit_logs a WHERE a.company_id = c.id) AS last_activity
    FROM companies c
    LEFT JOIN plans pl ON pl.id = c.plan_id
    LEFT JOIN companies partner ON partner.id = c.partner_id
    ${whereSql}
    ORDER BY c.name
  `,
    params
  );
}

async function updateCompany(id, fields) {
  const params = [id];
  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    const value = ["planId", "partnerId", "logo", "licenseStart", "licenseEnd"].includes(field)
      ? fields[field] ?? null
      : fields[field];
    params.push(value);
    setClauses.push(`${FIELD_TO_COLUMN[field]} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return getCompanyById(id);
  }

  setClauses.push("updated_at = now()");

  return queryOne(
    `UPDATE companies SET ${setClauses.join(", ")} WHERE id = $1
     RETURNING id, name, slug, status, plan_id, created_at, updated_at`,
    params
  );
}

async function countCompanies() {
  const row = await queryOne(`SELECT COUNT(*) AS total FROM companies`);
  return row.total;
}

async function countActiveCompanies() {
  const row = await queryOne(`SELECT COUNT(*) AS total FROM companies WHERE status = 'active'`);
  return row.total;
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
