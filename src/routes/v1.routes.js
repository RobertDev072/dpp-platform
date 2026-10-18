const express = require("express");
const { z } = require("zod");
const { apiKeyAuth } = require("../middleware/apiKey");
const { apiClientLimiter } = require("../middleware/rateLimit");
const { validateBody, validateQuery } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const { getPool } = require("../config/db");
const productsRepo = require("../repositories/products.repository");
const instancesRepo = require("../repositories/instances.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");
const passport = require("../services/passport.service");
const archive = require("../services/passportArchive.service");
const dpp = require("./dpp.routes");
const gs1 = require("../utils/gs1");
const { logAudit } = require("../utils/auditLog");
const { getQrBaseUrl } = require("../utils/baseUrl");
const { createProductSchema, productFieldsSchema, updateProductSchema, LANGUAGE_PATTERN } = require("../schemas/products.schema");
const { updateSustainabilitySchema } = require("../schemas/sustainability.schema");
const { updateComplianceSchema } = require("../schemas/compliance.schema");
const { openApiDocument, dppJsonSchema } = require("./v1.openapi");
const { DPP_VOCABULARY } = require("../../lib/dppVocabulary");

// B2B-API voor externe systemen en toezichthouders (EN 18222-richting).
//
// Lezen (publiek, geen sleutel nodig; alleen gepubliceerde/gearchiveerde paspoorten):
//   GET  /dpp/{dppId}                         ReadDPPById (+ ?at=ISO → ReadDPPVersionByIdAndDate)
//   GET  /dpp?productId=…                     ReadDPPByProductId (GTIN, GS1 Digital Link of urn:uuid)
//   POST /dpp/search  {productIds, page}      ReadDPPIdsByProductIds (gepagineerd)
//   GET  /dpp/{dppId}/elements/{elementId}    ReadDataElement
// Schrijven (API-sleutel met write-recht, alleen paspoorten van het eigen bedrijf):
//   POST   /dpp                               CreateDPP
//   PATCH  /dpp/{dppId}                       UpdateDPPById
//   PUT    /dpp/{dppId}/elements/{elementId}  UpdateDataElement
//   DELETE /dpp/{dppId}                       DeleteDPPById (= archiveren; blijft raadpleegbaar)
//
// Alle antwoorden JSON; fouten als { error: { message, code } }. Versie: /api/v1 (stabiel;
// brekende wijzigingen komen in /api/v2).
const router = express.Router();
router.use(apiKeyAuth({ optional: true }), apiClientLimiter);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "urn:uuid:…", een paspoort-URL ".../p/{id}" of de kale UUID → UUID (kleine letters).
function parseDppId(value) {
  const raw = decodeURIComponent(String(value || "")).trim();
  const candidate = raw.replace(/^urn:uuid:/i, "").replace(/^.*\/p\//i, "");
  return UUID.test(candidate) ? candidate.toLowerCase() : null;
}

function requireWrite(req) {
  if (!req.apiClient) throw new HttpError(401, "API-sleutel ontbreekt (Authorization: Bearer vp_…)", undefined, "API_KEY_MISSING");
  if (!req.apiClient.scopes.includes("write")) throw new HttpError(403, "Deze API-sleutel heeft geen write-recht", undefined, "API_KEY_SCOPE");
}

async function loadOwnProductByDppId(req) {
  const id = parseDppId(req.params.dppId);
  if (!id) throw new HttpError(404, "Niet gevonden");
  const pool = await getPool();
  const row = (await pool.query("SELECT id FROM dbo.products WHERE public_id = $1 AND company_id = $2", [id, req.apiClient.companyId])).rows[0];
  if (!row) throw new HttpError(404, "Niet gevonden");
  return productsRepo.getProductById(row.id);
}

function audit(req, action, productId, metadata = {}) {
  return logAudit({
    companyId: req.apiClient.companyId,
    userId: null,
    action,
    entityType: "Product",
    entityId: productId,
    metadata: { via: "api", apiKeyId: req.apiClient.keyId, ...metadata }
  });
}

async function respondWithDpp(req, res, product, status = 200) {
  const qrBaseUrl = getQrBaseUrl(req);
  const snapshot = await passport.buildSnapshot(product);
  const body = passport.toDppJson(snapshot, { qrBaseUrl, lastUpdated: product.updated_at });
  body.dppStatus = product.status === "draft" ? "Draft" : body.dppStatus;
  res.status(status).json(body);
}

// --- documentatie -------------------------------------------------------------------
router.get("/openapi.json", (req, res) => res.json(openApiDocument(getQrBaseUrl(req))));
router.get("/schema/dpp.json", (req, res) => res.json(dppJsonSchema(getQrBaseUrl(req))));
router.get("/vocab", (req, res) => res.json({ base: `${getQrBaseUrl(req)}/vocab/dpp#`, terms: DPP_VOCABULARY }));

// --- lezen ----------------------------------------------------------------------------

// ReadDPPByProductId: GTIN (8/12/13/14 cijfers), GS1 Digital Link of urn:uuid.
// Meest recente actieve versie; anders het meest recente gearchiveerde paspoort.
async function findPublicIdsForProductId(productId, { limit = 50 } = {}) {
  const value = String(productId || "").trim();
  const pool = await getPool();
  const dppId = parseDppId(value);
  if (dppId) {
    const row = (await pool.query(
      `SELECT pi.public_id FROM dbo.passportids pi JOIN dbo.products p ON p.id = pi.product_id
       WHERE pi.public_id = $1 AND p.published_at IS NOT NULL AND p.status IN ('published','archived')`,
      [dppId]
    )).rows[0];
    return row ? [String(row.public_id)] : [];
  }
  // GS1 Digital Link met lot (AI 10) en/of serienummer (AI 21): batch- of itempaspoort.
  const full = /\/01\/(\d{14})(?:\/10\/([^/?#]+))?(?:\/21\/([^/?#]+))?/.exec(value);
  if (full && (full[2] || full[3])) {
    if (!gs1.isValidGtin(full[1])) return [];
    const id = await instancesRepo.findByGs1({
      gtin14: full[1],
      lot: full[2] ? decodeURIComponent(full[2]) : null,
      serial: full[3] ? decodeURIComponent(full[3]) : null
    });
    return id ? [id] : [];
  }
  const dl = /\/01\/(\d{14})(?:\/|$)/.exec(value);
  const gtin = gs1.normalizeGtin(dl ? dl[1] : value);
  if (!gtin || !gs1.isValidGtin(gtin)) return [];
  // GTIN kan zonder voorloopnullen zijn opgeslagen: vergelijk genormaliseerd (14 cijfers).
  const rows = (await pool.query(
    `SELECT public_id FROM dbo.products
     WHERE gtin IS NOT NULL AND public_id IS NOT NULL AND published_at IS NOT NULL AND status IN ('published','archived')
       AND lpad(regexp_replace(gtin, '[^0-9]', '', 'g'), 14, '0') = $1
     ORDER BY (status = 'published') DESC, published_at DESC
     LIMIT $2`,
    [gtin, limit]
  )).rows;
  return rows.map((r) => String(r.public_id));
}

router.get(
  "/dpp",
  validateQuery(z.object({ productId: z.string().min(1).max(500) })),
  async (req, res, next) => {
    try {
      const [first] = await findPublicIdsForProductId(req.validatedQuery.productId, { limit: 1 });
      if (!first) throw new HttpError(404, "Geen paspoort gevonden voor dit product-ID");
      req.params.publicId = first;
      return dpp.readPassport(req, res, next);
    } catch (error) {
      next(error);
    }
  }
);

const searchSchema = z.object({
  productIds: z.array(z.string().min(1).max(500)).min(1).max(100),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50)
});

router.post("/dpp/search", validateBody(searchSchema), async (req, res, next) => {
  try {
    const { productIds, page, pageSize } = req.body;
    const all = [];
    for (const productId of [...new Set(productIds)]) {
      for (const publicId of await findPublicIdsForProductId(productId)) {
        all.push({ productId, digitalProductPassportId: `urn:uuid:${publicId.toLowerCase()}` });
      }
    }
    const start = (page - 1) * pageSize;
    res.json({ items: all.slice(start, start + pageSize), page, pageSize, total: all.length, pages: Math.max(1, Math.ceil(all.length / pageSize)) });
  } catch (error) {
    next(error);
  }
});

// Resolver voor GS1 Digital Links op ons domein (/01/{gtin}[/10/{lot}][/21/{serie}]),
// gebruikt door app/01/[...gs1]/route.js. Geeft het meest specifieke openbare paspoort.
router.get("/resolve", validateQuery(z.object({ link: z.string().min(4).max(500) })), async (req, res, next) => {
  try {
    const [publicId] = await findPublicIdsForProductId(req.validatedQuery.link, { limit: 1 });
    if (!publicId) throw new HttpError(404, "Geen paspoort gevonden voor deze GS1-link");
    res.set("Cache-Control", "public, max-age=300").json({
      digitalProductPassportId: `urn:uuid:${publicId.toLowerCase()}`,
      url: `${getQrBaseUrl(req)}/p/${publicId.toUpperCase()}`
    });
  } catch (error) {
    next(error);
  }
});

router.get("/dpp/:dppId", (req, res, next) => {
  const id = parseDppId(req.params.dppId);
  if (!id) return next(new HttpError(404, "Niet gevonden"));
  req.params.publicId = id;
  return dpp.readPassport(req, res, next);
});

router.get("/dpp/:dppId/elements/:elementId", async (req, res, next) => {
  try {
    const id = parseDppId(req.params.dppId);
    const resolved = id ? await instancesRepo.resolvePublicPassport(id) : null;
    if (!resolved) throw new HttpError(404, "Niet gevonden");
    const { product, instance } = resolved;
    const snapshot = await passport.buildSnapshot(product);
    const json = passport.toDppJson(snapshot, { qrBaseUrl: getQrBaseUrl(req), lastUpdated: product.updated_at, instance });
    const element = json.dataElements.find((e) => e.elementId === req.params.elementId);
    if (!element) throw new HttpError(404, "Dataveld niet gevonden of leeg");
    res.set("Cache-Control", "public, max-age=60").json({ digitalProductPassportId: json.digitalProductPassportId, ...element });
  } catch (error) {
    next(error);
  }
});

// --- schrijven ------------------------------------------------------------------------

const createSchema = createProductSchema.extend({
  facilityId: z.string().trim().max(100).optional(),
  contentSpecificationIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  language: z.string().regex(LANGUAGE_PATTERN).optional(),
  publish: z.boolean().default(false)
});

router.post("/dpp", validateBody(createSchema), async (req, res, next) => {
  try {
    requireWrite(req);
    const companyId = req.apiClient.companyId;
    const { publish, facilityId, contentSpecificationIds, language, ...fields } = req.body;
    const license = require("../services/license.service");
    const product = await license.withCreationLock(companyId, async () => {
      await license.assertCanCreate(companyId, "product", { role: "company_admin" });
      const created = await productsRepo.createProduct({ ...fields, companyId, createdBy: null });
      const extra = {};
      if (facilityId) extra.facilityId = facilityId;
      if (contentSpecificationIds) extra.contentSpecificationIds = JSON.stringify(contentSpecificationIds);
      if (language) extra.language = language;
      if (Object.keys(extra).length) await productsRepo.updateProduct(created.id, extra);
      // Een DPP-id bestaat vanaf aanmaken (gereserveerd); openbaar pas na publiceren.
      await productsRepo.reserveQr(created.id);
      return publish ? productsRepo.publishProduct(created.id) : productsRepo.getProductById(created.id);
    });
    await audit(req, publish ? "publish" : "create", product.id);
    if (publish) await archive.archiveSafely([product.id], { reason: "publish" });
    await respondWithDpp(req, res, product, 201);
  } catch (error) {
    next(error);
  }
});

const patchSchema = productFieldsSchema.omit({ status: true }).extend({
  sustainability: updateSustainabilitySchema.optional(),
  compliance: updateComplianceSchema.optional(),
  dppStatus: z.enum(["Active", "Archived"]).optional()
}).refine((d) => Object.keys(d).length > 0, { message: "Geen velden om bij te werken" });

const SUSTAINABILITY_KEYS = {
  co2FootprintKg: "co2_footprint_kg", co2ReductionPct: "co2_reduction_pct", recycledMaterialPct: "recycled_material_pct",
  materials: "materials", epdUrl: "epd_url", recyclable: "recyclable", reachConform: "reach_conform",
  rohsConform: "rohs_conform", expectedLifespanYears: "expected_lifespan_years"
};

// Upserts vervangen alle velden: eerst de huidige stand overnemen, dan aanvullen.
async function mergeSustainability(productId, changes) {
  const current = (await sustainabilityRepo.getSustainability(productId)) || {};
  const merged = {};
  for (const [key, column] of Object.entries(SUSTAINABILITY_KEYS)) {
    const value = current[column];
    merged[key] = value === null || value === undefined ? undefined : typeof value === "string" && key !== "epdUrl" ? Number(value) : value;
  }
  return sustainabilityRepo.upsertSustainability(productId, { ...merged, ...changes });
}

async function mergeCompliance(productId, changes) {
  const current = (await complianceRepo.getCompliance(productId)) || {};
  return complianceRepo.upsertCompliance(productId, {
    ceMarked: current.ce_marked ?? undefined,
    applicableRegulations: current.applicable_regulations ?? undefined,
    ...changes
  });
}

async function applyProductChanges(product, body) {
  const { sustainability, compliance, dppStatus, ...fields } = body;
  if (fields.contentSpecificationIds !== undefined) fields.contentSpecificationIds = JSON.stringify(fields.contentSpecificationIds);
  if (dppStatus === "Archived") fields.status = "archived";
  if (dppStatus === "Active" && product.status !== "published") {
    if (!product.published_at && product.status === "draft") {
      await productsRepo.publishProduct(product.id);
    } else {
      throw new HttpError(409, "Een gearchiveerd paspoort opnieuw activeren kan alleen in de applicatie (telt mee voor de licentie)", undefined, "REACTIVATE_IN_APP");
    }
  }
  if (Object.keys(fields).length) await productsRepo.updateProduct(product.id, fields);
  if (sustainability) await mergeSustainability(product.id, sustainability);
  if (compliance) await mergeCompliance(product.id, compliance);
}

router.patch("/dpp/:dppId", validateBody(patchSchema), async (req, res, next) => {
  try {
    requireWrite(req);
    const product = await loadOwnProductByDppId(req);
    await applyProductChanges(product, req.body);
    await audit(req, "update", product.id, { fields: Object.keys(req.body) });
    await archive.archiveSafely([product.id], { reason: req.body.dppStatus === "Archived" ? "archive" : "update" });
    await respondWithDpp(req, res, await productsRepo.getProductById(product.id));
  } catch (error) {
    next(error);
  }
});

// UpdateDataElement: één veld via zijn elementId. product.name/description accepteren ook
// een meertalige waarde [{ language, value }] (basistaal → product, overige → vertalingen).
const PRODUCT_ELEMENTS = {
  "product.name": "name", "product.description": "description", "product.brand": "brand", "product.model": "model",
  "product.category": "categoryLabel", "product.manufacturer": "manufacturer", "product.countryOfOrigin": "countryOfOrigin",
  "product.gtin": "gtin", "product.sku": "sku"
};

router.put("/dpp/:dppId/elements/:elementId", validateBody(z.object({ value: z.unknown() })), async (req, res, next) => {
  try {
    requireWrite(req);
    const product = await loadOwnProductByDppId(req);
    const { elementId } = req.params;
    const { value } = req.body;
    const [group, key] = elementId.split(".");
    let body;
    if (PRODUCT_ELEMENTS[elementId]) {
      const field = PRODUCT_ELEMENTS[elementId];
      if (Array.isArray(value) && (field === "name" || field === "description")) {
        const parsed = z.array(z.object({ language: z.string().regex(LANGUAGE_PATTERN), value: z.string().max(20000) })).min(1).safeParse(value);
        if (!parsed.success) throw new HttpError(400, "Ongeldige meertalige waarde: [{ language: 'nl-NL', value: '…' }]");
        const base = product.language || "nl-NL";
        const pool = await getPool();
        for (const item of parsed.data) {
          if (item.language === base) {
            await productsRepo.updateProduct(product.id, { [field]: item.value });
          } else {
            await pool.query(
              `INSERT INTO dbo.producttranslations (product_id, language, ${field}) VALUES ($1, $2, $3)
               ON CONFLICT (product_id, language) DO UPDATE SET ${field} = EXCLUDED.${field}, updated_at = now()`,
              [product.id, item.language, item.value]
            );
          }
        }
        body = null;
      } else {
        body = { [field]: value };
        const parsed = updateProductSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(400, "Ongeldige waarde", parsed.error.flatten());
      }
    } else if (group === "sustainability" && SUSTAINABILITY_KEYS[key]) {
      const parsed = updateSustainabilitySchema.safeParse({ [key]: value });
      if (!parsed.success) throw new HttpError(400, "Ongeldige waarde", parsed.error.flatten());
      body = { sustainability: parsed.data };
    } else if (group === "compliance" && ["ceMarked", "applicableRegulations"].includes(key)) {
      const parsed = updateComplianceSchema.safeParse({ [key]: value });
      if (!parsed.success) throw new HttpError(400, "Ongeldige waarde", parsed.error.flatten());
      body = { compliance: parsed.data };
    } else {
      throw new HttpError(404, "Onbekend of niet-wijzigbaar dataveld");
    }
    if (body) await applyProductChanges(product, body);
    await audit(req, "update", product.id, { element: elementId });
    await archive.archiveSafely([product.id], { reason: "update" });
    const updated = await productsRepo.getProductById(product.id);
    const json = passport.toDppJson(await passport.buildSnapshot(updated), { qrBaseUrl: getQrBaseUrl(req), lastUpdated: updated.updated_at });
    res.json(json.dataElements.find((e) => e.elementId === elementId) || { elementId, value: null });
  } catch (error) {
    next(error);
  }
});

// RegisterProductDPP: aanmelden bij het EU DPP-register. Wordt in de wachtrij gezet en
// verstuurd zodra het register (EU_DPP_REGISTRY_URL) is ingesteld; status opvraagbaar.
const continuity = require("../services/dppContinuity.service");

router.post("/dpp/:dppId/register", async (req, res, next) => {
  try {
    requireWrite(req);
    const product = await loadOwnProductByDppId(req);
    if (!product.published_at) throw new HttpError(409, "Publiceer het paspoort eerst", undefined, "NOT_PUBLISHED");
    const registration = await continuity.queueRegistration(product);
    await audit(req, "register_request", product.id);
    res.status(202).json({ digitalProductPassportId: `urn:uuid:${String(product.public_id).toLowerCase()}`, ...registration });
  } catch (error) {
    next(error);
  }
});

router.get("/dpp/:dppId/registration", async (req, res, next) => {
  try {
    if (!req.apiClient) throw new HttpError(401, "API-sleutel ontbreekt", undefined, "API_KEY_MISSING");
    const product = await loadOwnProductByDppId(req);
    const registration = await continuity.getRegistration(product.public_id);
    if (!registration) throw new HttpError(404, "Nog niet aangemeld");
    res.json(registration);
  } catch (error) {
    next(error);
  }
});

router.delete("/dpp/:dppId", async (req, res, next) => {
  try {
    requireWrite(req);
    const product = await loadOwnProductByDppId(req);
    if (product.status !== "archived") await productsRepo.updateProduct(product.id, { status: "archived" });
    await audit(req, "delete", product.id);
    await archive.archiveSafely([product.id], { reason: "archive" });
    // Persistentie: een ooit gepubliceerd paspoort blijft raadpleegbaar (dppStatus Archived).
    await respondWithDpp(req, res, await productsRepo.getProductById(product.id));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.parseDppId = parseDppId;
