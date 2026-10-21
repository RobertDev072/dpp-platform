const express = require("express");
const { z } = require("zod");
const { isoDate } = require("../schemas/documents.schema");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const companiesRepo = require("../repositories/companies.repository");
const documentsRepo = require("../repositories/documents.repository");
const { logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const edgeCache = require("../services/edgeCache.service");
const { SCHEMES: OPERATOR_SCHEMES, validateOperatorId, normalizeOperatorId } = require("../utils/operatorId");

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
      .optional(),
    // Identificatie als marktdeelnemer op het paspoort (economicOperatorId). Beide
    // velden samen; null wist ze.
    economicOperatorIdScheme: z.enum(OPERATOR_SCHEMES).nullable().optional(),
    economicOperatorId: z.string().max(100).nullable().optional(),
    // EU DPP-register: datum van de verificatie en vervaldatum van het zegel (optioneel).
    euVerifiedAt: isoDate.nullable().optional(),
    euSealExpiresAt: isoDate.nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" })
  .superRefine((data, ctx) => {
    if (data.economicOperatorId === undefined && data.economicOperatorIdScheme === undefined) return;
    if (!data.economicOperatorId && !data.economicOperatorIdScheme) return;
    const error = validateOperatorId(data.economicOperatorIdScheme, data.economicOperatorId);
    if (error) ctx.addIssue({ code: "custom", path: ["economicOperatorId"], message: error });
  });

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
    if (req.body.euVerifiedAt !== undefined) fields.euVerifiedAt = req.body.euVerifiedAt;
    if (req.body.euSealExpiresAt !== undefined) fields.euSealExpiresAt = req.body.euSealExpiresAt;
    if (req.body.economicOperatorId !== undefined || req.body.economicOperatorIdScheme !== undefined) {
      const scheme = req.body.economicOperatorId ? req.body.economicOperatorIdScheme : null;
      fields.economicOperatorIdScheme = scheme;
      fields.economicOperatorId = scheme ? normalizeOperatorId(scheme, req.body.economicOperatorId) : null;
    }
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
    // Naam en marktdeelnemer-id horen bij de paspoortinhoud: elk gepubliceerd paspoort
    // krijgt een nieuwe archiefversie (alleen als de inhoud echt veranderd is). Het aantal
    // producten is begrensd door het abonnement; archiveSafely logt fouten zelf.
    if (fields.name !== undefined || fields.economicOperatorId !== undefined) {
      const pool = await require("../config/db").getPool();
      const ids = (await pool.query(
        "SELECT id FROM dbo.products WHERE company_id = $1 AND public_id IS NOT NULL AND published_at IS NOT NULL",
        [req.user.companyId]
      )).rows.map((r) => r.id);
      if (ids.length) {
        await require("../services/passportArchive.service").archiveSafely(ids, { userId: req.user.id, reason: "update" });
      }
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// --- API-sleutels voor de B2B-API (/api/v1) --------------------------------------------
// Alleen de Bedrijfsbeheerder; de sleutel is één keer zichtbaar in het antwoord op aanmaken.
const apiKeys = require("../services/apiKeys.service");
const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Geef de sleutel een naam").max(100),
  scopes: z.enum(["read", "read write"]).default("read"),
  expiresInDays: z.number().int().min(1).max(730).nullable().optional()
});

router.get("/api-keys", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
  try {
    res.json(await apiKeys.listKeys(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

router.post("/api-keys", requireRole("company_admin"), requireOwnCompany, validateBody(createApiKeySchema), async (req, res, next) => {
  try {
    const expiresAt = req.body.expiresInDays ? new Date(Date.now() + req.body.expiresInDays * 86400000) : null;
    const created = await apiKeys
      .createKey({ companyId: req.user.companyId, name: req.body.name, scopes: req.body.scopes, createdBy: req.user.id, expiresAt })
      .catch((err) => {
        throw err.statusCode ? new HttpError(err.statusCode, err.message) : err;
      });
    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "api_key_create",
      entityType: "ApiKey",
      entityId: created.id,
      metadata: { name: created.name, scopes: created.scopes, prefix: created.key_prefix }
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.delete("/api-keys/:keyId", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
  try {
    const id = Number(req.params.keyId);
    const revoked = Number.isInteger(id) && id > 0 ? await apiKeys.revokeKey(req.user.companyId, id) : null;
    if (!revoked) throw new HttpError(404, "Niet gevonden");
    await logAuditFromReq(req, { companyId: req.user.companyId, action: "api_key_revoke", entityType: "ApiKey", entityId: id, metadata: { prefix: revoked.key_prefix } });
    res.json(revoked);
  } catch (error) {
    next(error);
  }
});

// Toegangstokens voor professionals (reparateurs, recyclers) en autoriteiten: zij zien
// met zo'n token in de machineleesbare paspoorten ook de documenten voor hun niveau.
const dppAccess = require("../services/dppAccess.service");
const createAccessTokenSchema = z.object({
  name: z.string().trim().min(1, "Vul een naam in").max(100),
  level: z.enum(["professional", "authority"]),
  // Altijd een vervaldatum (max. 2 jaar): tokenhouders zijn vaak personen (AVG).
  expiresInDays: z.number().int().min(1).max(730).default(365)
});

router.get("/access-tokens", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
  try {
    res.json(await dppAccess.listTokens(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

router.post("/access-tokens", requireRole("company_admin"), requireOwnCompany, validateBody(createAccessTokenSchema), async (req, res, next) => {
  try {
    const expiresAt = new Date(Date.now() + req.body.expiresInDays * 86400000);
    const created = await dppAccess
      .createToken({ companyId: req.user.companyId, level: req.body.level, name: req.body.name, createdBy: req.user.id, expiresAt })
      .catch((err) => {
        throw err.statusCode ? new HttpError(err.statusCode, err.message) : err;
      });
    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "access_token_create",
      entityType: "AccessToken",
      entityId: created.id,
      metadata: { name: created.name, level: created.access_level, prefix: created.token_prefix }
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// Logboek: wanneer dit token welk paspoort of document opvroeg (laatste 100; 365 dagen bewaard).
router.get("/access-tokens/:tokenId/log", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
  try {
    const id = Number(req.params.tokenId);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Niet gevonden");
    res.json(await dppAccess.accessLog(req.user.companyId, id));
  } catch (error) {
    next(error);
  }
});

router.delete("/access-tokens/:tokenId", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
  try {
    const id = Number(req.params.tokenId);
    const revoked = Number.isInteger(id) && id > 0 ? await dppAccess.revokeToken(req.user.companyId, id) : null;
    if (!revoked) throw new HttpError(404, "Niet gevonden");
    await logAuditFromReq(req, { companyId: req.user.companyId, action: "access_token_revoke", entityType: "AccessToken", entityId: id, metadata: { prefix: revoked.token_prefix } });
    res.json(revoked);
  } catch (error) {
    next(error);
  }
});

// Licentiegebruik van het eigen bedrijf (voor de licentiekaart op het dashboard).
// Abonnementsgegevens alleen voor de bedrijfsbeheerder (niet voor medewerkers).
router.get("/license", requireRole("company_admin"), requireOwnCompany, async (req, res, next) => {
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
