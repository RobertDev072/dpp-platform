const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { updateOwnCompanySchema, companyAuditQuerySchema } = require("../schemas/company.schema");
const insightsRepo = require("../repositories/companyInsights.repository");
const { getSeatUsage } = require("../services/seats.service");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { PERMISSIONS, hasPermission } = require("../auth/permissions");

// "Eigen company": de company komt hier ALTIJD uit de sessie (req.user.companyId), nooit
// uit de URL, body of query. Daardoor bestaat er geen id om cross-tenant mee te proberen.
// De System Owner heeft geen van deze permissies (en geen company) en krijgt dus 403.
const router = express.Router();

router.use(requireAuth);

function ownCompanyId(req) {
  const companyId = req.user.companyId;
  if (companyId == null) {
    // Kan alleen bij een rol zonder company; die heeft deze permissies niet, maar we
    // vertrouwen niet blind op de permissietabel.
    throw new HttpError(404, "Niet gevonden");
  }
  return companyId;
}

function toSeats(usage) {
  return {
    maxUsers: usage ? usage.maxUsers : null,
    activeUsers: usage ? usage.activeUsers : 0,
    remainingSeats: usage ? usage.remainingSeats : null
  };
}

async function buildCompanyProfile(companyId) {
  const [company, usage] = await Promise.all([
    insightsRepo.getCompanyProfile(companyId),
    getSeatUsage(companyId)
  ]);
  if (!company) {
    throw new HttpError(404, "Niet gevonden");
  }
  return {
    id: company.id,
    name: company.name,
    kvk_number: company.kvk_number,
    country: company.country,
    address: company.address,
    contact_name: company.contact_name,
    contact_email: company.contact_email,
    status: company.status,
    plan: company.plan_id != null ? { id: company.plan_id, name: company.plan_name } : null,
    seats: toSeats(usage)
  };
}

router.get("/", requirePermission(PERMISSIONS.COMPANY_DASHBOARD), async (req, res, next) => {
  try {
    res.json(await buildCompanyProfile(ownCompanyId(req)));
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/",
  requirePermission(PERMISSIONS.COMPANY_SETTINGS),
  validateBody(updateOwnCompanySchema),
  async (req, res, next) => {
    try {
      const companyId = ownCompanyId(req);
      const updated = await insightsRepo.updateCompanySettings(companyId, req.body);
      if (!updated) {
        throw new HttpError(404, "Niet gevonden");
      }

      // Alleen de veldnamen loggen, niet de waarden (contactgegevens = persoonsgegevens).
      await logAudit({
        companyId,
        userId: req.user.id,
        action: "update",
        entityType: "Company",
        entityId: companyId,
        metadata: { fields: Object.keys(req.body).filter((key) => req.body[key] !== undefined) }
      });

      res.json(await buildCompanyProfile(companyId));
    } catch (error) {
      next(error);
    }
  }
);

router.get("/dashboard", requirePermission(PERMISSIONS.COMPANY_DASHBOARD), async (req, res, next) => {
  try {
    const companyId = ownCompanyId(req);
    // Recente activiteit is audit-data: alleen voor wie company:audit heeft (Company Admin).
    const canSeeAudit = hasPermission(req.user, PERMISSIONS.COMPANY_AUDIT);

    const [users, usage, products, scans, activity] = await Promise.all([
      insightsRepo.getUserCounts(companyId),
      getSeatUsage(companyId),
      insightsRepo.getProductCounts(companyId),
      insightsRepo.getScanCounts(companyId),
      canSeeAudit ? insightsRepo.listCompanyAudit(companyId, { limit: 10, offset: 0 }) : null
    ]);

    res.json({
      users,
      seats: toSeats(usage),
      products,
      scans,
      recentActivity: activity ? activity.items : []
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports", requirePermission(PERMISSIONS.REPORTS_READ), async (req, res, next) => {
  try {
    const companyId = ownCompanyId(req);
    const [productsByStatus, productsByCategory, scansByDay, topProducts, incomplete] = await Promise.all([
      insightsRepo.getProductsByStatus(companyId),
      insightsRepo.getProductsByCategory(companyId),
      insightsRepo.getScansByDay(companyId, 30),
      insightsRepo.getTopProducts(companyId, 10),
      insightsRepo.getIncompleteProducts(companyId, 100)
    ]);

    res.json({ productsByStatus, productsByCategory, scansByDay, topProducts, incomplete });
  } catch (error) {
    next(error);
  }
});

router.get("/audit", requirePermission(PERMISSIONS.COMPANY_AUDIT), async (req, res, next) => {
  try {
    const companyId = ownCompanyId(req);
    const parsed = companyAuditQuerySchema.safeParse({
      limit: req.query.limit,
      offset: req.query.offset,
      action: req.query.action
    });
    if (!parsed.success) {
      throw new HttpError(400, "Ongeldige invoer", parsed.error.flatten());
    }

    res.set("Cache-Control", "no-store");
    res.json(await insightsRepo.listCompanyAudit(companyId, parsed.data));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
