const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const companiesRepo = require("../repositories/companies.repository");
const documentsRepo = require("../repositories/documents.repository");
const storageService = require("../services/storage.service");
const { documentBulkSchema, documentIdsSchema } = require("../schemas/documents.schema");
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
    // Interne notities van het platformbeheer zijn niet voor de klant zelf.
    const { notes: _notes, ...visible } = company;
    res.json(visible);
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

// Licentiegebruik van het eigen bedrijf (voor de licentiekaart op het dashboard).
router.get("/license", requireRole("company_admin", "company_user"), requireOwnCompany, async (req, res, next) => {
  try {
    const usage = await require("../services/license.service").getExtendedUsage(req.user.companyId);
    if (!usage) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(usage);
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

// Bulkacties op documenten van het eigen bedrijf (openbaar/privé, archiveren).
router.post(
  "/documents/bulk",
  requireRole("company_admin", "company_user"),
  requireOwnCompany,
  validateBody(documentBulkSchema),
  async (req, res, next) => {
    try {
      const affected = await documentsRepo.bulkUpdate(req.user.companyId, req.body.ids, req.body.action);
      await logAuditFromReq(req, {
        companyId: req.user.companyId,
        action: `bulk_${req.body.action}`,
        entityType: "Document",
        entityId: null,
        metadata: { selected: req.body.ids.length, affected: affected.length, documentIds: affected.slice(0, 200) }
      });
      res.json({ selected: req.body.ids.length, affected: affected.length });
    } catch (error) {
      next(error);
    }
  }
);

// Kortlevende downloadlinks voor een selectie (max. 200), zodat de browser er
// een ZIP van kan maken. Alleen documenten van het eigen bedrijf.
router.post(
  "/documents/download-links",
  requireRole("company_admin", "company_user"),
  requireOwnCompany,
  validateBody(documentIdsSchema),
  async (req, res, next) => {
    try {
      const rows = await documentsRepo.listByIds(req.user.companyId, req.body.ids);
      const items = [];
      for (const row of rows) {
        if (row.blob_name) {
          items.push({
            id: row.id,
            title: row.title,
            productName: row.product_name,
            mimeType: row.mime_type,
            fileName: row.blob_name.split("/").pop(),
            url: await storageService.createDownloadUrl("document", row.blob_name),
            external: false
          });
        } else if (row.storage_url) {
          items.push({ id: row.id, title: row.title, productName: row.product_name, url: row.storage_url, external: true });
        }
      }
      await logAuditFromReq(req, {
        companyId: req.user.companyId,
        action: "bulk_download",
        entityType: "Document",
        entityId: null,
        metadata: { count: items.length }
      });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
