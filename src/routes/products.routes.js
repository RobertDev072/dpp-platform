const express = require("express");
const multer = require("multer");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { listProductsQuerySchema } = require("../schemas/productsQuery.schema");
const { createProductSchema, updateProductSchema } = require("../schemas/products.schema");
const { createPartSchema } = require("../schemas/parts.schema");
const { updateSustainabilitySchema } = require("../schemas/sustainability.schema");
const { updateComplianceSchema } = require("../schemas/compliance.schema");
const { createBatchSchema } = require("../schemas/batches.schema");
const { createDocumentSchema, updateDocumentSchema, DOCUMENT_CATEGORIES, isoDate } = require("../schemas/documents.schema");
const productsRepo = require("../repositories/products.repository");
const partsRepo = require("../repositories/parts.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");
const batchesRepo = require("../repositories/batches.repository");
const documentsRepo = require("../repositories/documents.repository");
const { assertCompanyAccess } = require("../utils/tenant");
const { logAudit, logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { getPassportUrl } = require("../utils/baseUrl");
const {
  generateQrPngBuffer,
  generateQrSvgString,
  generateLabelPdfBuffer
} = require("../services/qrCode.service");
const {
  uploadProductPhoto,
  getProductPhotoUrl,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  uploadProductDocument,
  getProductDocumentUrl,
  createPhotoUpload,
  createDocumentUpload,
  verifyUploadedPhoto,
  verifyUploadedDocument
} = require("../services/blobStorage.service");

const router = express.Router();

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
      cb(new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan."));
      return;
    }
    cb(null, true);
  }
});

const DOCUMENT_MAX_MB = 10;
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOCUMENT_MIME_TYPES[file.mimetype]) {
      cb(new HttpError(400, "Alleen PDF, JPEG, PNG, SVG of WEBP-bestanden zijn toegestaan."));
      return;
    }
    cb(null, true);
  }
});

const { PLATFORM_OWNER_ROLES, isPlatformOwner } = require("../utils/roles");
const { heavyWorkLimiter: heavyExportLimiter } = require("../middleware/rateLimit");

const ALL_ROLES = [...PLATFORM_OWNER_ROLES, "company_admin", "company_user"];
const EDITOR_ROLES = ["company_admin", "company_user"];

router.use(requireAuth);

// Compliance (EN 18221 §4.2): na elke geslaagde wijziging aan een product of de
// onderdelen ervan (documenten, duurzaamheid, compliance, onderdelen, foto, status)
// wordt het paspoort als nieuwe versie gearchiveerd - alleen als het op de markt is
// en de inhoud echt veranderd is (zie passportArchive.service.js). Dit gebeurt vóór
// het antwoord vertrekt, zodat een client die direct de historie opvraagt de nieuwe
// versie ziet. Een archieffout laat het (al opgeslagen) verzoek niet mislukken maar
// wordt gelogd en door het dagelijkse onderhoud ingehaald.
const { archiveSafely } = require("../services/passportArchive.service");

// path: het deel na /api/products, bijv. "/12", "/12/publish", "/12/documents/3".
function archiveReason(method, path) {
  if (method === "DELETE" && /^\/\d+\/?$/.test(path)) return "archive";
  if (/^\/\d+\/publish\/?$/.test(path)) return "publish";
  return "update";
}

router.use("/:id", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !/^\d+$/.test(req.params.id)) {
    next();
    return;
  }
  const productId = Number(req.params.id);
  const reason = archiveReason(req.method, req.originalUrl.split("?")[0].replace(/^\/api\/products/, ""));
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 200 || res.statusCode >= 300) return sendJson(body);
    archiveSafely([productId], { userId: req.user?.id ?? null, reason }).finally(() => sendJson(body));
    return res;
  };
  next();
});

