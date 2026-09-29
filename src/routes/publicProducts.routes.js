const express = require("express");
const productsRepo = require("../repositories/products.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");
const partsRepo = require("../repositories/parts.repository");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Publiek endpoint, geen requireAuth/requireRole: iedereen met de public_id (via de
// QR-code) mag dit productpaspoort zien. De response is bewust een whitelist: nooit
// company_id, interne id's of audit-data laten lekken naar buiten.
router.get("/:publicId", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const [sustainability, compliance, parts, documents] = await Promise.all([
      sustainabilityRepo.getSustainability(product.id),
      complianceRepo.getCompliance(product.id),
      partsRepo.listPartsForProduct(product.id),
      documentsRepo.listDocumentsForProduct(product.id, { onlyPublic: true })
    ]);

    // Fire-and-forget: een mislukte scan-registratie mag de paspoortweergave nooit blokkeren.
    Promise.resolve()
      .then(() =>
        scanEventsRepo.recordScanEvent({
          productId: product.id,
          userAgent: req.get("user-agent"),
          referrer: req.get("referer")
        })
      )
      .catch(() => {});

    let highlights = [];
    if (product.highlights) {
      try {
        highlights = JSON.parse(product.highlights);
      } catch {
        highlights = [];
      }
    }

    // sustainability.materials en compliance.applicable_regulations komen als rauwe
    // JSON-strings uit de database (NVARCHAR(MAX)) - hier veilig parsen zodat de
    // frontend altijd een echte array krijgt, nooit een string om per ongeluk over
    // te itereren.
    if (sustainability && typeof sustainability.materials === "string") {
      try {
        sustainability.materials = JSON.parse(sustainability.materials);
      } catch {
        sustainability.materials = [];
      }
    }
    if (compliance && typeof compliance.applicable_regulations === "string") {
      try {
        compliance.applicable_regulations = JSON.parse(compliance.applicable_regulations);
      } catch {
        compliance.applicable_regulations = [];
      }
    }

    res.json({
      name: product.name,
      brand: product.brand,
      model: product.model,
      sku: product.sku,
      gtin: product.gtin,
      categoryLabel: product.category_label,
      description: product.description,
      manufacturer: product.manufacturer,
      countryOfOrigin: product.country_of_origin,
      photoUrl: product.photo_url,
      highlights,
      publishedAt: product.published_at,
      sustainability,
      compliance,
      parts,
      documents
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
