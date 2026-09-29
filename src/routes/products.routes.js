const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
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

const router = express.Router();

const { PLATFORM_OWNER_ROLES, isPlatformOwner } = require("../utils/roles");

const ALL_ROLES = [...PLATFORM_OWNER_ROLES, "company_admin", "company_user"];
const EDITOR_ROLES = ["company_admin", "company_user"];

router.use(requireAuth);

router.get("/", requireRole(...ALL_ROLES), async (req, res, next) => {
  try {
    if (isPlatformOwner(req.user.role)) {
      const companyId = req.query.companyId !== undefined ? Number(req.query.companyId) : undefined;
      res.json(await productsRepo.listProducts({ companyId }));
      return;
    }

    res.json(await productsRepo.listProducts({ companyId: req.user.companyId }));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireRole(...EDITOR_ROLES), validateBody(createProductSchema), async (req, res, next) => {
  try {
    const product = await productsRepo.createProduct({
      ...req.body,
      companyId: req.user.companyId
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
