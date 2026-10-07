const express = require("express");
const { requireAuth } = require("../middleware/auth");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const productsRepo = require("../repositories/products.repository");
const plansRepo = require("../repositories/plans.repository");
const { HttpError } = require("../middleware/errorHandler");

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

      res.json({
        scope: "partner",
        companyName: company ? company.name : null,
        customers,
        totals: {
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

// Uitgebreid bedrijfsdashboard (KPI's met trend, scans-reeks, acties nodig, recente
// producten, onboarding). Alleen voor gebruikers van een bedrijf; altijd het eigen
// bedrijf uit de sessie.
router.get("/overview", requireAuth, async (req, res, next) => {
  try {
    if (!["company_admin", "company_user"].includes(req.user.role) || req.user.companyId == null) {
      next(new HttpError(403, "Geen toegang"));
      return;
    }
    const insights = require("../repositories/productInsights.repository");
    const { getLicenseUsage } = require("../services/license.service");
    const [overview, license, company] = await Promise.all([
      insights.getCompanyOverview(req.user.companyId),
      getLicenseUsage(req.user.companyId),
      companiesRepo.getCompanyById(req.user.companyId)
    ]);
    res.json({
      firstName: req.user.firstName || null,
      companyName: company ? company.name : null,
      license,
      ...overview
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
