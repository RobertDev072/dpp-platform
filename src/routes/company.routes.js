const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const companiesRepo = require("../repositories/companies.repository");
const documentsRepo = require("../repositories/documents.repository");
const { logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const edgeCache = require("../services/edgeCache.service");

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
    const fields = req.body.name !== undefined ? { name: req.body.name } : {};
    let previousLogoBlob = null;
    if (req.body.logo !== undefined) {
      const { isStorageConfigured } = require("../config/storage");
      const pool = await require("../config/db").getPool();
      previousLogoBlob = (await pool.query("SELECT logo_blob_name FROM dbo.companies WHERE id = $1", [req.user.companyId])).rows[0]?.logo_blob_name || null;
      if (req.body.logo === null) {
        Object.assign(fields, { logo: null, logoBlobName: null });
      } else if (isStorageConfigured()) {
        // Logo in de objectopslag (256 px WebP), niet in de database.
        const { storeSmallImage } = require("../services/blobStorage.service");
        const buffer = Buffer.from(req.body.logo.slice(req.body.logo.indexOf(",") + 1), "base64");
        const logoBlobName = await storeSmallImage({ prefix: `companies/${req.user.companyId}`, buffer, size: 256 });
        Object.assign(fields, { logo: null, logoBlobName });
      } else {
        // Zonder opslag (lokaal zonder S3): zoals vroeger in de database.
        Object.assign(fields, { logo: req.body.logo, logoBlobName: null });
      }
    }
    const updated = await companiesRepo.updateCompany(req.user.companyId, fields);
    // Het oude logo is niet meer in gebruik (paspoortkopieën worden opnieuw gemaakt).
    if (previousLogoBlob && previousLogoBlob !== fields.logoBlobName) {
      const { deleteObjectQuietly, bucketFor } = require("../services/blobStorage.service");
      await deleteObjectQuietly(bucketFor("image"), previousLogoBlob);
    }

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "update",
      entityType: "Company",
      entityId: req.user.companyId,
      metadata: { fields: Object.keys(req.body) }
    });
    // Naam en logo staan op elk publiek paspoort van dit bedrijf.
    await edgeCache.queuePurgeForCompany(req.user.companyId);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Licentiegebruik van het eigen bedrijf (voor de licentiekaart op het dashboard).
router.get("/license", requireRole("company_admin", "company_user"), requireOwnCompany, async (req, res, next) => {
  try {
    const usage = await require("../services/license.service").getLicenseUsage(req.user.companyId);
    if (!usage) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(usage);
  } catch (error) {
    next(error);
  }
});

const documentsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(require("../schemas/documents.schema").DOCUMENT_CATEGORIES).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  validity: z.enum(["expired", "expiring", "valid", "none"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

router.get("/documents", requireRole("company_admin", "company_user"), requireOwnCompany, async (req, res, next) => {
  try {
    const parsed = documentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new HttpError(400, "Ongeldige invoer", parsed.error.flatten()));
      return;
    }
    const [list, stats] = await Promise.all([
      documentsRepo.listDocumentsForCompany(req.user.companyId, parsed.data),
      documentsRepo.getDocumentStats(req.user.companyId)
    ]);
    res.json({ ...list, stats });
  } catch (error) {
    next(error);
  }
});

// Bulk openbaar/privé zetten. De id's worden tegen het eigen bedrijf gefilterd.
router.post(
  "/documents/bulk",
  requireRole("company_admin", "company_user"),
  requireOwnCompany,
  validateBody(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000), isPublic: z.boolean() })),
  async (req, res, next) => {
    try {
      const affected = await documentsRepo.bulkSetPublic(req.user.companyId, req.body.ids, req.body.isPublic);
      await logAuditFromReq(req, {
        companyId: req.user.companyId,
        action: req.body.isPublic ? "bulk_document_publish" : "bulk_document_unpublish",
        entityType: "Document",
        metadata: { requested: req.body.ids.length, affected: affected.length }
      });
      await edgeCache.queuePurgeForDocuments(affected);
      res.json({ requested: req.body.ids.length, affected: affected.length });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
