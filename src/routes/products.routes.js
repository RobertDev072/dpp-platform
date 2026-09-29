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
const { createDocumentSchema } = require("../schemas/documents.schema");
const productsRepo = require("../repositories/products.repository");
const partsRepo = require("../repositories/parts.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");
const batchesRepo = require("../repositories/batches.repository");
const documentsRepo = require("../repositories/documents.repository");
const { assertCompanyAccess } = require("../utils/tenant");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { getQrBaseUrl } = require("../utils/baseUrl");
const {
  generateQrPngBuffer,
  generateQrSvgString,
  generateLabelPdfBuffer
} = require("../services/qrCode.service");
const {
  uploadProductPhoto,
  downloadProductPhoto,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  uploadProductDocument,
  downloadProductDocument
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

const ALL_ROLES = [...PLATFORM_OWNER_ROLES, "company_admin", "company_user"];
const EDITOR_ROLES = ["company_admin", "company_user"];

router.use(requireAuth);

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
    const product = await productsRepo.getProductById(Number(req.params.id));
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
        buffer: req.file.buffer,
        mimeType: req.file.mimetype
      });

      // Een upload vervangt een eventueel eerder geplakte externe URL - er kan maar één
      // actieve foto-bron tegelijk zijn.
      const updated = await productsRepo.updateProduct(id, {
        photoBlobName,
        photoUrl: null
      });

      await logAudit({
        companyId: existing.company_id,
        userId: req.user.id,
        action: "update",
        entityType: "Product",
        entityId: id,
        metadata: { photoBlobName }
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

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
      const { stream, contentType, contentLength } = await downloadProductPhoto(
        product.photo_blob_name
      );
      res.set("Content-Type", contentType || "application/octet-stream");
      if (contentLength) res.set("Content-Length", String(contentLength));
      res.set("Cache-Control", "private, max-age=300");
      stream.on("error", () => res.destroy());
      stream.pipe(res);
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
        ...req.body
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
        buffer: req.file.buffer,
        mimeType: req.file.mimetype
      });

      const document = await documentsRepo.createDocument({
        companyId: product.company_id,
        productId: id,
        type: req.body.type || req.file.mimetype.split("/")[1] || "document",
        title,
        language: req.body.language || null,
        blobName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        isPublic: req.body.isPublic === "true" || req.body.isPublic === "1",
        category: ["document", "manual", "video", "3d_model"].includes(req.body.category) ? req.body.category : "document"
      });

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "create",
        entityType: "Document",
        entityId: document.id,
        metadata: { upload: true, fileSize: req.file.size, mimeType: req.file.mimetype }
      });

      res.status(201).json(document);
    } catch (error) {
      next(error);
    }
  }
);

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
      const { stream, contentType, contentLength } = await downloadProductDocument(document.blob_name);
      res.setHeader("Content-Type", contentType || document.mime_type || "application/octet-stream");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.title)}.${(document.mime_type || "").split("/")[1] || "bin"}"`);
      stream.pipe(res);
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

      const deleted = await documentsRepo.deleteDocument(Number(req.params.documentId));

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "delete",
        entityType: "Document",
        entityId: req.params.documentId
      });

      res.json(deleted || { id: Number(req.params.documentId) });
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

    const url = `${getQrBaseUrl(req)}/p/${product.public_id}`;
    const buffer = await generateQrPngBuffer(url);

    res.set("Content-Type", "image/png");
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

    const url = `${getQrBaseUrl(req)}/p/${product.public_id}`;
    const svg = await generateQrSvgString(url);

    res.set("Content-Type", "image/svg+xml");
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

    const url = `${getQrBaseUrl(req)}/p/${product.public_id}`;
    const qrPngBuffer = await generateQrPngBuffer(url);
    const pdfBuffer = await generateLabelPdfBuffer({ product, qrPngBuffer });

    res.set("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
