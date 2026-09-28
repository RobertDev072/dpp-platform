const { getPool } = require("../config/db");

const RECENT_COMPANIES = 5;
const RECENT_ACTIVITY = 10;

// Alle dashboardcijfers in één round-trip (Azure SQL serverless: elke round-trip telt).
// Geen gebruikersinvoer in deze query, dus geen parameters nodig.
async function getPlatformStats() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Companies) AS companies_total,
      (SELECT COUNT(*) FROM dbo.Companies WHERE status = 'active') AS companies_active,
      -- Gebruikers van klanten; System Owners zijn platformbeheer en tellen niet mee.
      (SELECT COUNT(*) FROM dbo.Users WHERE role <> 'system_owner') AS users_total,
      (SELECT COUNT(*) FROM dbo.Users WHERE role <> 'system_owner' AND status = 'active') AS users_active,
      (SELECT COUNT(*) FROM dbo.Products) AS products_total,
      (SELECT COUNT(*) FROM dbo.Products WHERE status = 'draft') AS products_draft,
      (SELECT COUNT(*) FROM dbo.Products WHERE status = 'review') AS products_review,
      (SELECT COUNT(*) FROM dbo.Products WHERE status = 'published') AS products_published,
      (SELECT COUNT(*) FROM dbo.Products WHERE status = 'archived') AS products_archived,
      (SELECT COUNT(*) FROM dbo.Products WHERE status = 'published' AND public_id IS NOT NULL) AS dpps_published,
      -- Alleen echte QR-scans. Bezoeken via een gedeelde link, de voorvertoning, een zoekmachine
      -- of verversen worden als source 'web' opgeslagen; dpp.js haalt ?src=qr juist daarom uit de
      -- adresbalk. Rijen van vóór 004 hebben geen source (NULL) en zijn niet als scan te herkennen.
      (SELECT COUNT_BIG(*) FROM dbo.ScanEvents WHERE source = 'qr') AS scans_total,
      (SELECT COUNT_BIG(*) FROM dbo.ScanEvents
        WHERE source = 'qr' AND scanned_at >= DATEADD(DAY, -30, SYSUTCDATETIME())) AS scans_last30,
      (SELECT COUNT(*) FROM dbo.CompanyInvitations
        WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > SYSUTCDATETIME()) AS invitations_pending;

    -- Licentie = actieve company met een plan of een eigen max_users. Gebruikte seats
    -- tellen binnen diezelfde set, zodat used/total vergelijkbaar blijft.
    SELECT COUNT(*) AS active_licenses,
           COALESCE(SUM(CAST(l.max_users AS BIGINT)), 0) AS total_seats,
           COALESCE(SUM(CAST(l.active_users AS BIGINT)), 0) AS used_seats
    FROM (
      SELECT COALESCE(c.max_users, p.max_users) AS max_users,
             (SELECT COUNT(*) FROM dbo.Users u WHERE u.company_id = c.id AND u.status = 'active') AS active_users
      FROM dbo.Companies c
      LEFT JOIN dbo.Plans p ON p.id = c.plan_id
      WHERE c.status = 'active' AND (c.plan_id IS NOT NULL OR c.max_users IS NOT NULL)
    ) l;

    SELECT TOP (${RECENT_COMPANIES}) id, name, status, created_at
    FROM dbo.Companies
    ORDER BY created_at DESC, id DESC;

    SELECT TOP (${RECENT_ACTIVITY}) a.id, a.timestamp, a.action, a.entity_type, a.entity_id,
           c.name AS company_name, u.email AS actor_email
    FROM dbo.AuditLogs a
    LEFT JOIN dbo.Companies c ON c.id = a.company_id
    LEFT JOIN dbo.Users u ON u.id = a.user_id
    ORDER BY a.timestamp DESC, a.id DESC;
  `);

  const [counts] = result.recordsets[0];
  const [licenses] = result.recordsets[1];

  // COUNT_BIG/BIGINT komen als string terug uit mssql; voor dashboardgetallen is Number veilig.
  return {
    companies: { total: counts.companies_total, active: counts.companies_active },
    users: { total: counts.users_total, active: counts.users_active },
    licenses: {
      activeLicenses: licenses.active_licenses,
      totalSeats: Number(licenses.total_seats),
      usedSeats: Number(licenses.used_seats)
    },
    products: {
      total: counts.products_total,
      draft: counts.products_draft,
      review: counts.products_review,
      published: counts.products_published,
      archived: counts.products_archived
    },
    dpps: { published: counts.dpps_published },
    scans: { total: Number(counts.scans_total), last30Days: Number(counts.scans_last30) },
    invitations: { pending: counts.invitations_pending },
    recentCompanies: result.recordsets[2],
    recentActivity: result.recordsets[3].map((row) => ({ ...row, id: Number(row.id) }))
  };
}

module.exports = { getPlatformStats };
