const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { queryRows, queryOne } = require("../config/db");
const { isPlatformOwner } = require("../utils/roles");
const insights = require("../repositories/productInsights.repository");
const { getLicenseUsage, STATUS } = require("../services/license.service");

const router = express.Router();

// Meldingencentrum en globale zoekfunctie in de header. Alles is rolbewust en
// tenant-scoped: een gebruiker ziet alleen meldingen en zoekresultaten van zijn
// eigen bedrijf; een partner alleen van eigen klanten; alleen de Platform Owner
// zoekt (expliciet) over bedrijven heen.
router.use(requireAuth);

function escapeLike(value) {
  return `%${String(value).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function plural(n, one, many) {
  return `${n.toLocaleString("nl-NL")} ${n === 1 ? one : many}`;
}

async function companyNotifications(user) {
  const companyId = user.companyId;
  const [summary, imports, license] = await Promise.all([
    queryOne(
      `SELECT
         COUNT(*) FILTER (WHERE p.status <> 'archived' AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.product_id = p.id AND d.archived_at IS NULL)) AS missing_documents,
         COUNT(*) FILTER (WHERE p.status = 'draft') AS drafts,
         COUNT(*) FILTER (WHERE p.status = 'draft' AND p.public_id IS NOT NULL) AS reserved_qr
       FROM products p WHERE p.company_id = $1`,
      [companyId]
    ),
    queryRows(
      `SELECT id, file_name, status, created_count, updated_count, error_count, finished_at
       FROM import_jobs WHERE company_id = $1 AND finished_at >= now() - interval '7 days'
       ORDER BY finished_at DESC LIMIT 5`,
      [companyId]
    ),
    getLicenseUsage(companyId)
  ]);
  const overview = await insights.getCompanyOverview(companyId);
  const s = overview.summary;
  const items = [];

  if (license && license.status !== STATUS.ACTIVE) {
    items.push({
      id: `license-${license.status}`,
      severity: license.status === STATUS.NEAR_LIMIT ? "warning" : "danger",
      title: license.status === STATUS.EXPIRED ? "Abonnement verlopen" : `Abonnement: ${license.status.toLowerCase()}`,
      description: `Producten ${license.products.used}${license.products.max != null ? ` / ${license.products.max}` : ""}, gebruikers ${license.users.used}${license.users.max != null ? ` / ${license.users.max}` : ""}.`,
      href: user.role === "company_admin" ? "/company/abonnement" : null
    });
  }
  if (s.incomplete > 0) {
    items.push({
      id: `incomplete-${s.incomplete}`,
      severity: "warning",
      title: `${plural(s.incomplete, "product is", "producten zijn")} incompleet`,
      description: "Vul de ontbrekende gegevens aan voordat je publiceert.",
      href: "/company/products?doc=incompleet"
    });
  }
  if (summary.missing_documents > 0) {
    items.push({
      id: `missing-docs-${summary.missing_documents}`,
      severity: "info",
      title: `${plural(summary.missing_documents, "product mist", "producten missen")} documenten`,
      description: "Voeg bijvoorbeeld een handleiding of certificaat toe.",
      href: "/company/documenten"
    });
  }
  const docs = overview.documents || {};
  if (Number(docs.expired) > 0) {
    items.push({
      id: `docs-expired-${docs.expired}`,
      severity: "danger",
      title: `${plural(Number(docs.expired), "document is", "documenten zijn")} verlopen`,
      description: "Upload een nieuwe versie of archiveer het verlopen document.",
      href: "/company/documenten?expiry=expired"
    });
  }
  if (Number(docs.expiring) > 0) {
    items.push({
      id: `docs-expiring-${docs.expiring}`,
      severity: "warning",
      title: `${plural(Number(docs.expiring), "document verloopt", "documenten verlopen")} binnen 30 dagen`,
      description: "Zorg op tijd voor een nieuwe versie.",
      href: "/company/documenten?expiry=expiring"
    });
  }
  if (s.ready_to_publish > 0) {
    items.push({
      id: `ready-${s.ready_to_publish}`,
      severity: "success",
      title: `${plural(s.ready_to_publish, "product is", "producten zijn")} klaar om te publiceren`,
      description: "100% compleet maar nog concept.",
      href: "/company/products?status=draft&doc=compleet"
    });
  }
  for (const job of imports) {
    items.push({
      id: `import-${job.id}`,
      severity: job.error_count > 0 ? "warning" : "success",
      title: job.status === "cancelled" ? `Import afgebroken: ${job.file_name}` : `Import voltooid: ${job.file_name}`,
      description: `${job.created_count} toegevoegd, ${job.updated_count} bijgewerkt${job.error_count ? `, ${job.error_count} met fouten` : ""}.`,
      href: `/company/imports?job=${job.id}`,
      createdAt: job.finished_at
    });
  }
  return items;
}

async function partnerNotifications(user) {
  const rows = await queryRows("SELECT id, name FROM companies WHERE partner_id = $1 AND kind = 'customer'", [user.companyId]);
  const items = [];
  for (const row of rows) {
    const usage = await getLicenseUsage(row.id);
    if (usage && usage.status !== STATUS.ACTIVE) {
      items.push({
        id: `license-${row.id}-${usage.status}`,
        severity: usage.status === STATUS.NEAR_LIMIT ? "warning" : "danger",
        title: `${row.name}: ${usage.status.toLowerCase()}`,
        description: "Bekijk de licentie van deze klant.",
        href: `/partner/klanten/${row.id}`
      });
    }
  }
  return items;
}

async function ownerNotifications() {
  const companiesRepo = require("../repositories/companies.repository");
  const { buildUsage } = require("../services/license.service");
  const rows = await companiesRepo.listCompaniesWithStats({ kind: "customer" });
  return rows
    .map((row) => ({
      row,
      usage: buildUsage({
        plan: row.plan_id ? { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products } : null,
        licenseStart: row.license_start,
        licenseEnd: row.license_end,
        usersUsed: row.active_user_count,
        productsUsed: row.product_count
      })
    }))
    .filter(({ usage }) => usage.status !== STATUS.ACTIVE)
    .map(({ row, usage }) => ({
      id: `license-${row.id}-${usage.status}`,
      severity: usage.status === STATUS.NEAR_LIMIT ? "warning" : "danger",
      title: `${row.name}: ${usage.status.toLowerCase()}`,
      description: "Licentie vraagt aandacht.",
      href: "/admin/licenses"
    }));
}

router.get("/notifications", async (req, res, next) => {
  try {
    let items = [];
    if (isPlatformOwner(req.user.role)) items = await ownerNotifications();
    else if (req.user.role === "partner_admin") items = await partnerNotifications(req.user);
    else if (req.user.companyId != null) items = await companyNotifications(req.user);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100);
    if (q.length < 2) {
      res.json({ q, groups: [] });
      return;
    }
    const like = escapeLike(q);
    const groups = [];

    if (isPlatformOwner(req.user.role)) {
      const [companies, users, products] = await Promise.all([
        queryRows(`SELECT id, name, kind FROM companies WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY name LIMIT 6`, [like]),
        queryRows(
          `SELECT u.id, u.email, u.first_name, u.last_name, c.name AS company_name FROM users u
           LEFT JOIN companies c ON c.id = u.company_id
           WHERE u.status <> 'deleted' AND (u.email ILIKE $1 OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $1)
           ORDER BY u.email LIMIT 6`,
          [like]
        ),
        queryRows(
          `SELECT p.id, p.name, p.sku, c.name AS company_name FROM products p JOIN companies c ON c.id = p.company_id
           WHERE p.name ILIKE $1 OR p.sku ILIKE $1 OR p.gtin ILIKE $1 ORDER BY p.updated_at DESC LIMIT 6`,
          [like]
        )
      ]);
      groups.push({
        type: "companies",
        label: "Bedrijven",
        items: companies.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: c.kind === "partner" ? "Partner" : "Klantbedrijf",
          href: `/admin/companies/${c.id}`
        }))
      });
      groups.push({
        type: "users",
        label: "Gebruikers",
        items: users.map((u) => ({
          id: u.id,
          title: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
          subtitle: [u.email, u.company_name].filter(Boolean).join(" · "),
          href: `/admin/users?q=${encodeURIComponent(u.email)}`
        }))
      });
      groups.push({
        type: "products",
        label: "Producten",
        items: products.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku, p.company_name].filter(Boolean).join(" · "),
          href: `/admin/products?q=${encodeURIComponent(p.sku || p.name)}`
        }))
      });
    } else if (req.user.role === "partner_admin") {
      const customers = await queryRows(
        `SELECT id, name FROM companies WHERE partner_id = $1 AND (name ILIKE $2 OR slug ILIKE $2) ORDER BY name LIMIT 8`,
        [req.user.companyId, like]
      );
      groups.push({
        type: "companies",
        label: "Klanten",
        items: customers.map((c) => ({ id: c.id, title: c.name, href: `/partner/klanten/${c.id}` }))
      });
    } else if (req.user.companyId != null) {
      const { products, documents } = await insights.searchCompany(req.user.companyId, q);
      groups.push({
        type: "products",
        label: "Producten",
        items: products.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku && `SKU ${p.sku}`, p.gtin && `GTIN ${p.gtin}`].filter(Boolean).join(" · "),
          href: `/company/products/${p.id}`
        }))
      });
      groups.push({
        type: "documents",
        label: "Documenten",
        items: documents.map((d) => ({
          id: d.id,
          title: d.title,
          subtitle: d.product_name,
          href: `/company/products/${d.product_id}?tab=documents`
        }))
      });
      if (req.user.role === "company_admin") {
        const users = await queryRows(
          `SELECT id, email, first_name, last_name FROM users
           WHERE company_id = $1 AND status <> 'deleted'
             AND (email ILIKE $2 OR (first_name || ' ' || COALESCE(last_name, '')) ILIKE $2)
           ORDER BY email LIMIT 6`,
          [req.user.companyId, like]
        );
        groups.push({
          type: "users",
          label: "Medewerkers",
          items: users.map((u) => ({
            id: u.id,
            title: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
            subtitle: u.email,
            href: "/company/organisatie"
          }))
        });
      }
    }

    res.json({ q, groups: groups.filter((g) => g.items.length) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
