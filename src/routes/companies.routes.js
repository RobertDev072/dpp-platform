const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/permissions");
const { validateBody } = require("../middleware/validate");
const { noStore } = require("../middleware/securityHeaders");
const { createCompanySchema, updateCompanySchema } = require("../schemas/companies.schema");
const { createInvitationSchema } = require("../schemas/invitations.schema");
const companiesRepo = require("../repositories/companies.repository");
const plansRepo = require("../repositories/plans.repository");
const invitationsRepo = require("../repositories/invitations.repository");
const invitationService = require("../services/invitation.service");
const { getSeatUsage } = require("../services/seats.service");
const { logAudit } = require("../utils/auditLog");
const { parseId } = require("../utils/params");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

function isUniqueViolation(error) {
  return error.number === 2627 || error.number === 2601;
}

function slugInUseError() {
  return new HttpError(409, "Slug is al in gebruik", undefined, "SLUG_IN_USE");
}

async function assertPlanExists(planId) {
  if (planId == null) return;
  if (!(await plansRepo.getPlanById(planId))) {
    throw new HttpError(400, "Onbekend plan", { fieldErrors: { planId: ["Plan bestaat niet"] } }, "PLAN_NOT_FOUND");
  }
}

// Veld (API) -> kolom in de company-rij, om te bepalen wat er echt verandert.
const FIELD_TO_COLUMN = {
  name: "name",
  slug: "slug",
  status: "status",
  planId: "plan_id",
  kvkNumber: "kvk_number",
  country: "country",
  address: "address",
  contactName: "contact_name",
  contactEmail: "contact_email",
  maxUsers: "max_users"
};

// Deze velden krijgen een eigen audit-actie; de rest valt onder 'update'.
const DEDICATED_AUDIT_FIELDS = ["status", "planId", "maxUsers"];

function changedFields(existing, body) {
  return Object.keys(FIELD_TO_COLUMN).filter(
    (field) => body[field] !== undefined && (existing[FIELD_TO_COLUMN[field]] ?? null) !== (body[field] ?? null)
  );
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await companiesRepo.listCompanies());
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createCompanySchema), async (req, res, next) => {
  try {
    await assertPlanExists(req.body.planId);

    const derivedSlug = req.body.slug === undefined;
    let slug = derivedSlug ? await companiesRepo.generateUniqueSlug(req.body.name) : req.body.slug;

    let company;
    try {
      company = await companiesRepo.createCompany({ ...req.body, slug });
    } catch (error) {
      // Afgeleide slug net door een gelijktijdige aanvraag ingenomen: één keer opnieuw met
      // een willekeurig achtervoegsel. Een expliciet gekozen slug geeft gewoon een 409.
      if (!derivedSlug || !isUniqueViolation(error)) throw error;
      slug = `${companiesRepo.slugify(req.body.name)}-${Math.random().toString(36).slice(2, 8)}`;
      company = await companiesRepo.createCompany({ ...req.body, slug });
    }

    await logAudit({
      companyId: company.id,
      userId: req.user.id,
      action: "create",
      entityType: "Company",
      entityId: company.id,
      metadata: { slug: company.slug, status: company.status, planId: company.plan_id, maxUsers: company.max_users }
    });

    res.status(201).json(company);
  } catch (error) {
    if (isUniqueViolation(error)) {
      next(slugInUseError());
      return;
    }
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const company = await companiesRepo.getCompanyById(id);
    if (!company) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const [seats, admins, invitations] = await Promise.all([
      getSeatUsage(id),
      companiesRepo.listCompanyAdmins(id),
      invitationsRepo.listInvitations({ companyId: id })
    ]);

    res.json({ ...company, seats, admins, invitations });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updateCompanySchema), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const existing = await companiesRepo.getCompanyById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const changes = changedFields(existing, req.body);
    if (changes.includes("planId")) {
      await assertPlanExists(req.body.planId);
    }

    const updated = await companiesRepo.updateCompany(id, req.body);
    if (!updated) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const audit = (action, metadata) =>
      logAudit({ companyId: id, userId: req.user.id, action, entityType: "Company", entityId: id, metadata });

    if (changes.includes("status")) {
      const from = existing.status;
      const to = updated.status;
      if (from === "active") {
        // Sessies van alle gebruikers van dit bedrijf direct intrekken (zie revokeCompanySessions).
        await companiesRepo.revokeCompanySessions(id);
      }
      await audit(to === "active" ? "activate" : "deactivate", { from, to });
    }
    if (changes.includes("planId")) {
      await audit("plan_change", { from: existing.plan_id, to: updated.plan_id });
    }
    if (changes.includes("maxUsers")) {
      await audit("seat_limit_change", { from: existing.max_users, to: updated.max_users });
    }

    // Alleen veldnamen, geen waarden: contactgegevens horen niet dubbel in de audit log.
    const otherChanges = changes.filter((field) => !DEDICATED_AUDIT_FIELDS.includes(field));
    if (otherChanges.length > 0) {
      await audit("update", { fields: otherChanges });
    }

    res.json(updated);
  } catch (error) {
    if (isUniqueViolation(error)) {
      next(slugInUseError());
      return;
    }
    next(error);
  }
});

router.get("/:id/invitations", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await companiesRepo.getCompanyById(id))) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(await invitationsRepo.listInvitations({ companyId: id }));
  } catch (error) {
    next(error);
  }
});

// no-store: de response bevat de activatielink (met token) precies één keer.
router.post("/:id/invitations", noStore, validateBody(createInvitationSchema), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    res.status(201).json(await invitationService.createInvitation(req, id, req.body));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
