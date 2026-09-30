const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createInviteSchema } = require("../schemas/invites.schema");
const companiesRepo = require("../repositories/companies.repository");
const plansRepo = require("../repositories/plans.repository");
const invitesRepo = require("../repositories/invites.repository");
const { buildUsage, getLicenseUsage } = require("../services/license.service");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { getAppBaseUrl } = require("../utils/baseUrl");

// Partnergebied: een Partner Admin beheert hier uitsluitend zijn eigen
// klantbedrijven (aanmaken, licentie-inzage, eerste-admin-uitnodiging). Nooit
// producten, documenten of gebruikerslijsten van klanten - die routes kennen de
// rol partner_admin simpelweg niet en geven dus 403.

const router = express.Router();

router.use(requireAuth, requireRole("partner_admin"));

// De rol is alleen geldig binnen een partnerbedrijf; mocht de bedrijfssoort ooit
// zijn omgezet terwijl er nog een sessie leeft, dan stopt de toegang hier alsnog.
router.use(async (req, res, next) => {
  try {
    const own = req.user.companyId != null ? await companiesRepo.getCompanyById(req.user.companyId) : null;
    if (!own || own.kind !== "partner") {
      next(new HttpError(403, "Geen toegang"));
      return;
    }
    req.partnerCompany = own;
    next();
  } catch (error) {
    next(error);
  }
});

// Eigendomscheck: het klantbedrijf moet bestaan én bij deze partner horen.
// Andermans klanten krijgen bewust 404 (niet bevestigen dat ze bestaan).
async function loadOwnedCustomer(req, next) {
  const customer = await companiesRepo.getCompanyById(Number(req.params.id));
  if (!customer || customer.kind !== "customer" || customer.partner_id !== req.user.companyId) {
    next(new HttpError(404, "Niet gevonden"));
    return null;
  }
  return customer;
}

function usageFromRow(row) {
  return buildUsage({
    plan: row.plan_id
      ? { id: row.plan_id, name: row.plan_name, max_users: row.max_users, max_products: row.max_products }
      : null,
    licenseStart: row.license_start,
    licenseEnd: row.license_end,
    usersUsed: row.active_user_count,
    productsUsed: row.product_count
  });
}

router.get("/customers", async (req, res, next) => {
  try {
    const rows = await companiesRepo.listCompaniesWithStats({ partnerId: req.user.companyId });
    res.json(
      // buildUsage levert zelf een 'status' (licentiestatus); de bedrijfsstatus
      // gaat daarom apart mee als companyStatus.
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        companyStatus: row.status,
        createdAt: row.created_at,
        ...usageFromRow(row)
      }))
    );
  } catch (error) {
    next(error);
  }
});

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(slugPattern, "Alleen kleine letters, cijfers en koppeltekens"),
  planId: z.number().int().positive(),
  licenseStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD").nullable().optional(),
  licenseEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD").nullable().optional()
});

router.post("/customers", validateBody(createCustomerSchema), async (req, res, next) => {
  try {
    const plan = await plansRepo.getPlanById(req.body.planId);
    if (!plan || !plan.partner_assignable) {
      next(
        new HttpError(400, "Ongeldige invoer", {
          formErrors: [],
          fieldErrors: { planId: ["Dit plan is niet beschikbaar voor partners"] }
        })
      );
      return;
    }

    // kind en partner_id staan hier bewust vast: een partner maakt altijd een
    // klanttenant aan die aan zichzelf gekoppeld is - nooit een andere partner.
    const company = await companiesRepo.createCompany({
      name: req.body.name,
      slug: req.body.slug,
      planId: req.body.planId,
      kind: "customer",
      partnerId: req.user.companyId,
      licenseStart: req.body.licenseStart ?? null,
      licenseEnd: req.body.licenseEnd ?? null
    });

    await logAudit({
      companyId: company.id,
      userId: req.user.id,
      action: "create",
      entityType: "Company",
      entityId: company.id,
      metadata: { via: "partner", partnerId: req.user.companyId }
    });

    res.status(201).json(company);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      next(new HttpError(409, "Slug is al in gebruik"));
      return;
    }
    next(error);
  }
});

// Alleen plannen die de Platform Owner voor partners heeft opengesteld.
router.get("/plans", async (req, res, next) => {
  try {
    const plans = await plansRepo.listPlans();
    res.json(plans.filter((plan) => plan.partner_assignable));
  } catch (error) {
    next(error);
  }
});

router.get("/customers/:id/license", async (req, res, next) => {
  try {
    const customer = await loadOwnedCustomer(req, next);
    if (!customer) return;
    res.json({ companyId: customer.id, name: customer.name, ...(await getLicenseUsage(customer.id)) });
  } catch (error) {
    next(error);
  }
});

router.get("/customers/:id/invites", async (req, res, next) => {
  try {
    const customer = await loadOwnedCustomer(req, next);
    if (!customer) return;
    res.json(await invitesRepo.listInvitesForCompany(customer.id));
  } catch (error) {
    next(error);
  }
});

router.post("/customers/:id/invites", validateBody(createInviteSchema), async (req, res, next) => {
  try {
    const customer = await loadOwnedCustomer(req, next);
    if (!customer) return;

    const { invite, token } = await invitesRepo.createInvite({
      companyId: customer.id,
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      invitedBy: req.user.id
    });

    await logAudit({
      companyId: customer.id,
      userId: req.user.id,
      action: "invite_created",
      entityType: "CompanyAdminInvite",
      entityId: invite.id,
      metadata: { via: "partner" }
    });

    // Token zit alleen in dít antwoord - wordt nergens anders (log, DB) in plaintext bewaard.
    const activationUrl = `${getAppBaseUrl(req)}/activate?token=${token}`;
    res.status(201).json({ ...invite, activationUrl });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      next(new HttpError(409, "Er is al een openstaande uitnodiging voor dit e-mailadres"));
      return;
    }
    next(error);
  }
});

router.post("/customers/:id/invites/:inviteId/revoke", async (req, res, next) => {
  try {
    const customer = await loadOwnedCustomer(req, next);
    if (!customer) return;

    const invite = await invitesRepo.getInviteById(Number(req.params.inviteId));
    if (!invite || invite.company_id !== customer.id) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const revoked = await invitesRepo.revokeInvite(invite.id);
    if (!revoked) {
      next(new HttpError(409, "Uitnodiging is al gebruikt of ingetrokken"));
      return;
    }

    await logAudit({
      companyId: customer.id,
      userId: req.user.id,
      action: "invite_revoked",
      entityType: "CompanyAdminInvite",
      entityId: invite.id,
      metadata: { via: "partner" }
    });

    res.json(revoked);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
