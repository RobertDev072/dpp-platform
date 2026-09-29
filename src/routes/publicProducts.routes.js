const express = require("express");
const productsRepo = require("../repositories/products.repository");
const { downloadProductPhoto } = require("../services/blobStorage.service");
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
      // Stabiele, eigen link i.p.v. de rauwe photo_url/blobnaam: bij een upload gaat dit
      // achter de schermen via een kortlevende SAS (de container is prive), bij een
      // geplakte externe URL redirect dezelfde route er gewoon naartoe. De frontend hoeft
      // dat onderscheid niet te kennen.
      photoUrl: product.photo_blob_name || product.photo_url
        ? `/api/public/products/${req.params.publicId}/photo`
        : null,
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

// Publiek, maar alleen bereikbaar met de public_id van een gepubliceerd product (dezelfde
// voorwaarde als hierboven) - geen enkele blob is rechtstreeks van buitenaf te raden of te
// benaderen, dit media-endpoint haalt de bytes zelf op (Managed Identity) en streamt ze
// door. Elke blobnaam is een unieke, onveranderlijke upload, dus mag lang gecachet worden.
router.get("/:publicId/photo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (product.photo_blob_name) {
      const { stream, contentType, contentLength } = await downloadProductPhoto(
        product.photo_blob_name
      );
      res.set("Content-Type", contentType || "application/octet-stream");
      if (contentLength) res.set("Content-Length", String(contentLength));
      res.set("Cache-Control", "public, max-age=86400, immutable");
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

module.exports = router;
