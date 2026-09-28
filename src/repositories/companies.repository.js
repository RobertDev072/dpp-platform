const { getPool, sql } = require("../config/db");

// Kolommen van Companies zelf; de lijst- en detailqueries voegen daar plan- en tellingen aan toe.
const COMPANY_COLUMNS = [
  "id",
  "name",
  "slug",
  "status",
  "plan_id",
  "kvk_number",
  "country",
  "address",
  "contact_name",
  "contact_email",
  "max_users",
  "created_at",
  "updated_at"
];

const SELECT_COMPANY = `
  SELECT ${COMPANY_COLUMNS.map((column) => `c.${column}`).join(", ")},
         p.name AS plan_name,
         p.max_users AS plan_max_users,
         COALESCE(c.max_users, p.max_users) AS effective_max_users
  FROM dbo.Companies c
  LEFT JOIN dbo.Plans p ON p.id = c.plan_id
`;

// Een seat = actieve gebruiker (zie seats.service.js); admin_count telt alleen actieve
// Company Admins, zodat een company met alleen een geblokkeerde admin opvalt in de lijst.
async function listCompanies() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${COMPANY_COLUMNS.map((column) => `c.${column}`).join(", ")},
           p.name AS plan_name,
           p.max_users AS plan_max_users,
           COALESCE(c.max_users, p.max_users) AS effective_max_users,
           (SELECT COUNT(*) FROM dbo.Users u WHERE u.company_id = c.id AND u.status = 'active') AS active_users,
           (SELECT COUNT(*) FROM dbo.Products pr WHERE pr.company_id = c.id) AS product_count,
           (SELECT COUNT(*) FROM dbo.Users u
             WHERE u.company_id = c.id AND u.role = 'company_admin' AND u.status = 'active') AS admin_count,
           (SELECT COUNT(*) FROM dbo.CompanyInvitations i
             WHERE i.company_id = c.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
               AND i.expires_at > SYSUTCDATETIME()) AS pending_invitations
    FROM dbo.Companies c
    LEFT JOIN dbo.Plans p ON p.id = c.plan_id
    ORDER BY c.name
  `);
  return result.recordset;
}

async function getCompanyById(id) {
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, id).query(`${SELECT_COMPANY} WHERE c.id = @id`);
  return result.recordset[0] || null;
}

// Alle Company Admins (ook inactieve/geblokkeerde): de System Owner moet kunnen zien wie
// er ooit beheerder was, bijvoorbeeld om een geblokkeerde admin te heractiveren.
async function listCompanyAdmins(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT id, email, first_name, last_name, status, last_login_at
      FROM dbo.Users
      WHERE company_id = @companyId AND role = 'company_admin'
      ORDER BY email
    `);
  return result.recordset;
}

// Leidt een slug af van de bedrijfsnaam ("Café de Brug B.V." -> "cafe-de-brug-b-v").
function slugify(name) {
  const base = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "bedrijf";
}

// Zoekt de eerste vrije variant (acme, acme-2, acme-3, ...). De UNIQUE constraint blijft
// de echte bewaker: bij een gelijktijdige insert met dezelfde slug geeft die een 2627,
// waarna de route het met een willekeurig achtervoegsel opnieuw probeert.
async function generateUniqueSlug(name) {
  const base = slugify(name);
  const pool = await getPool();
  // base bevat alleen [a-z0-9-], dus geen LIKE-wildcards die ontsnapt moeten worden.
  const result = await pool
    .request()
    .input("base", sql.NVarChar(100), base)
    .input("pattern", sql.NVarChar(110), `${base}-%`)
    .query("SELECT slug FROM dbo.Companies WHERE slug = @base OR slug LIKE @pattern");

  const taken = new Set(result.recordset.map((row) => row.slug));
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Veld (camelCase uit de API) -> kolom + SQL-type. Alleen deze velden kunnen ooit in een
// INSERT/UPDATE terechtkomen; kolomnamen komen dus nooit uit de request.
const FIELD_DEFINITIONS = {
  name: { column: "name", type: sql.NVarChar(200) },
  slug: { column: "slug", type: sql.NVarChar(100) },
  status: { column: "status", type: sql.NVarChar(20) },
  planId: { column: "plan_id", type: sql.Int },
  kvkNumber: { column: "kvk_number", type: sql.NVarChar(20) },
  country: { column: "country", type: sql.NVarChar(100) },
  address: { column: "address", type: sql.NVarChar(500) },
  contactName: { column: "contact_name", type: sql.NVarChar(200) },
  contactEmail: { column: "contact_email", type: sql.NVarChar(256) },
  maxUsers: { column: "max_users", type: sql.Int }
};

const UPDATABLE_FIELDS = Object.keys(FIELD_DEFINITIONS);

async function createCompany(fields) {
  const pool = await getPool();
  const request = pool.request();
  const values = { ...fields, status: fields.status || "active" };

  const columns = [];
  const params = [];
  for (const field of UPDATABLE_FIELDS) {
    if (values[field] === undefined) continue;
    const { column, type } = FIELD_DEFINITIONS[field];
    request.input(field, type, values[field]);
    columns.push(column);
    params.push(`@${field}`);
  }

  const result = await request.query(`
    INSERT INTO dbo.Companies (${columns.join(", ")})
    OUTPUT INSERTED.id
    VALUES (${params.join(", ")})
  `);
  return getCompanyById(result.recordset[0].id);
}

async function updateCompany(id, fields) {
  const pool = await getPool();
  const request = pool.request().input("id", sql.Int, id);

  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] === undefined) continue;
    const { column, type } = FIELD_DEFINITIONS[field];
    request.input(field, type, fields[field]);
    setClauses.push(`${column} = @${field}`);
  }

  if (setClauses.length === 0) {
    return getCompanyById(id);
  }

  setClauses.push("updated_at = SYSUTCDATETIME()");

  const result = await request.query(`
    UPDATE dbo.Companies
    SET ${setClauses.join(", ")}
    WHERE id = @id
  `);

  if (result.rowsAffected[0] === 0) return null;
  return getCompanyById(id);
}

// getUserForToken blokkeert gebruikers van een niet-actieve company al direct; de sessies
// ook echt verwijderen zorgt dat ze na heractiveren niet ongemerkt weer doorwerken.
async function revokeCompanySessions(companyId) {
  const pool = await getPool();
  await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      DELETE s FROM dbo.Sessions s
      JOIN dbo.Users u ON u.id = s.user_id
      WHERE u.company_id = @companyId
    `);
}

module.exports = {
  listCompanies,
  getCompanyById,
  listCompanyAdmins,
  slugify,
  generateUniqueSlug,
  createCompany,
  updateCompany,
  revokeCompanySessions
};
