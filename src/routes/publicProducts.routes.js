const express = require("express");
const productsRepo = require("../repositories/products.repository");
const { getProductPhotoUrl, getProductDocumentUrl } = require("../services/blobStorage.service");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const passport = require("../services/passport.service");
const { publicApiLimiter } = require("../middleware/rateLimit");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();
router.use(publicApiLimiter);

// Publiek endpoint, geen requireAuth/requireRole: iedereen met de public_id (via de
// QR-code) mag dit productpaspoort zien. De inhoud komt uit dezelfde bron als het
// versie-archief en de machineleesbare DPP (passport.service.js); de weergave is een
// whitelist: nooit company_id, interne id's, objectnamen of audit-data.
// Een gedrukte QR-code moet permanent blijven werken, ook na archiveren: "archived"
// laat de pagina een neutrale melding tonen i.p.v. te doen alsof het product nog
// actief is.
router.get("/:publicId", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const data = await passport.loadPassportData(product);
    const snapshot = passport.snapshotFromData(product, data);

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

    res.set("Cache-Control", "no-store");
    res.json(
      passport.toPublicPageView(snapshot, {
        urlPublicId: req.params.publicId,
        issuerLogo: data.company?.logo || null
      })
    );
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