router.get("/", requireRole(...ALL_ROLES), validateQuery(listProductsQuerySchema), async (req, res, next) => {
  try {
    const params = { ...req.validatedQuery };
    // Alleen de Platform Owner mag over bedrijven heen kijken; iedereen anders is
    // hard aan het eigen bedrijf gebonden, ongeacht wat er in de query staat.
    if (!isPlatformOwner(req.user.role)) {
      params.companyId = req.user.companyId;
    }
    res.json(await productsRepo.listProducts(params));
  } catch (error) {
    next(error);
  }
});

router.get("/stats", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const companyId = isPlatformOwner(req.user.role)
      ? (req.query.companyId !== undefined ? Number(req.query.companyId) : undefined)
      : req.user.companyId;
    res.json(await productsRepo.getProductStats({ companyId }));
  } catch (error) {
    next(error);
  }
});

// QR-overzicht: aantallen per QR-status, scancijfers en meest gescande producten.
// Alleen voor het eigen bedrijf.
router.get("/qr-stats", requireRole("company_admin", "company_user"), async (req, res, next) => {
  try {
    const scanEventsRepo = require("../repositories/scanEvents.repository");
    const companyId = req.user.companyId;
    const [stats, scans, top] = await Promise.all([
      productsRepo.getProductStats({ companyId }),
      scanEventsRepo.getScanSummary(companyId),
      scanEventsRepo.listTopScannedProducts(companyId, { limit: 5, days: 30 })
    ]);
    res.json({
      total: stats.qrActive + stats.qrReserved,
      active: stats.qrActive,
      reserved: stats.qrReserved,
      withoutQr: stats.total - stats.qrActive - stats.qrReserved,
      scans,
      top
    });
  } catch (error) {
    next(error);
  }
});

router.get("/categories", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const companyId = isPlatformOwner(req.user.role)
      ? (req.query.companyId !== undefined ? Number(req.query.companyId) : undefined)
      : req.user.companyId;
    res.json(await productsRepo.listCategories({ companyId }));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireRole(...EDITOR_ROLES), validateBody(createProductSchema), async (req, res, next) => {
  try {
    // Licentie: verlopen licentie of bereikte productlimiet blokkeert aanmaken
    // (per bedrijf; zie license.service.js).
    await require("../services/license.service").assertCanCreate(req.user.companyId, "product");

    const product = await productsRepo.createProduct({
      ...req.body,
      companyId: req.user.companyId,
      createdBy: req.user.id
    });

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.id,
      action: "create",
      entityType: "Product",
      entityId: product.id
    });

    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    // Inclusief compleetheid, checklist en QR-status voor de product-editor.
    const product = await productsRepo.getProductWithChecks(Number(req.params.id));
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);
    res.json(product);
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requireRole(...EDITOR_ROLES),
  validateBody(updateProductSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await productsRepo.getProductById(id);
      if (!existing) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, existing.company_id);

      // Persistentie (EN 18221 §4.1/§4.3): een paspoort dat ooit gepubliceerd is, is
      // via de gedrukte QR-code in omloop en moet beschikbaar blijven. Terugzetten
      // naar concept zou de QR-link breken; archiveren (blijft publiek, met melding)
      // is de juiste weg om een product van de markt te halen.
      if (req.body.status === "draft" && existing.published_at && existing.status !== "draft") {
        next(
          new HttpError(
            409,
            "Een gepubliceerd paspoort kan niet terug naar concept: gedrukte QR-codes moeten blijven werken. Archiveer het product als het niet meer op de markt is.",
            undefined,
            "PASSPORT_PERSISTENCE"
          )
        );
        return;
      }

      const updated = await productsRepo.updateProduct(id, req.body);

      await logAudit({
        companyId: existing.company_id,
        userId: req.user.id,
        action: "update",
        entityType: "Product",
        entityId: id,
        metadata: req.body
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/photo",
  requireRole(...EDITOR_ROLES),
  (req, res, next) => {
    photoUpload.single("photo")(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(400, "De afbeelding is te groot (max 5 MB)."));
        return;
      }
      next(err);
    });
  },
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await productsRepo.getProductById(id);
      if (!existing) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, existing.company_id);

      if (!req.file) {
        next(new HttpError(400, "Geen bestand ontvangen."));
        return;
      }

      const photoBlobName = await uploadProductPhoto({
        productId: id,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype
      });

      res.json(await savePhoto(req, existing, photoBlobName));
    } catch (error) {
      next(error);
    }
  }
);

