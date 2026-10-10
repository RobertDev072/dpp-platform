const express = require("express");
const productsRepo = require("../repositories/products.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const passport = require("../services/passport.service");
const archive = require("../services/passportArchive.service");
const { getProductDocumentUrl } = require("../services/blobStorage.service");
const { getQrBaseUrl } = require("../utils/baseUrl");
const { publicApiLimiter } = require("../middleware/rateLimit");
const { HttpError } = require("../middleware/errorHandler");

// Machineleesbare productpaspoorten (EN 18216:2026 §4-5):
// - JSON is altijd beschikbaar; JSON-LD en XML via HTTP content negotiation
//   (Accept-header) of expliciet met ?format=json|jsonld|xml;
// - een browser (Accept: text/html) wordt doorgestuurd naar de HTML-pagina /p/:id;
// - /p/:id zelf levert via een rewrite (next.config.mjs) dezelfde representaties,
//   zodat de gedrukte QR-URL ook voor systemen werkt.
// Versies (EN 18221 §4.2): /versions (lijst), /versions/:n, of ?version=n / ?at=ISO.
//
// Publiek, zonder login: alleen gepubliceerde of gearchiveerde paspoorten en alleen
// openbare velden (zelfde whitelist als de paspoortpagina). Een onbekende of nog niet
// gepubliceerde id geeft 404 (bestaan wordt niet bevestigd).

const router = express.Router();
router.use(publicApiLimiter);

const FORMATS = {
  json: "application/json",
  jsonld: "application/ld+json",
  xml: "application/xml"
};

function negotiate(req) {
  const explicit = typeof req.query.format === "string" ? req.query.format.toLowerCase() : null;
  if (explicit) {
    if (!FORMATS[explicit]) throw new HttpError(400, "Onbekend formaat (json, jsonld of xml)");
    return explicit;
  }
  const preferred = req.accepts(["application/json", "application/ld+json", "application/xml", "text/html"]);
  if (preferred === "text/html") return "html";
  if (preferred === "application/ld+json") return "jsonld";
  if (preferred === "application/xml") return "xml";
  if (preferred === "application/json") return "json";
  // Niets passends gevraagd (bijv. alleen image/*): 406 met de beschikbare formaten.
  if (req.get("accept")) throw new HttpError(406, "Beschikbare formaten: application/json, application/ld+json, application/xml, text/html");
  return "json";
}

function send(res, format, snapshot, { qrBaseUrl, version, immutable }) {
  const options = { qrBaseUrl, version };
  res.vary("Accept");
  res.set("Cache-Control", immutable ? "public, max-age=86400, immutable" : "public, max-age=60");
  res.set("Link", `<${qrBaseUrl}/p/${snapshot.publicId.toUpperCase()}>; rel="canonical"`);
  if (version?.contentSha256) res.set("ETag", `"${version.contentSha256}"`);
  if (format === "xml") {
    res.type("application/xml; charset=utf-8").send(passport.toDppXml(snapshot, options));
  } else if (format === "jsonld") {
    res.type("application/ld+json; charset=utf-8").send(JSON.stringify(passport.toDppJsonLd(snapshot, options)));
  } else {
    res.type("application/json; charset=utf-8").send(JSON.stringify(passport.toDppJson(snapshot, options)));
  }
}

async function loadPublicProduct(publicId) {
  const product = await productsRepo.getProductByPublicId(publicId);
  if (!product) throw new HttpError(404, "Niet gevonden");
  return product;
}

function parseVersionNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Ongeldig versienummer");
  return n;
}

function versionMeta(version, isCurrent) {
  return version
    ? {
        versionNumber: version.versionNumber,
        createdAt: version.createdAt,
        contentSha256: version.contentSha256,
        chainSha256: version.chainSha256,
        isCurrent
      }
    : null;
}

