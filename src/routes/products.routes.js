const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const {
  GENERAL_FIELDS,
  COMPLIANCE_FIELDS,
  createProductSchema,
  updateProductSchema,
  productStatusSchema,
  listProductsQuerySchema,
  qrQuerySchema
} = require("../schemas/products.schema");
const { createDocumentSchema } = require("../schemas/documents.schema");
const productsRepo = require("../repositories/products.repository");
const documentsRepo = require("../repositories/documents.repository");
const {
  canTransition,
  getChecklist,
  getMissingRequiredAfterUpdate,
  STATUS_CHANGE_PERMISSIONS
} = require("../services/productWorkflow");
const qrService = require("../services/qr.service");
const { assertCompanyAccess } = require("../utils/tenant");
const { parseId, parseOptionalId } = require("../utils/params");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { PERMISSIONS, hasPermission, isSystemOwner } = require("../auth/permissions");

const router = express.Router();

router.use(requireAuth);

// Minstens één van de permissies. Voor routes waar de precieze eis pas na het lezen van de
// body vaststaat (PATCH: per veld; status: per transitie), zodat wie géén van de relevante
// permissies heeft (viewer, System Owner) direct een 403 krijgt.
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!permissions.some((permission) => hasPermission(req.user, permission))) {
      next(new HttpError(403, "Geen toegang"));
      return;
    }
    next();
  };
}

function productArchivedError() {
  return new HttpError(409, "Dit product is gearchiveerd; zet het eerst terug naar concept", undefined, "PRODUCT_ARCHIVED");
}

// Laadt een product en past de tenant-regels toe: onbekend of van een andere company -> 404.
async function loadProduct(req) {
  const id = parseId(req.params.id);
  const product = await productsRepo.getProductById(id);
  if (!product) {
    throw new HttpError(404, "Niet gevonden");
  }
  assertCompanyAccess(req.user, product.company_id);
  return product;
}

// Interne API-weergave (DB-rij, snake_case). public_url alleen zolang het product echt
// gepubliceerd is: na depubliceren blijft public_id bestaan, maar de pagina geeft 404.
function toClientProduct(req, row, { includeCompanyName = true } = {}) {
  const product = {
    ...row,
    public_id: row.public_id ? qrService.normalizePublicId(row.public_id) : null,
    public_url: row.status === "published" && row.public_id ? qrService.buildPublicUrl(req, row.public_id) : null
  };
  if (!includeCompanyName) {
    delete product.company_name;
  }
  return product;
}

// Per meegestuurd veld de bijbehorende permissie (§8): compliancevelden vereisen
// products:compliance, algemene velden `generalPermission`. Een veld dat in geen van beide
// lijsten staat, wordt geweigerd (fail closed). Alles of niets: één niet-toegestaan veld
// weigert het hele verzoek, zodat er nooit een half toegepaste wijziging ontstaat.
function requiredPermissionForField(field, generalPermission) {
  if (COMPLIANCE_FIELDS.includes(field)) return PERMISSIONS.PRODUCTS_COMPLIANCE;
  if (GENERAL_FIELDS.includes(field)) return generalPermission;
  return null;
}

function assertFieldPermissions(user, body, { generalPermission }) {
  const notPermitted = Object.keys(body).filter((field) => {
    if (body[field] === undefined) return false;
    const required = requiredPermissionForField(field, generalPermission);
    return !required || !hasPermission(user, required);
  });

  if (notPermitted.length > 0) {
    throw new HttpError(
      403,
      "Je hebt geen rechten om deze velden te wijzigen",
      { fields: notPermitted },
      "FIELD_NOT_PERMITTED"
    );
  }
}

