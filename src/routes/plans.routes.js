const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createPlanSchema, updatePlanSchema } = require("../schemas/plans.schema");
const plansRepo = require("../repositories/plans.repository");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requireRole("system_owner"));

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
