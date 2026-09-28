const { getPool, sql } = require("../config/db");

// Alle queries in dit bestand zijn gescoped op één company_id, die de route ALTIJD uit de
// sessie haalt (req.user.companyId). Er is hier bewust geen variant zonder company-filter.

const PRODUCT_STATUSES = ["draft", "review", "published", "archived"];

// Verplichte velden om te mogen publiceren (docs/architecture-roles.md §4), met de
// camelCase-naam die de client kent. Kolomnamen komen alleen uit deze vaste lijst.
const PUBLISH_REQUIRED_FIELDS = Object.freeze([
  { key: "name", column: "name" },
  { key: "sku", column: "sku" },
  { key: "manufacturer", column: "manufacturer" },
  { key: "model", column: "model" },
  { key: "category", column: "category" },
  { key: "materials", column: "materials" },
  { key: "countryOfOrigin", column: "country_of_origin" }
]);

function isBlankSql(column) {
  return `NULLIF(LTRIM(RTRIM(p.${column})), N'') IS NULL`;
}

async function getCompanyProfile(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT c.id, c.name, c.kvk_number, c.country, c.address, c.contact_name, c.contact_email, c.status,
             p.id AS plan_id, p.name AS plan_name
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.id = @companyId
    `);
  return result.recordset[0] || null;
}

// Alleen de velden die een Company Admin zelf mag bijhouden (zie company.schema.js).
// Naam, KvK, plan, max_users en status staan hier bewust niet in.
const SETTINGS_COLUMNS = {
  address: { column: "address", type: () => sql.NVarChar(500) },
  country: { column: "country", type: () => sql.NVarChar(100) },
  contactName: { column: "contact_name", type: () => sql.NVarChar(200) },
  contactEmail: { column: "contact_email", type: () => sql.NVarChar(256) }
};

async function updateCompanySettings(companyId, fields) {
  const pool = await getPool();
  const request = pool.request().input("companyId", sql.Int, companyId);

  const setClauses = [];
  for (const [field, { column, type }] of Object.entries(SETTINGS_COLUMNS)) {
    if (fields[field] === undefined) continue;
    setClauses.push(`${column} = @${field}`);
    request.input(field, type(), fields[field]);
  }
  if (setClauses.length === 0) return false;

  setClauses.push("updated_at = SYSUTCDATETIME()");
  const result = await request.query(`
    UPDATE dbo.Companies SET ${setClauses.join(", ")} WHERE id = @companyId
  `);
  return result.rowsAffected[0] > 0;
}

async function getUserCounts(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
      FROM dbo.Users
      WHERE company_id = @companyId
    `);
  const row = result.recordset[0];
  return { total: row.total, active: row.active || 0, inactive: row.inactive || 0, blocked: row.blocked || 0 };
}

async function getProductsByStatus(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT status, COUNT(*) AS count
      FROM dbo.Products
      WHERE company_id = @companyId
      GROUP BY status
    `);
  const counts = Object.fromEntries(result.recordset.map((row) => [row.status, row.count]));
  // Altijd alle statussen (ook 0), in de vaste volgorde van de statusflow.
  return PRODUCT_STATUSES.map((status) => ({ status, count: counts[status] || 0 }));
}

async function getProductCounts(companyId) {
  const byStatus = await getProductsByStatus(companyId);
  const counts = { total: 0 };
  for (const { status, count } of byStatus) {
    counts[status] = count;
    counts.total += count;
  }
  return counts;
}

async function getScanCounts(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN s.scanned_at >= DATEADD(day, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS last30Days
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      -- Alleen echte QR-scans, net als /api/admin/stats: bezoeken via een gedeelde link of
      -- voorvertoning (source 'web') en rijen van vóór 004 (NULL) tellen niet mee.
      WHERE p.company_id = @companyId AND s.source = 'qr'
    `);
  const row = result.recordset[0];
  return { total: row.total, last30Days: row.last30Days || 0 };
}

async function getProductsByCategory(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`
      SELECT NULLIF(LTRIM(RTRIM(category)), N'') AS category, COUNT(*) AS count
      FROM dbo.Products
      WHERE company_id = @companyId AND status <> 'archived'
      GROUP BY NULLIF(LTRIM(RTRIM(category)), N'')
      ORDER BY count DESC, category
    `);
  return result.recordset.map((row) => ({ category: row.category ?? null, count: row.count }));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Scans per dag (UTC) over de laatste `days` dagen, vandaag inbegrepen. Dagen zonder scans
