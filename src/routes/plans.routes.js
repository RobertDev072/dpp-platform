const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createPlanSchema, updatePlanSchema } = require("../schemas/plans.schema");
const plansRepo = require("../repositories/plans.repository");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requireRole(...require("../utils/roles").PLATFORM_OWNER_ROLES));

router.get("/", async (req, res, next) => {
  try {
    res.json(await plansRepo.listPlans());
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createPlanSchema), async (req, res, next) => {
  try {
    const plan = await plansRepo.createPlan(req.body);

    await logAudit({
      companyId: null,
      userId: req.user.id,
      action: "create",
      entityType: "Plan",
      entityId: plan.id
    });

    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

// Welke bedrijven gebruiken dit plan - elk met zijn EIGEN verbruik en status
// (limieten worden per bedrijf toegepast, nooit gedeeld of opgeteld).
router.get("/:id/companies", async (req, res, next) => {
  try {
    const planId = Number(req.params.id);
    const companiesRepo = require("../repositories/companies.repository");
    const { buildUsage } = require("../services/license.service");
    const rows = (await companiesRepo.listCompaniesWithStats()).filter((row) => row.plan_id === planId);
    res.json(
      rows.map((row) => ({
        companyId: row.id,
        name: row.name,
        ...buildUsage({
          plan: { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products },
          licenseStart: row.license_start,
          licenseEnd: row.license_end,
          usersUsed: row.active_user_count,
          productsUsed: row.product_count
        })
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const plan = await plansRepo.getPlanById(Number(req.params.id));
    if (!plan) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updatePlanSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await plansRepo.getPlanById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const updated = await plansRepo.updatePlan(id, req.body);

    await logAudit({
      companyId: null,
      userId: req.user.id,
      action: "update",
      entityType: "Plan",
      entityId: id,
      metadata: req.body
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
