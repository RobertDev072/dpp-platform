const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const companiesRepo = require("../repositories/companies.repository");
const documentsRepo = require("../repositories/documents.repository");
const { logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

// Zelfbediening voor het EIGEN bedrijf (company_admin): bedrijfsprofiel + logo en
// het documentenoverzicht. Bewust gescheiden van /api/admin/companies (Platform
// Owner-beheer over alle bedrijven).
const router = express.Router();

router.use(requireAuth);

// Logo: kleine base64-data-URI (max ~200KB binair), afgedwongen in het schema -
// bewust geen extra opslagdienst nodig.
const updateOwnCompanySchema = z
  .object({
    name: z.string().min(1, "Vul een bedrijfsnaam in").max(200).optional(),
    logo: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo moet een PNG, JPEG of WebP zijn")
      .max(280000, "Logo mag maximaal ~200KB zijn")
      .nullable()
      .optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

function requireOwnCompany(req, res, next) {
  if (req.user.companyId == null) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  next();
}

router.get("/", requireRole("company_admin", "company_user"), requireOwnCompany, async (req, res, next) => {
  try {
    const company = await companiesRepo.getCompanyById(req.user.companyId);
    if (!company) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(company);
  } catch (error) {
    next(error);
  }
});

router.patch("/", requireRole("company_admin"), requireOwnCompany, validateBody(updateOwnCompanySchema), async (req, res, next) => {
  try {
    const updated = await companiesRepo.updateCompany(req.user.companyId, {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.logo !== undefined ? { logo: req.body.logo } : {})
    });

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "update",
      entityType: "Company",
      entityId: req.user.companyId,
      metadata: { fields: Object.keys(req.body) }
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.get("/documents", requireRole("company_admin", "company_user"), requireOwnCompany, async (req, res, next) => {
  try {
    res.json(await documentsRepo.listDocumentsForCompany(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
