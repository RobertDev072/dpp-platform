const express = require("express");
const productsRepo = require("../repositories/products.repository");
const { getProductPhotoUrl, getProductDocumentUrl } = require("../services/blobStorage.service");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const passport = require("../services/passport.service");
const { publicApiLimiter } = require("../middleware/rateLimit");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Op AWS serveert CloudFront het pad /products/* rechtstreeks uit de (privé) fotobucket,
// lang gecachet (PUBLIC_MEDIA_FROM_CDN=true). Dan gebruikt de paspoortpagina de kleine
// WebP-versie via dat pad: geen app-aanroep, geen S3-uitgaand verkeer per weergave.
function publicPhotoUrl(product) {
  if (process.env.PUBLIC_MEDIA_FROM_CDN !== "true" || !product.photo_blob_name) return null;
  const key = product.photo_thumb_blob_name || product.photo_blob_name;
  return key.startsWith("products/") ? `/${key}` : null;
}
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

    // Geen scanregistratie hier: deze data wordt (via de paspoortpagina) door
    // CloudFront gecachet, dus niet elke scan bereikt deze route. De pagina meldt elke
    // weergave zelf via POST /:publicId/scan (zie hieronder).
    res.set("Cache-Control", "no-store");
    res.json(
      passport.toPublicPageView(snapshot, {
        urlPublicId: req.params.publicId,
        // Logo als losse, lang cachebare afbeelding i.p.v. inline base64 in elke pagina.
        issuerLogo: data.company?.logo ? `/api/public/products/${req.params.publicId}/logo` : null,
        photoUrl: publicPhotoUrl(product)
      })
    );
  } catch (error) {
    next(error);
  }
});

// Scansignaal van de paspoortpagina (navigator.sendBeacon): telt precies één scan per
// weergave, ook als de pagina uit de cache komt. Bots zonder JavaScript tellen zo niet
// mee. Geen persoonsgegevens: alleen user-agent en referrer, geen IP.
// Met Cloudflare vóór het QR-domein vangt de Worker POST /api/scan/:publicId op en
// bundelt de scans (zie edge/cloudflare/); deze route is dan alleen de terugvaloptie.
// /:publicId/scan blijft bestaan voor pagina's die nog met het oude pad gecachet zijn.
async function recordScan(req, res, next) {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    await scanEventsRepo.recordScanEvent({
      productId: product.id,
      userAgent: req.get("user-agent"),
      referrer: req.get("referer")
    });
    res.set("Cache-Control", "no-store").status(204).end();
  } catch (error) {
    next(error);
  }
}
router.post("/:publicId/scan", recordScan);

const scanRouter = express.Router();
scanRouter.use(publicApiLimiter);
scanRouter.post("/:publicId", recordScan);

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

// Bedrijfslogo van de uitgever (opgeslagen als data-URI) als echte afbeelding, zodat
// browsers en CloudFront het kunnen cachen.
router.get("/:publicId/logo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    const company = product ? await require("../repositories/companies.repository").getCompanyById(product.company_id) : null;
    const match = company?.logo ? /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.+)$/i.exec(company.logo) : null;
    if (!match) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    const buffer = Buffer.from(match[2], "base64");
    const etag = `"${require("crypto").createHash("sha1").update(buffer).digest("hex")}"`;
    res.set("Cache-Control", "public, max-age=86400");
    res.set("ETag", etag);
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    if (match[1].toLowerCase() === "image/svg+xml") res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.type(match[1]).send(buffer);
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
module.exports.scanRouter = scanRouter;