// Een upload vervangt een eventueel eerder geplakte externe URL - er kan maar één
// actieve foto-bron tegelijk zijn.
async function savePhoto(req, product, photoBlobName) {
  const updated = await productsRepo.updateProduct(product.id, {
    photoBlobName,
    photoUrl: null
  });

  await logAudit({
    companyId: product.company_id,
    userId: req.user.id,
    action: "update",
    entityType: "Product",
    entityId: product.id,
    metadata: { photoBlobName }
  });

  return updated;
}

// Laadt het product en controleert de tenant; null (met 404 al afgehandeld) als het
// niet bestaat.
async function loadEditableProduct(req, next) {
  const product = await productsRepo.getProductById(Number(req.params.id));
  if (!product) {
    next(new HttpError(404, "Niet gevonden"));
    return null;
  }
  assertCompanyAccess(req.user, product.company_id);
  return product;
}

// Directe foto-upload (stap 1): eenmalige upload-URL voor precies één object.
router.post("/:id/photo/upload-url", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const product = await loadEditableProduct(req, next);
    if (!product) return;
    res.json(
      await createPhotoUpload({
        productId: product.id,
        mimeType: req.body?.mimeType,
        size: Number(req.body?.size)
      })
    );
  } catch (error) {
    next(error);
  }
});

// Directe foto-upload (stap 2): controleren en aan het product koppelen.
router.post("/:id/photo/complete", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const product = await loadEditableProduct(req, next);
    if (!product) return;
    const objectName = req.body?.objectName;
    await verifyUploadedPhoto({ objectName, productId: product.id });
    res.json(await savePhoto(req, product, objectName));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/photo", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    if (product.photo_blob_name) {
      // Kortlevende signed URL; de browser cachet de doorverwijzing maar heel even.
      res.set("Cache-Control", "private, max-age=60");
      res.redirect(302, await getProductPhotoUrl(product.photo_blob_name));
      return;
    }

    if (product.photo_url) {
      res.redirect(302, product.photo_url);
      return;
    }

    next(new HttpError(404, "Geen foto beschikbaar"));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await productsRepo.getProductById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, existing.company_id);

    const archived = await productsRepo.updateProduct(id, { status: "archived" });

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "delete",
      entityType: "Product",
      entityId: id
    });

    res.json(archived);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/publish", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await productsRepo.getProductById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, existing.company_id);

    const published = await productsRepo.publishProduct(id);

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "publish",
      entityType: "Product",
      entityId: id
    });

    res.json(published);
  } catch (error) {
    next(error);
  }
});

