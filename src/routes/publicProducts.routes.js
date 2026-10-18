const express = require("express");
const productsRepo = require("../repositories/products.repository");
const instancesRepo = require("../repositories/instances.repository");
const { getProductDocumentUrl } = require("../services/blobStorage.service");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const passport = require("../services/passport.service");
const { publicApiLimiter } = require("../middleware/rateLimit");
const { HttpError } = require("../middleware/errorHandler");

const { shouldCount } = require("../services/scanDedup.service");
const { isCountableBeacon } = require("../services/scanPolicy.service");
const { readImage } = require("../services/blobStorage.service");
const { mediaVersion } = require("./media.routes");

const router = express.Router();

// Kort geheugen voor paspoortdata (60 s): mist de Cloudflare-cache, dan hoeft de
// database niet bij elke opvraging opnieuw. Een wijziging leegt de regel direct
// (invalidateViews, aangeroepen vanuit edgeCache.queuePurge).
const VIEW_TTL_MS = 60 * 1000;
const VIEW_MAX = 5000;
const viewCache = new Map();

function invalidateViews(publicIds) {
  for (const id of publicIds) viewCache.delete(String(id).toLowerCase());
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
    const cacheKey = String(req.params.publicId).toLowerCase();
    const hit = viewCache.get(cacheKey);
    if (hit && Date.now() - hit.at < VIEW_TTL_MS && hit.urlId === req.params.publicId) {
      res.set("Cache-Control", "no-store").json(hit.view);
      return;
    }
    // Model-, batch- of itempaspoort; afbeeldingen en documenten via de model-id.
    const resolved = await instancesRepo.resolvePublicPassport(req.params.publicId);
    if (!resolved) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    const { product, instance } = resolved;
    const assetId = instance ? String(product.public_id).toUpperCase() : req.params.publicId;

    const data = await passport.loadPassportData(product);
    const snapshot = passport.snapshotFromData(product, data);

    // Geen scanregistratie hier: de paspoortpagina kan aan de rand gecachet worden,
    // dus niet elke scan bereikt deze route. De pagina meldt elke weergave zelf via
    // POST /api/scan/:publicId (zie hieronder).
    res.set("Cache-Control", "no-store");
    const view = passport.toPublicPageView(snapshot, {
        urlPublicId: assetId,
        // Logo en foto als losse afbeeldingen met een versie in de URL: browser en
        // Cloudflare mogen ze een jaar bewaren; een nieuw logo/nieuwe foto = nieuwe URL.
        issuerLogo: data.company?.has_logo
          ? `/api/public/products/${assetId}/logo?v=${data.company.logo_version}`
          : null,
        photoUrl: product.photo_blob_name
          ? `/api/public/products/${assetId}/photo?v=${mediaVersion(product.photo_thumb_blob_name || product.photo_blob_name)}`
          : null
      });
    if (instance) {
      view.instance = {
        granularity: instance.granularity,
        serialNumber: instance.serialNumber ?? null,
        lotNumber: instance.lotNumber ?? null,
        productionDate: instance.productionDate ? new Date(instance.productionDate).toISOString().slice(0, 10) : null,
        modelPassportId: String(product.public_id).toUpperCase()
      };
    }
    if (viewCache.size >= VIEW_MAX) viewCache.delete(viewCache.keys().next().value);
    viewCache.set(cacheKey, { view, at: Date.now(), urlId: req.params.publicId });
    res.json(view);
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
    const product = (await instancesRepo.resolvePublicPassport(req.params.publicId))?.product;
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    // Alleen meldingen van een gewone browser op de paspoortpagina (geen bots, scripts of
    // andere sites), en één scan per apparaat per paspoort per 30 minuten.
    if (
      isCountableBeacon(req.headers) &&
      shouldCount({ publicId: req.params.publicId, ip: req.ip, userAgent: req.get("user-agent") })
    ) {
      await scanEventsRepo.recordScanEvent({
        productId: product.id,
        userAgent: req.get("user-agent"),
        referrer: req.get("referer")
      });
    }
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

// Afbeelding met versie: klopt ?v= met de huidige versie, dan mag hij een jaar bewaard
// worden (immutable); anders 5 minuten (oude link of zonder versie).
function cacheFor(req, version) {
  return req.query.v === version ? "public, max-age=31536000, immutable" : "public, max-age=300";
}

// Bedrijfslogo van de uitgever (kleine WebP in de opslag, of oud: data-URI in de database).
router.get("/:publicId/logo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    const pool = await require("../config/db").getPool();
    const company = product
      ? (await pool.query("SELECT logo, logo_blob_name FROM dbo.companies WHERE id = $1", [product.company_id])).rows[0]
      : null;
    if (!company || (!company.logo_blob_name && !company.logo)) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.set("Cache-Control", cacheFor(req, mediaVersion(company.logo_blob_name || company.logo)));
    res.set("X-Content-Type-Options", "nosniff");
    if (company.logo_blob_name) {
      const { buffer, contentType } = await readImage(company.logo_blob_name);
      res.type(contentType).send(buffer);
      return;
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(company.logo);
    if (!match) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) {
    next(error);
  }
});

// Productfoto voor het publieke paspoort: de miniatuur (800 px), of met ?size=large de
// grote versie (2000 px). Rechtstreeks uit de opslag; met Cloudflare ervoor komt dit
// verzoek per foto maar zelden bij de server.
router.get("/:publicId/photo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (product.photo_blob_name) {
      const key = req.query.size === "large" ? product.photo_blob_name : product.photo_thumb_blob_name || product.photo_blob_name;
      res.set("Cache-Control", cacheFor(req, mediaVersion(product.photo_thumb_blob_name || product.photo_blob_name)));
      res.set("X-Content-Type-Options", "nosniff");
      const { buffer, contentType } = await readImage(key);
      res.type(contentType).send(buffer);
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
module.exports.invalidateViews = invalidateViews;
