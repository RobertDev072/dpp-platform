const express = require("express");
const { requireAuth } = require("../middleware/auth");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const productsRepo = require("../repositories/products.repository");
const plansRepo = require("../repositories/plans.repository");

const router = express.Router();

router.get("/stats", requireAuth, async (req, res, next) => {
  try {
    if (require("../utils/roles").isPlatformOwner(req.user.role)) {
      const scanEventsRepo = require("../repositories/scanEvents.repository");
      const invitesRepo = require("../repositories/invites.repository");
      const { buildUsage, STATUS } = require("../services/license.service");

      const [companies, activeCompanies, activeUsers, products, qrScans, pendingInvites, companyRows] =
        await Promise.all([
          companiesRepo.countCompanies(),
          companiesRepo.countActiveCompanies(),
          usersRepo.countAllActiveUsers(),
          productsRepo.countProductsByStatus(),
          scanEventsRepo.countScanEvents(),
          invitesRepo.countPendingInvites(),
          companiesRepo.listCompaniesWithStats()
        ]);

      // Licenties die aandacht vragen: alles behalve "Actief" (per bedrijf berekend).
      const licenseAlerts = companyRows
        .map((row) => ({
          companyId: row.id,
          name: row.name,
          ...buildUsage({
            plan: row.plan_id
              ? { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products }
              : null,
            licenseStart: row.license_start,
            licenseEnd: row.license_end,
            usersUsed: row.active_user_count,
            productsUsed: row.product_count
          })
        }))
        .filter((entry) => entry.status !== STATUS.ACTIVE);

      res.json({
        scope: "platform",
        companies,
        activeCompanies,
        activeUsers,
        products,
        qrScans,
        pendingInvites,
        licenseAlerts
      });
      return;
    }

    if (req.user.role === "partner_admin") {
      const { buildUsage, STATUS } = require("../services/license.service");
      const [rows, company] = await Promise.all([
        companiesRepo.listCompaniesWithStats({ partnerId: req.user.companyId }),
        companiesRepo.getCompanyById(req.user.companyId)
      ]);

      // Let op: buildUsage levert óók een 'status' (licentiestatus); de
      // bedrijfsstatus gaat daarom apart mee als companyStatus.
      const customers = rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        companyStatus: row.status,
        ...buildUsage({
          plan: row.plan_id
            ? { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products }
            : null,
          licenseStart: row.license_start,
          licenseEnd: row.license_end,
          usersUsed: row.active_user_count,
          productsUsed: row.product_count
        })
      }));

      // Alleen totalen over de eigen klanten (geen product- of scandetails: het
      // partnergebied toont bewust geen klantinhoud).
      const { getPool, sql } = require("../config/db");
      const pool = await getPool();
      const scanRow = (
        await pool
          .request()
          .input("partnerId", sql.Int, req.user.companyId)
          .query(`
            SELECT COUNT(*) AS n FROM dbo.ScanEvents s
            JOIN dbo.Products p ON p.id = s.product_id
            JOIN dbo.Companies c ON c.id = p.company_id
            WHERE c.partner_id = @partnerId AND s.scanned_at >= now() - interval '30 days'
          `)
      ).recordset[0];

      res.json({
        scope: "partner",
        companyName: company ? company.name : null,
        customers,
        totals: {
          products: customers.reduce((sum, c) => sum + (c.products?.used || 0), 0),
          scans30Days: scanRow.n,
          customers: customers.length,
          active: customers.filter((c) => c.status === STATUS.ACTIVE).length,
          nearLimit: customers.filter((c) => c.status === STATUS.NEAR_LIMIT || c.status === STATUS.LIMIT_REACHED).length,
          expired: customers.filter((c) => c.status === STATUS.EXPIRED).length
        }
      });
      return;
    }

    const [activeUsers, products, company, maxUsers] = await Promise.all([
      usersRepo.countActiveUsers(req.user.companyId),
      productsRepo.countProductsByStatus({ companyId: req.user.companyId }),
      companiesRepo.getCompanyById(req.user.companyId),
      plansRepo.getMaxUsersForCompany(req.user.companyId)
    ]);

    const plan = company && company.plan_id ? await plansRepo.getPlanById(company.plan_id) : null;
    const [license, qrScans] = await Promise.all([
      require("../services/license.service").getLicenseUsage(req.user.companyId),
      require("../repositories/scanEvents.repository").countScanEvents({ companyId: req.user.companyId })
    ]);

    res.json({
      scope: "company",
      activeUsers,
      products,
      qrScans,
      companyName: company ? company.name : null,
      planName: plan ? plan.name : null,
      maxUsers,
      license
    });
  } catch (error) {
    next(error);
  }
});

// Bedrijfsdashboard in één request: KPI's, grafiekdata, acties, onboarding en
// recente producten. Alleen voor gebruikers van een klantbedrijf; het bedrijf komt
// uit de sessie.
router.get("/overview", requireAuth, async (req, res, next) => {
  try {
    if (!["company_admin", "company_user"].includes(req.user.role) || req.user.companyId == null) {
      next(new (require("../middleware/errorHandler").HttpError)(403, "Geen toegang"));
      return;
    }
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const overview = await require("../services/insights.service").getCompanyOverview(req.user.companyId, { days });
    res.json({ ...overview, user: { firstName: req.user.firstName, role: req.user.role } });
  } catch (error) {
    next(error);
  }
});

// Meldingen voor het belletje in de kop. Per rol berekend uit bestaande data.
router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const { buildUsage, STATUS } = require("../services/license.service");
    const user = req.user;
    let items = [];

    if (["company_admin", "company_user"].includes(user.role) && user.companyId != null) {
      items = await require("../services/insights.service").getCompanyNotifications(user.companyId);
      if (user.role !== "company_admin") {
        // Abonnementsmeldingen linken naar een beheerpagina die alleen de beheerder ziet.
        items = items.map((item) => (item.id.startsWith("license:") ? { ...item, href: null } : item));
      }
    } else if (require("../utils/roles").isPlatformOwner(user.role) || user.role === "partner_admin") {
      const rows = await companiesRepo.listCompaniesWithStats(user.role === "partner_admin" ? { partnerId: user.companyId } : {});
      const base = user.role === "partner_admin" ? "/partner/klanten" : "/admin/companies";
      for (const row of rows) {
        if (row.kind === "partner" || row.status !== "active") continue;
        const usage = buildUsage({
          plan: row.plan_id ? { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products } : null,
          licenseStart: row.license_start,
          licenseEnd: row.license_end,
          usersUsed: row.active_user_count,
          productsUsed: row.product_count
        });
        if (usage.status === STATUS.ACTIVE) continue;
        items.push({
          id: `license:${row.id}:${usage.status}`,
          severity: usage.status === STATUS.NEAR_LIMIT ? "warning" : "error",
          title: `${row.name}: ${usage.status.toLowerCase()}`,
          description: `Producten ${usage.products.used}/${usage.products.max ?? "∞"} · gebruikers ${usage.users.used}/${usage.users.max ?? "∞"}`,
          href: `${base}/${row.id}`
        });
      }
    }

    res.json({ items: items.slice(0, 30) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