// QR-code reserveren zonder te publiceren: de permanente public_id wordt toegekend,
// zodat labels al gedrukt kunnen worden. Het paspoort blijft niet-openbaar tot
// "Publiceren". Idempotent: een bestaande public_id wordt nooit vervangen.
router.post("/:id/qr", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const product = await loadEditableProduct(req, next);
    if (!product) return;
    if (product.public_id) {
      res.json(product);
      return;
    }
    const updated = await productsRepo.reserveQr(product.id);
    await logAuditFromReq(req, {
      companyId: product.company_id,
      action: "qr_reserve",
      entityType: "Product",
      entityId: product.id
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Dupliceren: basisgegevens + duurzaamheid + compliance. Bewust zonder documenten,
// foto-upload en QR-code: het duplicaat is een nieuw concept met een eigen identiteit.
router.post("/:id/duplicate", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const source = await loadEditableProduct(req, next);
    if (!source) return;
    await require("../services/license.service").assertCanCreate(req.user.companyId, "product");

    const copy = await productsRepo.createProduct({
      companyId: source.company_id,
      createdBy: req.user.id,
      name: `${source.name} (kopie)`.slice(0, 200),
      brand: source.brand,
      model: source.model,
      // SKU/GTIN zijn identificerend; die horen niet stilzwijgend dubbel te bestaan.
      sku: null,
      gtin: null,
      categoryLabel: source.category_label,
      description: source.description,
      manufacturer: source.manufacturer,
      countryOfOrigin: source.country_of_origin,
      photoUrl: source.photo_url
    });

    const [sustainability, compliance] = await Promise.all([
      sustainabilityRepo.getSustainability(source.id),
      complianceRepo.getCompliance(source.id)
    ]);
    if (sustainability) {
      await sustainabilityRepo.upsertSustainability(copy.id, {
        co2FootprintKg: sustainability.co2_footprint_kg,
        co2ReductionPct: sustainability.co2_reduction_pct,
        recycledMaterialPct: sustainability.recycled_material_pct,
        materials: sustainability.materials,
        epdUrl: sustainability.epd_url,
        recyclable: sustainability.recyclable,
        reachConform: sustainability.reach_conform,
        rohsConform: sustainability.rohs_conform,
        expectedLifespanYears: sustainability.expected_lifespan_years
      });
    }
    if (compliance) {
      await complianceRepo.upsertCompliance(copy.id, {
        ceMarked: compliance.ce_marked,
        applicableRegulations: compliance.applicable_regulations
      });
    }

    await logAuditFromReq(req, {
      companyId: source.company_id,
      action: "duplicate",
      entityType: "Product",
      entityId: copy.id,
      metadata: { sourceId: source.id }
    });
    res.status(201).json(copy);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/parts", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    res.json(await partsRepo.listPartsForProduct(id));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/parts",
  requireRole(...EDITOR_ROLES),
  validateBody(createPartSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      const part = await partsRepo.createPart({
        productId: id,
        companyId: product.company_id,
        ...req.body
      });

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "create",
        entityType: "ProductPart",
        entityId: part.id
      });

      res.status(201).json(part);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/sustainability", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    res.json(await sustainabilityRepo.getSustainability(id));
  } catch (error) {
    next(error);
  }
});

router.put(
  "/:id/sustainability",
  requireRole(...EDITOR_ROLES),
  validateBody(updateSustainabilitySchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      const sustainability = await sustainabilityRepo.upsertSustainability(id, req.body);

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "update",
        entityType: "ProductSustainability",
        entityId: id,
        metadata: req.body
      });

      res.json(sustainability);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/compliance", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    res.json(await complianceRepo.getCompliance(id));
  } catch (error) {
    next(error);
  }
});

router.put(
  "/:id/compliance",
  requireRole(...EDITOR_ROLES),
  validateBody(updateComplianceSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      const compliance = await complianceRepo.upsertCompliance(id, req.body);

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "update",
        entityType: "ProductCompliance",
        entityId: id,
        metadata: req.body
      });

      res.json(compliance);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/batches", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    res.json(await batchesRepo.listBatchesForProduct(id));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/batches",
  requireRole(...EDITOR_ROLES),
  validateBody(createBatchSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      const batch = await batchesRepo.createBatch({
        productId: id,
        companyId: product.company_id,
        ...req.body
      });

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "create",
        entityType: "ProductBatch",
        entityId: batch.id
      });

      res.status(201).json(batch);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/documents", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    res.json(await documentsRepo.listDocumentsForProduct(id));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/documents",
  requireRole(...EDITOR_ROLES),
  validateBody(createDocumentSchema),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      const document = await documentsRepo.createDocument({
        companyId: product.company_id,
        productId: id,
        ...req.body,
        uploadedBy: req.user.id
      });

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "create",
        entityType: "Document",
        entityId: document.id
      });

      res.status(201).json(document);
    } catch (error) {
      next(error);
    }
  }
);

