const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { updateDocumentSchema, listDocumentsQuerySchema } = require("../schemas/documents.schema");
const documentsRepo = require("../repositories/documents.repository");
const { assertCompanyAccess } = require("../utils/tenant");
const { parseId, parseOptionalId } = require("../utils/params");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { PERMISSIONS, isSystemOwner } = require("../auth/permissions");

// Documenten over alle producten van de eigen company heen. Aanmaken gebeurt via
// POST /api/products/:id/documents (products.routes.js): een document hoort altijd bij een product.
const router = express.Router();

router.use(requireAuth);

// Onbekend of van een andere company -> 404, nooit 403.
async function loadDocument(req) {
  const id = parseId(req.params.id);
  const document = await documentsRepo.getDocumentById(id);
  if (!document) {
    throw new HttpError(404, "Niet gevonden");
  }
  assertCompanyAccess(req.user, document.company_id);
  return document;
}

// Een gearchiveerd product is alleen-lezen, ook zijn documenten: eerst terugzetten naar concept.
function assertProductNotArchived(document) {
  if (document.product_status === "archived") {
    throw new HttpError(409, "Het product van dit document is gearchiveerd", undefined, "PRODUCT_ARCHIVED");
  }
}

router.get("/", requirePermission(PERMISSIONS.DOCUMENTS_READ), async (req, res, next) => {
  try {
    const parsed = listDocumentsQuerySchema.safeParse({ type: req.query.type });
    if (!parsed.success) {
      throw new HttpError(400, "Ongeldige invoer", parsed.error.flatten());
    }

    // Tenant-scope uit de sessie; alleen de System Owner mag op een company filteren. Een
    // productId van een andere company levert voor een company-gebruiker gewoon een lege lijst.
    const companyId = isSystemOwner(req.user) ? parseOptionalId(req.query.companyId) : req.user.companyId;
    const productId = parseOptionalId(req.query.productId);

    res.json(await documentsRepo.listDocuments({ companyId, productId, type: parsed.data.type }));
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.DOCUMENTS_MANAGE),
  validateBody(updateDocumentSchema),
  async (req, res, next) => {
    try {
      const existing = await loadDocument(req);
      assertProductNotArchived(existing);

      const updated = await documentsRepo.updateDocument(existing.id, req.body);

      // Alleen veldnamen: een URL kan een deel-token in de query bevatten.
      await logAudit({
        companyId: existing.company_id,
        userId: req.user.id,
        action: "document_update",
        entityType: "Document",
        entityId: existing.id,
        metadata: {
          productId: existing.product_id,
          fields: Object.keys(req.body).filter((field) => req.body[field] !== undefined)
        }
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/:id", requirePermission(PERMISSIONS.DOCUMENTS_MANAGE), async (req, res, next) => {
  try {
    const existing = await loadDocument(req);
    assertProductNotArchived(existing);

    const deleted = await documentsRepo.deleteDocument(existing.id);
    if (!deleted) {
      // Gelijktijdig al verwijderd: voor deze client bestaat het document niet (meer).
      throw new HttpError(404, "Niet gevonden");
    }

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "document_delete",
      entityType: "Document",
      entityId: existing.id,
      metadata: { productId: existing.product_id, type: existing.type, title: existing.title }
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
