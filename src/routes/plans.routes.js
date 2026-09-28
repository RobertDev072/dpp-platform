const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/permissions");
const { validateBody } = require("../middleware/validate");
const { createPlanSchema, updatePlanSchema } = require("../schemas/plans.schema");
const plansRepo = require("../repositories/plans.repository");
const { logAudit } = require("../utils/auditLog");
const { parseId } = require("../utils/params");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

// Veld (API) -> kolom, voor de from/to-diff in de audit log. Plangegevens zijn geen
// persoonsgegevens, dus de waarden mogen erin.
const FIELD_TO_COLUMN = {
  name: "name",
  description: "description",
  maxUsers: "max_users",
  maxProducts: "max_products",
  isActive: "is_active"
};

function planNameInUseError() {
  return new HttpError(409, "Er bestaat al een plan met deze naam", undefined, "PLAN_NAME_IN_USE");
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await plansRepo.listPlans());
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createPlanSchema), async (req, res, next) => {
  try {
    if (await plansRepo.getPlanByName(req.body.name)) {
      next(planNameInUseError());
      return;
    }

    const plan = await plansRepo.createPlan(req.body);

    await logAudit({
      userId: req.user.id,
      action: "create",
      entityType: "Plan",
      entityId: plan.id,
      metadata: { name: plan.name, maxUsers: plan.max_users, maxProducts: plan.max_products, isActive: plan.is_active }
    });

    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

// Geen DELETE: companies verwijzen via een FK naar hun plan. Uitfaseren = isActive: false.
router.patch("/:id", validateBody(updatePlanSchema), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const existing = await plansRepo.getPlanById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (req.body.name !== undefined) {
      const sameName = await plansRepo.getPlanByName(req.body.name);
      if (sameName && sameName.id !== id) {
        next(planNameInUseError());
        return;
      }
    }

    const updated = await plansRepo.updatePlan(id, req.body);
    if (!updated) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const changes = {};
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (req.body[field] !== undefined && (existing[column] ?? null) !== (updated[column] ?? null)) {
        changes[field] = { from: existing[column], to: updated[column] };
      }
    }

    if (Object.keys(changes).length > 0) {
      // maxUsers raakt de effectieve seat-limiet van elke company op dit plan; company_count
      // in de metadata maakt achteraf zichtbaar hoeveel bedrijven dat waren.
      await logAudit({
        userId: req.user.id,
        action: "update",
        entityType: "Plan",
        entityId: id,
        metadata: { changes, companyCount: updated.company_count }
      });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