// Documentupload (PDF/JPEG/PNG/SVG/WEBP, max 10 MB) naar de private
// documenten-container; zelfde patroon als de foto-upload.
router.post(
  "/:id/documents/upload",
  requireRole(...EDITOR_ROLES),
  (req, res, next) => {
    documentUpload.single("file")(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        next(
          new HttpError(
            400,
            `Het bestand is te groot (max ${DOCUMENT_MAX_MB} MB). Verklein de PDF (bijv. comprimeren of splitsen) en probeer opnieuw.`
          )
        );
        return;
      }
      next(err);
    });
  },
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      if (!req.file) {
        next(new HttpError(400, "Geen bestand ontvangen."));
        return;
      }
      const title = (req.body.title || "").trim();
      if (!title) {
        next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { title: ["Vul een titel in"] } }));
        return;
      }

      const blobName = await uploadProductDocument({
        productId: id,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype
      });

      const document = await saveUploadedDocument(req, product, {
        blobName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      });
      res.status(201).json(document);
    } catch (error) {
      next(error);
    }
  }
);

// Optionele metadata bij een upload (multipart of JSON): ongeldige waarden worden
// genegeerd i.p.v. de hele upload te laten mislukken.
function optionalUploadMetadata(body) {
  const validUntil = isoDate.safeParse(body.validUntil);
  const version = typeof body.version === "string" ? body.version.trim().slice(0, 30) : "";
  return { validUntil: validUntil.success ? validUntil.data : null, version: version || null };
}

async function saveUploadedDocument(req, product, { blobName, fileSize, mimeType }) {
  const isPublic = req.body.isPublic === true || req.body.isPublic === "true" || req.body.isPublic === "1";
  const document = await documentsRepo.createDocument({
    companyId: product.company_id,
    productId: product.id,
    type: req.body.type || mimeType.split("/")[1] || "document",
    title: String(req.body.title || "").trim(),
    language: req.body.language || null,
    blobName,
    fileSize,
    mimeType,
    isPublic,
    category: DOCUMENT_CATEGORIES.includes(req.body.category) ? req.body.category : "document",
    ...optionalUploadMetadata(req.body),
    uploadedBy: req.user.id
  });

  await logAudit({
    companyId: product.company_id,
    userId: req.user.id,
    action: "create",
    entityType: "Document",
    entityId: document.id,
    metadata: { upload: true, fileSize, mimeType }
  });

  return document;
}

function missingTitle(req, next) {
  if (String(req.body?.title || "").trim()) return false;
  next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { title: ["Vul een titel in"] } }));
  return true;
}

// Directe documentupload (stap 1): titel vooraf valideren, dan een eenmalige upload-URL.
router.post("/:id/documents/upload-url", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const product = await loadEditableProduct(req, next);
    if (!product) return;
    if (missingTitle(req, next)) return;
    res.json(
      await createDocumentUpload({
        productId: product.id,
        mimeType: req.body.mimeType,
        size: Number(req.body.size)
      })
    );
  } catch (error) {
    next(error);
  }
});