// Eén plek voor elke statuswissel (POST /:id/status en DELETE = archiveren), zodat de
// transitietabel, de checklist en de audit-actie nooit per route kunnen afwijken.
async function applyStatusChange(req, product, to) {
  const from = product.status;
  const check = canTransition(req.user, from, to);

  if (!check.ok && check.code === "INVALID_TRANSITION") {
    throw new HttpError(409, `Statuswijziging van '${from}' naar '${to}' is niet toegestaan`, { from, to }, "INVALID_TRANSITION");
  }
  if (!check.ok) {
    throw new HttpError(403, "Je hebt geen rechten voor deze statuswijziging", { from, to }, "TRANSITION_NOT_PERMITTED");
  }

  if (check.transition.requiresChecklist) {
    const publicDocumentCount = await documentsRepo.countPublicDocuments(product.id);
    const checklist = getChecklist(product, { publicDocumentCount });
    if (!checklist.ready) {
      throw new HttpError(
        422,
        "Het product voldoet nog niet aan de publicatie-eisen",
        { missing: checklist.missing },
        "PUBLISH_REQUIREMENTS_MISSING"
      );
    }
  }

  const updated = await productsRepo.changeStatus({ id: product.id, from, to, updatedBy: req.user.id });
  if (!updated) {
    // De status is tussen het laden en opslaan door iemand anders gewijzigd.
    throw new HttpError(409, "De status van dit product is intussen gewijzigd; laad het opnieuw", { from, to }, "INVALID_TRANSITION");
  }

  await logAudit({
    companyId: product.company_id,
    userId: req.user.id,
    action: check.transition.action,
    entityType: "Product",
    entityId: product.id,
    metadata: { from, to }
  });

  return updated;
}

router.get("/", requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const parsed = listProductsQuerySchema.safeParse({
      status: req.query.status,
      q: req.query.q,
      category: req.query.category
    });
    if (!parsed.success) {
      throw new HttpError(400, "Ongeldige invoer", parsed.error.flatten());
    }

    // Tenant-scope uit de sessie; alleen de System Owner mag (optioneel) op een company filteren.
    const systemOwner = isSystemOwner(req.user);
    const companyId = systemOwner ? parseOptionalId(req.query.companyId) : req.user.companyId;

    const rows = await productsRepo.listProducts({ companyId, ...parsed.data });
    res.json(rows.map((row) => toClientProduct(req, row, { includeCompanyName: systemOwner })));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requirePermission(PERMISSIONS.PRODUCTS_CREATE),
  validateBody(createProductSchema),
  async (req, res, next) => {
    try {
      // Algemene velden vallen onder products:create; compliancevelden vereisen daarnaast
      // products:compliance (een medewerker mag een product aanmaken, geen materialen invullen).
      assertFieldPermissions(req.user, req.body, { generalPermission: PERMISSIONS.PRODUCTS_CREATE });

      const product = await productsRepo.createProduct({
        companyId: req.user.companyId,
        createdBy: req.user.id,
        fields: req.body
      });

      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "create",
        entityType: "Product",
        entityId: product.id,
        metadata: { fields: Object.keys(req.body).filter((field) => req.body[field] !== undefined) }
      });

      res.status(201).json(toClientProduct(req, product));
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id", requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const product = await loadProduct(req);
    res.json(toClientProduct(req, product));
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requireAnyPermission(PERMISSIONS.PRODUCTS_UPDATE, PERMISSIONS.PRODUCTS_COMPLIANCE),
  validateBody(updateProductSchema),
  async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      assertFieldPermissions(req.user, req.body, { generalPermission: PERMISSIONS.PRODUCTS_UPDATE });

      const existing = await loadProduct(req);
      if (existing.status === "archived") {
        throw productArchivedError();
      }

      if (existing.status === "published") {
        const missing = getMissingRequiredAfterUpdate(existing, req.body);
        if (missing.length > 0) {
          throw new HttpError(
            422,
            "Een gepubliceerd product moet aan de publicatie-eisen blijven voldoen. Depubliceer het eerst om verplichte velden leeg te maken.",
            { missing },
            "PUBLISH_REQUIREMENTS_MISSING"
          );
        }
      }

      const updated = await productsRepo.updateProduct(id, req.body, req.user.id);
      if (!updated) {
        // Tussen laden en opslaan gearchiveerd (de UPDATE sluit archived atomair uit).
        throw productArchivedError();
      }

      // Alleen de veldnamen: de inhoud (lange teksten, interne notities) hoort niet in de audit log.
      await logAudit({
        companyId: existing.company_id,
        userId: req.user.id,
        action: "update",
        entityType: "Product",
        entityId: id,
        metadata: { fields: Object.keys(req.body).filter((field) => req.body[field] !== undefined) }
      });

      res.json(toClientProduct(req, updated));
    } catch (error) {
      next(error);
    }
  }
);

