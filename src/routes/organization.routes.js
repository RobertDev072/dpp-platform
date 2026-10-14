const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const { getPool } = require("../config/db");
const { PLATFORM_OWNER_ROLES } = require("../utils/roles");

// Organisaties & gebruikers (alleen Platform Owner): partners → klantbedrijven →
// gebruikers, per niveau server-side gepagineerd. Er wordt nooit alles in één keer
// geladen: een partner uitklappen haalt één pagina klantbedrijven op, een bedrijf
// uitklappen één pagina gebruikers. Aantallen per pagina in één query (geen N+1).
// Relaties komen uit het datamodel: companies.kind ('partner' | 'customer'),
// companies.partner_id (klant → partner), users.company_id + users.role.
// Verwijderde gebruikers (status 'deleted') komen nergens in voor.
const router = express.Router();
router.use(requireAuth, requireRole(...PLATFORM_OWNER_ROLES));

const COMPANY_STATUSES = ["active", "blocked", "suspended", "archived"];
const USER_STATUSES = ["active", "blocked", "suspended", "archived"];
const ROLES = ["platform_owner", "partner_admin", "company_admin", "company_user"];

const pageSchema = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), "25, 50 of 100").default(25)
};

function likePattern(q) {
  return `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function pageResult(rows, { page, pageSize }, total) {
  return { items: rows, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

const PRODUCT_COUNT = "(SELECT COUNT(*) FROM dbo.products p WHERE p.company_id = c.id AND p.status <> 'archived')";

// --- niveau 1: partners (+ samenvatting zelfstandige klantbedrijven) --------------------
const groupsSchema = z.object({
  ...pageSchema,
  status: z.enum(COMPANY_STATUSES).optional(),
  sort: z.enum(["name", "customers", "created"]).default("name")
});

router.get("/groups", validateQuery(groupsSchema), async (req, res, next) => {
  try {
    const { page, pageSize, status, sort } = req.validatedQuery;
    const pool = await getPool();
    const params = [];
    const where = ["c.kind = 'partner'"];
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    const order = { name: "lower(c.name)", customers: "customer_count DESC, lower(c.name)", created: "c.created_at DESC" }[sort];
    const total = Number((await pool.query(`SELECT COUNT(*) FROM dbo.companies c WHERE ${where.join(" AND ")}`, params)).rows[0].count);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = (
      await pool.query(
        `WITH page AS (
           SELECT c.id, c.name, c.slug, c.status, c.created_at
           FROM dbo.companies c WHERE ${where.join(" AND ")}
         ),
         customers AS (
           SELECT k.partner_id, COUNT(*) AS customer_count FROM dbo.companies k
           WHERE k.kind = 'customer' AND k.partner_id IN (SELECT id FROM page) GROUP BY k.partner_id
         ),
         customer_users AS (
           SELECT k.partner_id, COUNT(u.id) AS n FROM dbo.companies k JOIN dbo.users u ON u.company_id = k.id
           WHERE k.kind = 'customer' AND k.partner_id IN (SELECT id FROM page) AND u.status <> 'deleted' GROUP BY k.partner_id
         ),
         admins AS (
           SELECT u.company_id, COUNT(*) AS n FROM dbo.users u
           WHERE u.company_id IN (SELECT id FROM page) AND u.status <> 'deleted' GROUP BY u.company_id
         )
         SELECT c.*, COALESCE(cu.customer_count, 0)::int AS customer_count,
                COALESCE(a.n, 0)::int AS partner_admin_count, COALESCE(us.n, 0)::int AS customer_user_count
         FROM page c
         LEFT JOIN customers cu ON cu.partner_id = c.id
         LEFT JOIN admins a ON a.company_id = c.id
         LEFT JOIN customer_users us ON us.partner_id = c.id
         ORDER BY ${order}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
    ).rows;

    // Zelfstandige klantbedrijven (zonder partner): één samenvattende groep.
    const standalone = (
      await pool.query(
        `SELECT COUNT(*)::int AS customer_count,
                (SELECT COUNT(*) FROM dbo.users u JOIN dbo.companies k ON k.id = u.company_id
                 WHERE k.kind = 'customer' AND k.partner_id IS NULL AND u.status <> 'deleted')::int AS customer_user_count
         FROM dbo.companies c WHERE c.kind = 'customer' AND c.partner_id IS NULL ${status ? "AND c.status = $1" : ""}`,
        status ? [status] : []
      )
    ).rows[0];

    res.json({ ...pageResult(rows, { page, pageSize }, total), standalone });
  } catch (error) {
    next(error);
  }
});