// Directe documentupload (stap 2): object controleren en het document vastleggen.
router.post("/:id/documents/complete", requireRole(...EDITOR_ROLES), async (req, res, next) => {
  try {
    const product = await loadEditableProduct(req, next);
    if (!product) return;
    if (missingTitle(req, next)) return;
    const objectName = req.body.objectName;
    const { size, mimeType } = await verifyUploadedDocument({ objectName, productId: product.id });
    const document = await saveUploadedDocument(req, product, { blobName: objectName, fileSize: size, mimeType });
    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
});

// Geüpload document (of URL-document via redirect) ophalen - zelfde
// toegangsregels als de rest van het product.
router.get("/:id/documents/:documentId/file", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);

    const document = await documentsRepo.getDocumentById(Number(req.params.documentId));
    if (!document || document.product_id !== id) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (document.blob_name) {
      res.set("Cache-Control", "private, max-age=60");
      res.redirect(302, await getProductDocumentUrl(document.blob_name));
      return;
    }
    if (document.storage_url) {
      res.redirect(document.storage_url);
      return;
    }
    next(new HttpError(404, "Niet gevonden"));
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/:id/documents/:documentId",
  requireRole(...EDITOR_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await productsRepo.getProductById(id);
      if (!product) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, product.company_id);

      // Alleen documenten van dít product: een document-id van een ander product in
      // de URL geeft 404 i.p.v. stil andermans document te verwijderen.
      const deleted = await documentsRepo.deleteDocument(Number(req.params.documentId), id);
      if (!deleted) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "delete",
        entityType: "Document",
        entityId: req.params.documentId
      });

      res.json(deleted);
    } catch (error) {
      next(error);
    }
  }
);

