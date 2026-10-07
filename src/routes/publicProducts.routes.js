const express = require("express");
const productsRepo = require("../repositories/products.repository");
const { getProductPhotoUrl, getProductDocumentUrl } = require("../services/blobStorage.service");
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
    // JSON-strings uit de database (text) - hier veilig parsen zodat de
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
      // Stabiele, eigen link i.p.v. de rauwe photo_url/objectnaam: bij een upload verwijst dit
      // media-endpoint door naar een kortlevende signed URL van de privé-bucket, bij een geplakte externe
      // URL redirect dezelfde route er gewoon naartoe. De frontend hoeft dat onderscheid
      // niet te kennen.
      photoUrl: product.photo_blob_name || product.photo_url
        ? `/api/public/products/${req.params.publicId}/photo`
        : null,
      // Een gedrukte QR-code moet permanent blijven werken, ook na archiveren - de
      // frontend kan hiermee een neutrale "gearchiveerd"-melding tonen i.p.v. te doen
      // alsof dit nog een actief product is.
      archived: product.status === "archived",
      highlights,
      publishedAt: product.published_at,
      sustainability,
      compliance,
      parts,
      // Whitelist + stabiele downloadlink: geüploade documenten worden via ons eigen
      // publieke endpoint ontsloten (objecten in de privé-bucket zijn nooit rechtstreeks bereikbaar).
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        category: d.category,
        language: d.language,
        fileSize: d.file_size,
        downloadUrl: d.blob_name
          ? `/api/public/products/${req.params.publicId}/documents/${d.id}/file`
          : d.storage_url
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Publiek, maar alleen bereikbaar met de public_id van een gepubliceerd product (dezelfde
// voorwaarde als hierboven) - geen enkele blob is rechtstreeks van buitenaf te raden of te
// benaderen; dit media-endpoint controleert de voorwaarden en verwijst dan door naar een
// signed URL die maar een paar minuten geldig is.
// Publiek document van een gepubliceerd product: alleen is_public-documenten,
// via een kortlevende signed URL (zelfde principe als de foto hieronder).
router.get("/:publicId/documents/:documentId/file", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    const document = await documentsRepo.getDocumentById(Number(req.params.documentId));
    if (!document || document.product_id !== product.id || !document.is_public) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (document.blob_name) {
      // Kortlevende signed URL (minuten); de doorverwijzing zelf maar kort cachen.
      res.set("Cache-Control", "public, max-age=60");
      res.redirect(302, await getProductDocumentUrl(document.blob_name));
      return;
    }
    if (document.storage_url) {
      res.redirect(302, document.storage_url);
      return;
    }
    next(new HttpError(404, "Niet gevonden"));
  } catch (error) {
    next(error);
  }
});

router.get("/:publicId/photo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (product.photo_blob_name) {
      res.set("Cache-Control", "public, max-age=60");
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

module.exports = router;