// --- niveau 2: klantbedrijven van één partner (of zelfstandig) ---------------------------
const customersSchema = z.object({
  ...pageSchema,
  status: z.enum(COMPANY_STATUSES).optional(),
  sort: z.enum(["name", "users", "products", "created", "activity"]).default("name")
});

router.get("/groups/:groupId/customers", validateQuery(customersSchema), async (req, res, next) => {
  try {
    const { page, pageSize, status, sort } = req.validatedQuery;
    const groupId = req.params.groupId;
    const pool = await getPool();
    const params = [];
    const where = ["c.kind = 'customer'"];
    if (groupId === "standalone") {
      where.push("c.partner_id IS NULL");
    } else if (/^[1-9]\d{0,9}$/.test(groupId)) {
      const partner = (await pool.query("SELECT id FROM dbo.companies WHERE id = $1 AND kind = 'partner'", [Number(groupId)])).rows[0];
      if (!partner) throw new HttpError(404, "Niet gevonden");
      params.push(partner.id);
      where.push(`c.partner_id = $${params.length}`);
    } else {
      throw new HttpError(404, "Niet gevonden");
    }
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    const order = {
      name: "lower(c.name)",
      users: "user_count DESC, lower(c.name)",
      products: "product_count DESC, lower(c.name)",
      created: "c.created_at DESC",
      activity: "last_activity DESC NULLS LAST, lower(c.name)"
    }[sort];
    const total = Number((await pool.query(`SELECT COUNT(*) FROM dbo.companies c WHERE ${where.join(" AND ")}`, params)).rows[0].count);
    params.push(pageSize, (page - 1) * pageSize);
    // Sorteren op aantallen gebeurt over alle bedrijven van de groep; de aantallen zelf
    // komen uit gegroepeerde subquery's (één keer per query, niet per rij).
    const rows = (
      await pool.query(
        `WITH base AS (SELECT c.* FROM dbo.companies c WHERE ${where.join(" AND ")}),
         uc AS (
           SELECT u.company_id,
                  COUNT(*) FILTER (WHERE u.role = 'company_admin') AS admins,
                  COUNT(*) FILTER (WHERE u.role = 'company_user') AS employees,
                  COUNT(*) AS users
           FROM dbo.users u WHERE u.company_id IN (SELECT id FROM base) AND u.status <> 'deleted' GROUP BY u.company_id
         ),
         pc AS (
           SELECT p.company_id, COUNT(*) AS n FROM dbo.products p
           WHERE p.company_id IN (SELECT id FROM base) AND p.status <> 'archived' GROUP BY p.company_id
         ),
         act AS (
           SELECT a.company_id, MAX(a.timestamp) AS last_activity FROM dbo.auditlogs a
           WHERE a.company_id IN (SELECT id FROM base) GROUP BY a.company_id
         )
         SELECT c.id, c.name, c.slug, c.status, c.partner_id, c.created_at, c.license_start, c.license_end,
                pl.name AS plan_name, pl.max_users, pl.max_products,
                COALESCE(uc.admins, 0)::int AS admin_count, COALESCE(uc.employees, 0)::int AS employee_count,
                COALESCE(uc.users, 0)::int AS user_count, COALESCE(pc.n, 0)::int AS product_count,
                act.last_activity
         FROM base c
         LEFT JOIN dbo.plans pl ON pl.id = c.plan_id
         LEFT JOIN uc ON uc.company_id = c.id
         LEFT JOIN pc ON pc.company_id = c.id
         LEFT JOIN act ON act.company_id = c.id
         ORDER BY ${order}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
    ).rows;

    // Beheerders van alleen deze pagina (max. 3 namen per bedrijf), één query.
    const ids = rows.map((r) => r.id);
    const admins = ids.length
      ? (
          await pool.query(
            `SELECT company_id, id, email, first_name, last_name FROM (
               SELECT u.*, ROW_NUMBER() OVER (PARTITION BY u.company_id ORDER BY u.id) AS rn
               FROM dbo.users u WHERE u.company_id = ANY($1::int[]) AND u.role = 'company_admin' AND u.status <> 'deleted'
             ) x WHERE rn <= 3`,
            [ids]
          )
        ).rows
      : [];
    for (const row of rows) row.admins = admins.filter((a) => a.company_id === row.id).map(({ company_id, ...a }) => a);

    res.json(pageResult(rows, { page, pageSize }, total));
  } catch (error) {
    next(error);
  }
});

// --- niveau 3: gebruikers van één bedrijf (partner of klant) ---------------------------
const usersSchema = z.object({
  ...pageSchema,
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
});

const USER_COLUMNS = `u.id, u.email, u.first_name, u.last_name, u.role, u.status, u.company_id, u.created_at,
  (u.mfa_enabled_at IS NOT NULL) AS mfa_enabled,
  (SELECT MAX(a.timestamp) FROM dbo.auditlogs a WHERE a.user_id = u.id) AS last_activity`;

router.get("/companies/:id/users", validateQuery(usersSchema), async (req, res, next) => {
  try {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id)) throw new HttpError(404, "Niet gevonden");
    const { page, pageSize, role, status } = req.validatedQuery;
    const pool = await getPool();
    const company = (await pool.query("SELECT id FROM dbo.companies WHERE id = $1", [Number(req.params.id)])).rows[0];
    if (!company) throw new HttpError(404, "Niet gevonden");
    const params = [company.id];
    const where = ["u.company_id = $1", "u.status <> 'deleted'"];
    if (role) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    const total = Number((await pool.query(`SELECT COUNT(*) FROM dbo.users u WHERE ${where.join(" AND ")}`, params)).rows[0].count);
    params.push(pageSize, (page - 1) * pageSize);
    // Beheerders eerst, dan medewerkers; binnen een rol op naam. Laatste activiteit alleen
    // voor de rijen van deze pagina (index ix_auditlogs_user_timestamp).
    const rows = (
      await pool.query(
        `SELECT ${USER_COLUMNS} FROM dbo.users u WHERE ${where.join(" AND ")}
         ORDER BY CASE u.role WHEN 'partner_admin' THEN 0 WHEN 'company_admin' THEN 1 ELSE 2 END,
                  lower(coalesce(u.last_name, '') || coalesce(u.first_name, '') || u.email)
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
    ).rows;
    res.json(pageResult(rows, { page, pageSize }, total));
  } catch (error) {
    next(error);
  }
});

// --- top van de boom: Platform Owners (geen bedrijf) ---------------------------------------
router.get("/owners", validateQuery(z.object(pageSchema)), async (req, res, next) => {
  try {
    const { page, pageSize } = req.validatedQuery;
    const pool = await getPool();
    const where = "u.role = 'platform_owner' AND u.status <> 'deleted'";
    const total = Number((await pool.query(`SELECT COUNT(*) FROM dbo.users u WHERE ${where}`)).rows[0].count);
    const rows = (
      await pool.query(`SELECT ${USER_COLUMNS} FROM dbo.users u WHERE ${where} ORDER BY u.id LIMIT $1 OFFSET $2`, [
        pageSize,
        (page - 1) * pageSize
      ])
    ).rows;
    res.json(pageResult(rows, { page, pageSize }, total));
  } catch (error) {
    next(error);
  }
});

// --- zoeken over alle niveaus, met pad (partner › bedrijf) ---------------------------------
const searchSchema = z.object({
  ...pageSchema,
  q: z.string().trim().max(100).default(""),
  type: z.enum(["partner", "customer", "standalone", "user"]).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
});

router.get("/search", validateQuery(searchSchema), async (req, res, next) => {
  try {
    const { page, pageSize, q, type, role, status } = req.validatedQuery;
    const pool = await getPool();
    const params = [likePattern(q)];
    const match = (cols) => (q ? `(${cols.map((c) => `${c} ILIKE $1 ESCAPE '\\'`).join(" OR ")})` : "TRUE");

    // Organisaties (alleen als er geen rol gefilterd wordt: een rol hoort bij gebruikers).
    const orgParts = [];
    if (!role && type !== "user") {
      const kindFilter =
        type === "partner" ? "c.kind = 'partner'" : type === "customer" ? "c.kind = 'customer'" : type === "standalone" ? "c.kind = 'customer' AND c.partner_id IS NULL" : "TRUE";
      orgParts.push(`
        SELECT CASE WHEN c.kind = 'partner' THEN 'partner' ELSE 'customer' END AS kind, c.id, c.name AS title,
               c.slug AS subtitle, NULL::text AS role, c.status,
               c.id AS company_id, c.name AS company_name, c.kind AS company_kind,
               p.id AS partner_id, p.name AS partner_name, lower(c.name) AS sort_key
        FROM dbo.companies c LEFT JOIN dbo.companies p ON p.id = c.partner_id
        WHERE ${kindFilter} AND ${match(["c.name", "c.slug"])} ${status ? "AND c.status = $2" : ""}`);
    }
    // Gebruikers (met bedrijf en partner, zodat een resultaat diep in de boom vindbaar is).
    if (!type || type === "user" || role) {
      const userWhere = ["u.status <> 'deleted'", match(["u.email", "coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')", "c.name"])];
      if (status) userWhere.push("u.status = $2");
      if (role) userWhere.push(`u.role = $${status ? 3 : 2}`);
      if (type === "partner") userWhere.push("c.kind = 'partner'");
      if (type === "customer") userWhere.push("c.kind = 'customer'");
      if (type === "standalone") userWhere.push("c.kind = 'customer' AND c.partner_id IS NULL");
      orgParts.push(`
        SELECT 'user' AS kind, u.id, coalesce(nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''), u.email) AS title,
               u.email AS subtitle, u.role, u.status,
               c.id AS company_id, c.name AS company_name, c.kind AS company_kind,
               CASE WHEN c.kind = 'partner' THEN c.id ELSE p.id END AS partner_id,
               CASE WHEN c.kind = 'partner' THEN c.name ELSE p.name END AS partner_name,
               lower(u.email) AS sort_key
        FROM dbo.users u LEFT JOIN dbo.companies c ON c.id = u.company_id LEFT JOIN dbo.companies p ON p.id = c.partner_id
        WHERE ${userWhere.join(" AND ")}`);
    }
    if (status) params.push(status);
    if (role) params.push(role);
    if (!orgParts.length) {
      res.json(pageResult([], { page, pageSize }, 0));
      return;
    }
    const union = orgParts.join(" UNION ALL ");
    const total = Number((await pool.query(`SELECT COUNT(*) FROM (${union}) x`, params)).rows[0].count);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = (
      await pool.query(
        `SELECT * FROM (${union}) x
         ORDER BY CASE kind WHEN 'partner' THEN 0 WHEN 'customer' THEN 1 ELSE 2 END, sort_key
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
    ).rows.map(({ sort_key, ...r }) => r);
    res.json(pageResult(rows, { page, pageSize }, total));
  } catch (error) {
    next(error);
  }
});

// --- detailpaneel ----------------------------------------------------------------------
router.get("/companies/:id", async (req, res, next) => {
  try {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id)) throw new HttpError(404, "Niet gevonden");
    const pool = await getPool();
    const company = (
      await pool.query(
        `SELECT c.id, c.name, c.slug, c.status, c.kind, c.partner_id, c.created_at, c.license_start, c.license_end,
                p.name AS partner_name, pl.name AS plan_name, pl.max_users, pl.max_products,
                ${PRODUCT_COUNT}::int AS product_count,
                (SELECT COUNT(*) FROM dbo.users u WHERE u.company_id = c.id AND u.status <> 'deleted')::int AS user_count,
                (SELECT COUNT(*) FROM dbo.users u WHERE u.company_id = c.id AND u.status <> 'deleted' AND u.role = 'company_user')::int AS employee_count,
                (SELECT COUNT(*) FROM dbo.companies k WHERE k.partner_id = c.id AND k.kind = 'customer')::int AS customer_count,
                (SELECT COUNT(*) FROM dbo.users u JOIN dbo.companies k ON k.id = u.company_id
                  WHERE k.partner_id = c.id AND u.status <> 'deleted')::int AS customer_user_count,
                (SELECT MAX(a.timestamp) FROM dbo.auditlogs a WHERE a.company_id = c.id) AS last_activity
         FROM dbo.companies c
         LEFT JOIN dbo.companies p ON p.id = c.partner_id
         LEFT JOIN dbo.plans pl ON pl.id = c.plan_id
         WHERE c.id = $1`,
        [Number(req.params.id)]
      )
    ).rows[0];
    if (!company) throw new HttpError(404, "Niet gevonden");
    company.admins = (
      await pool.query(
        `SELECT id, email, first_name, last_name, role, status FROM dbo.users
         WHERE company_id = $1 AND role IN ('partner_admin', 'company_admin') AND status <> 'deleted' ORDER BY id LIMIT 20`,
        [company.id]
      )
    ).rows;
    res.json(company);
  } catch (error) {
    next(error);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id)) throw new HttpError(404, "Niet gevonden");
    const pool = await getPool();
    const user = (
      await pool.query(
        `SELECT ${USER_COLUMNS},
                (SELECT MAX(a.timestamp) FROM dbo.auditlogs a WHERE a.user_id = u.id AND a.action = 'login') AS last_login,
                c.name AS company_name, c.kind AS company_kind, c.status AS company_status,
                CASE WHEN c.kind = 'partner' THEN c.id ELSE p.id END AS partner_id,
                CASE WHEN c.kind = 'partner' THEN c.name ELSE p.name END AS partner_name
         FROM dbo.users u LEFT JOIN dbo.companies c ON c.id = u.company_id LEFT JOIN dbo.companies p ON p.id = c.partner_id
         WHERE u.id = $1 AND u.status <> 'deleted'`,
        [Number(req.params.id)]
      )
    ).rows[0];
    if (!user) throw new HttpError(404, "Niet gevonden");
    res.json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