// Metadata van een document wijzigen (titel, openbaar/privé, categorie, geldigheid).
router.patch(
  "/:id/documents/:documentId",
  requireRole(...EDITOR_ROLES),
  validateBody(updateDocumentSchema),
  async (req, res, next) => {
    try {
      const product = await loadEditableProduct(req, next);
      if (!product) return;
      const updated = await documentsRepo.updateDocument(Number(req.params.documentId), product.id, req.body);
      if (!updated) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      await logAuditFromReq(req, {
        companyId: product.company_id,
        action: "update",
        entityType: "Document",
        entityId: updated.id,
        metadata: { fields: Object.keys(req.body) }
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/qr.png", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);
    if (!product.public_id) {
      next(new HttpError(404, "Product is nog niet gepubliceerd"));
      return;
    }

    const url = getPassportUrl(req, product.public_id);
    // ?size=1200 levert een print-PNG (bijv. 4 cm op 300 DPI ≈ 470 px); standaard 512.
    const size = Math.min(2400, Math.max(128, Number.parseInt(req.query.size, 10) || 512));
    const buffer = await generateQrPngBuffer(url, { width: size });

    res.set("Content-Type", "image/png");
    if (req.query.download) {
      res.attachment(`qr-${qrFileStem(product)}.png`);
    }
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/qr.svg", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);
    if (!product.public_id) {
      next(new HttpError(404, "Product is nog niet gepubliceerd"));
      return;
    }

    const url = getPassportUrl(req, product.public_id);
    const svg = await generateQrSvgString(url);

    res.set("Content-Type", "image/svg+xml");
    if (req.query.download) {
      res.attachment(`qr-${qrFileStem(product)}.svg`);
    }
    res.send(svg);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/qr-label.pdf", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await productsRepo.getProductById(id);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    assertCompanyAccess(req.user, product.company_id);
    if (!product.public_id) {
      next(new HttpError(404, "Product is nog niet gepubliceerd"));
      return;
    }

    const url = getPassportUrl(req, product.public_id);
    const qrPngBuffer = await generateQrPngBuffer(url);
    const pdfBuffer = await generateLabelPdfBuffer({ product, qrPngBuffer });

    res.set("Content-Type", "application/pdf");
    if (req.query.download) {
      res.attachment(`label-${qrFileStem(product)}.pdf`);
    }
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// Bestandsnaam voor downloads: SKU als die er is, anders het product-id.
function qrFileStem(product) {
  const base = product.sku || String(product.id);
  return base.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || String(product.id);
}

// --- export voor replicatie / back-up-dienstverlener (EN 18221 §4.3-4.5) -----------
// Alle paspoorten van één bedrijf die op de markt zijn, met de actuele stand en
// ALLE gearchiveerde versies (incl. hashes), als NDJSON-stream (één regel per
// paspoort). Bedoeld als "overeengekomen, veilig replicatiemechanisme" richting een
// back-up-dienstverlener en als exit-/portabiliteitsexport. Alleen Company Admin
// (eigen bedrijf) en Platform Owner (?companyId=). Elke export komt in de audittrail.
router.get("/passports/export", requireRole(...PLATFORM_OWNER_ROLES, "company_admin"), heavyExportLimiter, async (req, res, next) => {
  try {
    const companyId = isPlatformOwner(req.user.role) ? Number(req.query.companyId) : req.user.companyId;
    if (!Number.isInteger(companyId) || companyId < 1) throw new HttpError(400, "companyId is verplicht");
    const { getPool } = require("../config/db");
    const passport = require("../services/passport.service");
    const archive = require("../services/passportArchive.service");
    const pool = await getPool();

    await logAuditFromReq(req, { companyId, action: "passport_export", entityType: "Company", entityId: companyId });

    res.type("application/x-ndjson; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="veripasso-paspoorten-${companyId}.ndjson"`);
    res.set("Cache-Control", "no-store");
    res.write(`${JSON.stringify({ type: "header", format: "veripasso-dpp-export", formatVersion: 1, companyId, exportedAt: new Date().toISOString() })}\n`);

    let lastId = 0;
    for (;;) {
      const batch = await pool.query(
        `SELECT id FROM dbo.products
         WHERE company_id = $1 AND id > $2 AND public_id IS NOT NULL AND published_at IS NOT NULL
           AND status IN ('published', 'archived')
         ORDER BY id LIMIT 100`,
        [companyId, lastId]
      );
      if (!batch.rows.length) break;
      for (const { id } of batch.rows) {
        const product = await passport.loadProduct(id);
        const current = await passport.buildSnapshot(product);
        const versions = [];
        for (const meta of await archive.listVersions(id)) {
          versions.push(await archive.getVersion(id, meta.versionNumber));
        }
        const line = {
          type: "passport",
          publicId: current.publicId,
          current,
          currentContentSha256: passport.contentHash(current),
          versions: versions.map((v) => ({
            versionNumber: v.versionNumber,
            createdAt: v.createdAt,
            reason: v.reason,
            contentSha256: v.contentSha256,
            previousChainSha256: v.previousChainSha256,
            chainSha256: v.chainSha256,
            snapshot: v.snapshot
          }))
        };
        if (!res.write(`${JSON.stringify(line)}\n`)) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
        lastId = id;
      }
    }
    res.end(`${JSON.stringify({ type: "footer", complete: true })}\n`);
  } catch (error) {
    if (res.headersSent) {
      require("../utils/logger").error("passport_export_failed", { errorMessage: error.message });
      res.end();
      return;
    }
    next(error);
  }
});

// --- versiegeschiedenis van het paspoort (EN 18221 §4.2) ----------------------------
// Voor ingelogde gebruikers van het eigen bedrijf (en de Platform Owner): alle
// versies, inclusief niet-openbare documentmetadata. Het publieke equivalent (alleen
// openbare velden) staat onder /api/dpp/:publicId/versions.

async function loadReadableProduct(req) {
  const product = await productsRepo.getProductById(Number(req.params.id));
  if (!product) throw new HttpError(404, "Niet gevonden");
  assertCompanyAccess(req.user, product.company_id);
  return product;
}

router.get("/:id/versions", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const product = await loadReadableProduct(req);
    const archive = require("../services/passportArchive.service");
    res.json({ productId: product.id, versions: await archive.listVersions(product.id) });
  } catch (error) {
    next(error);
  }
});

// Integriteitscontrole van de hele versieketen (hashes en nummering).
router.get("/:id/versions/verify", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const product = await loadReadableProduct(req);
    res.json(await require("../services/passportArchive.service").verifyChain(product.id));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/versions/:version", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    const product = await loadReadableProduct(req);
    const versionNumber = Number(req.params.version);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new HttpError(400, "Ongeldig versienummer");
    const version = await require("../services/passportArchive.service").getVersion(product.id, versionNumber);
    if (!version) throw new HttpError(404, "Versie niet gevonden");
    res.json(version);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