// krijgen count 0, zodat de grafiek een doorlopende tijdas heeft.
async function getScansByDay(companyId, days = 30) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("daysBack", sql.Int, days - 1)
    .query(`
      SELECT CAST(s.scanned_at AS DATE) AS day, COUNT(*) AS count
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.source = 'qr'
        AND s.scanned_at >= DATEADD(day, -@daysBack, CAST(SYSUTCDATETIME() AS DATE))
      GROUP BY CAST(s.scanned_at AS DATE)
    `);

  const counts = new Map(result.recordset.map((row) => [toIsoDate(new Date(row.day)), row.count]));
  const today = new Date();
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const key = toIsoDate(day);
    series.push({ date: key, count: counts.get(key) || 0 });
  }
  return series;
}

async function getTopProducts(companyId, limit = 10) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) p.id, p.name, p.sku, p.status, COUNT(*) AS scans,
             SUM(CASE WHEN s.scanned_at >= DATEADD(day, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS scans_last_30_days
      FROM dbo.ScanEvents s
      JOIN dbo.Products p ON p.id = s.product_id
      WHERE p.company_id = @companyId AND s.source = 'qr'
      GROUP BY p.id, p.name, p.sku, p.status
      ORDER BY scans DESC, p.name
    `);
  return result.recordset;
}

// Niet-gearchiveerde producten die nog niet gepubliceerd zouden kunnen worden, met per
// product welke verplichte velden ontbreken (leeg of alleen spaties telt als ontbrekend).
async function getIncompleteProducts(companyId, limit = 100) {
  const pool = await getPool();
  const flags = PUBLISH_REQUIRED_FIELDS.map(
    ({ key, column }) => `CASE WHEN ${isBlankSql(column)} THEN 1 ELSE 0 END AS [missing_${key}]`
  ).join(",\n             ");
  const anyMissing = PUBLISH_REQUIRED_FIELDS.map(({ column }) => isBlankSql(column)).join(" OR ");

  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) p.id, p.name, p.status, p.updated_at,
             ${flags}
      FROM dbo.Products p
      WHERE p.company_id = @companyId AND p.status <> 'archived' AND (${anyMissing})
      ORDER BY p.updated_at DESC, p.id DESC
    `);

  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    updated_at: row.updated_at,
    missing: PUBLISH_REQUIRED_FIELDS.filter(({ key }) => row[`missing_${key}`] === 1).map(({ key }) => key)
  }));
}

function parseMetadata(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Audit-regels van één company, nieuwste eerst. De actor-e-mail tonen we alleen voor
// actoren uit dezelfde company; acties van de System Owner verschijnen als "platform"
// zonder e-mailadres (dat is platform-interne informatie, geen data van deze tenant).
async function listCompanyAudit(companyId, { limit = 50, offset = 0, action } = {}) {
  const pool = await getPool();
  const request = pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("limit", sql.Int, limit)
    .input("offset", sql.Int, offset);

  let actionFilter = "";
  if (action) {
    request.input("action", sql.NVarChar(100), action);
    actionFilter = "AND a.action = @action";
  }

  const result = await request.query(`
    SELECT a.id, a.timestamp, a.action, a.entity_type, a.entity_id, a.metadata,
           CASE WHEN u.company_id = @companyId THEN u.email ELSE NULL END AS actor_email,
           CASE WHEN u.id IS NULL THEN NULL WHEN u.role = 'system_owner' THEN 'platform' ELSE 'company' END AS actor_type
    FROM dbo.AuditLogs a
    LEFT JOIN dbo.Users u ON u.id = a.user_id
    WHERE a.company_id = @companyId ${actionFilter}
    ORDER BY a.timestamp DESC, a.id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

    SELECT COUNT(*) AS total
    FROM dbo.AuditLogs a
    WHERE a.company_id = @companyId ${actionFilter};
  `);

  return {
    items: result.recordsets[0].map((row) => ({
      id: Number(row.id),
      timestamp: row.timestamp,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      actor_email: row.actor_email,
      actor_type: row.actor_type,
      metadata: parseMetadata(row.metadata)
    })),
    total: result.recordsets[1][0].total
  };
}

module.exports = {
  PUBLISH_REQUIRED_FIELDS,
  getCompanyProfile,
  updateCompanySettings,
  getUserCounts,
  getProductCounts,
  getProductsByStatus,
  getProductsByCategory,
  getScanCounts,
  getScansByDay,
  getTopProducts,
  getIncompleteProducts,
  listCompanyAudit
};