// DELETE verwijdert nooit echt: een product kan al een geprinte QR-code en scanhistorie
// hebben. Het is een archivering via dezelfde statusflow als POST /:id/status.
router.delete("/:id", requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE), async (req, res, next) => {
  try {
    const product = await loadProduct(req);
    const archived = await applyStatusChange(req, product, "archived");
    res.json(toClientProduct(req, archived));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/status",
  requireAnyPermission(...STATUS_CHANGE_PERMISSIONS),
  validateBody(productStatusSchema),
  async (req, res, next) => {
    try {
      const product = await loadProduct(req);
      const updated = await applyStatusChange(req, product, req.body.status);
      res.json(toClientProduct(req, updated));
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/checklist", requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const product = await loadProduct(req);
    const publicDocumentCount = await documentsRepo.countPublicDocuments(product.id);
    const { ready, items } = getChecklist(product, { publicDocumentCount });
    res.json({ ready, items });
  } catch (error) {
    next(error);
  }
});

// QR-codes alleen voor gepubliceerde producten: een QR naar een concept zou op een 404
// uitkomen. Alleen ?download=1 telt als "genereren" (audit + attachment); de voorvertoning
// in de UI niet, anders zou elke paginaweergave een audit-regel opleveren.
async function sendQr(req, res, format) {
  const id = parseId(req.params.id);
  // SVG schaalt vrij: size wordt voor SVG genegeerd (docs §8) en daarom ook niet gevalideerd,
  // anders zou ?size=5000 op een SVG een 400 geven voor een parameter die niets doet.
  const parsed = qrQuerySchema.safeParse({
    size: format === "png" ? req.query.size : undefined,
    download: req.query.download
  });
  if (!parsed.success) {
    throw new HttpError(400, "Ongeldige invoer", parsed.error.flatten());
  }

  const product = await loadProduct(req);
  if (product.status !== "published" || !product.public_id) {
    throw new HttpError(409, "Een QR-code is alleen beschikbaar voor gepubliceerde producten", undefined, "NOT_PUBLISHED");
  }

  const content = qrService.buildQrContent(req, product.public_id);
  const size = parsed.data.size ?? qrService.QR_DEFAULT_SIZE;
  const download = parsed.data.download === "1";

  const body = format === "png" ? await qrService.generatePng(content, size) : await qrService.generateSvg(content);

  // private: hoort niet in een gedeelde proxycache. no-cache: na depubliceren moet de
  // voorvertoning direct weer de actuele status (409) laten zien.
  res.set("Cache-Control", "private, no-cache");
  res.type(format === "png" ? "image/png" : "image/svg+xml");
  if (download) {
    res.set("Content-Disposition", `attachment; filename="${qrService.buildQrFilename(product, format)}"`);
    await logAudit({
      companyId: product.company_id,
      userId: req.user.id,
      action: "qr_generate",
      entityType: "Product",
      entityId: id,
      metadata: format === "png" ? { format, size } : { format }
    });
  }
  res.send(body);
}

router.get("/:id/qr.png", requirePermission(PERMISSIONS.QR_DOWNLOAD), async (req, res, next) => {
  try {
    await sendQr(req, res, "png");
  } catch (error) {
    next(error);
  }
});

router.get("/:id/qr.svg", requirePermission(PERMISSIONS.QR_DOWNLOAD), async (req, res, next) => {
  try {
    await sendQr(req, res, "svg");
  } catch (error) {
    next(error);
  }
});

// Documenten van één product. Beheer van losse documenten (PATCH/DELETE) staat in
// documents.routes.js; aanmaken hangt hier aan het product, zodat company_id altijd van het
// product komt en nooit uit de body.
router.get("/:id/documents", requirePermission(PERMISSIONS.DOCUMENTS_READ), async (req, res, next) => {
  try {
    const product = await loadProduct(req);
    res.json(await documentsRepo.listDocumentsForProduct(product.id));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/documents",
  requirePermission(PERMISSIONS.DOCUMENTS_MANAGE),
  validateBody(createDocumentSchema),
  async (req, res, next) => {
    try {
      const product = await loadProduct(req);
      if (product.status === "archived") {
        throw productArchivedError();
      }

      const document = await documentsRepo.createDocument({
        ...req.body,
        companyId: product.company_id,
        productId: product.id,
        createdBy: req.user.id
      });

      // Geen URL in de audit: een link kan een deel-token (bijv. SAS) in de query bevatten.
      await logAudit({
        companyId: product.company_id,
        userId: req.user.id,
        action: "document_create",
        entityType: "Document",
        entityId: document.id,
        metadata: { productId: product.id, type: document.type, isPublic: Boolean(document.is_public) }
      });

      res.status(201).json(document);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