async function sendArchivedVersion(req, res, product, version, format) {
  if (!version) throw new HttpError(404, "Versie niet gevonden");
  const qrBaseUrl = getQrBaseUrl(req);
  if (format === "html") {
    // Geen aparte HTML-weergave van oude versies: de JSON is de bron.
    format = "json";
  }
  const latest = await archive.getLatestVersion(product.id);
  send(res, format, version.snapshot, {
    qrBaseUrl,
    version: versionMeta(version, latest?.versionNumber === version.versionNumber),
    immutable: true
  });
}

router.get("/:publicId", async (req, res, next) => {
  try {
    const format = negotiate(req);
    const product = await loadPublicProduct(req.params.publicId);

    if (req.query.version !== undefined) {
      const version = await archive.getVersion(product.id, parseVersionNumber(req.query.version));
      await sendArchivedVersion(req, res, product, version, format);
      return;
    }
    if (req.query.at !== undefined) {
      const at = new Date(String(req.query.at));
      if (Number.isNaN(at.getTime())) throw new HttpError(400, "Ongeldig tijdstip (gebruik ISO 8601)");
      const version = await archive.getVersionAt(product.id, at);
      await sendArchivedVersion(req, res, product, version, format);
      return;
    }

    if (format === "html") {
      res.redirect(303, `/p/${encodeURIComponent(req.params.publicId)}`);
      return;
    }

    // Actuele stand: altijd live opgebouwd (EN 18221 §4.1: actueel en volledig). Als
    // de laatst gearchiveerde versie inhoudelijk gelijk is, verwijzen we ernaar.
    const snapshot = await passport.buildSnapshot(product);
    const latest = await archive.getLatestVersion(product.id);
    const isCurrent = latest && latest.contentSha256 === passport.contentHash(snapshot);

    Promise.resolve()
      .then(() =>
        scanEventsRepo.recordScanEvent({ productId: product.id, userAgent: req.get("user-agent"), referrer: req.get("referer") })
      )
      .catch(() => {});

    send(res, format, snapshot, {
      qrBaseUrl: getQrBaseUrl(req),
      version: isCurrent ? versionMeta(latest, true) : null,
      immutable: false
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:publicId/versions", async (req, res, next) => {
  try {
    const product = await loadPublicProduct(req.params.publicId);
    const qrBaseUrl = getQrBaseUrl(req);
    const publicId = String(product.public_id).toLowerCase();
    const versions = await archive.listVersions(product.id);
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      passport: `${qrBaseUrl}/p/${publicId.toUpperCase()}`,
      versions: versions.map((v) => ({
        version: v.versionNumber,
        createdAt: v.createdAt,
        contentSha256: v.contentSha256,
        previousChainSha256: v.previousChainSha256,
        chainSha256: v.chainSha256,
        url: `${qrBaseUrl}/api/dpp/${publicId}/versions/${v.versionNumber}`
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:publicId/versions/:version", async (req, res, next) => {
  try {
    const format = negotiate(req);
    const product = await loadPublicProduct(req.params.publicId);
    const version = await archive.getVersion(product.id, parseVersionNumber(req.params.version));
    await sendArchivedVersion(req, res, product, version, format);
  } catch (error) {
    next(error);
  }
});

// Document zoals het in een gearchiveerde versie zat. Werkt ook als het document
// later uit het actuele paspoort is verwijderd: objecten in de opslag worden nooit
// overschreven of door de app verwijderd (EN 18221 §4.4).
router.get("/:publicId/versions/:version/documents/:documentId/file", async (req, res, next) => {
  try {
    const product = await loadPublicProduct(req.params.publicId);
    const version = await archive.getVersion(product.id, parseVersionNumber(req.params.version));
    const doc = version?.snapshot?.documents?.find((d) => String(d.id) === String(req.params.documentId));
    if (!doc || !doc.isPublic) throw new HttpError(404, "Niet gevonden");
    if (doc.objectName) {
      res.set("Cache-Control", "public, max-age=60");
      res.redirect(302, await getProductDocumentUrl(doc.objectName));
      return;
    }
    if (doc.externalUrl) {
      res.redirect(302, doc.externalUrl);
      return;
    }
    throw new HttpError(404, "Niet gevonden");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
