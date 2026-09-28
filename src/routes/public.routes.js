const path = require("path");
const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { noStore } = require("../middleware/securityHeaders");
const { HttpError } = require("../middleware/errorHandler");
const productsRepo = require("../repositories/products.repository");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const { isSafeHttpsUrl } = require("../schemas/documents.schema");
const { normalizePublicId } = require("../services/qr.service");

// Publieke DPP (geen login). Deze router hangt aan "/", dus hier NOOIT router.use(...):
// middleware zou dan voor elk verzoek (ook statische bestanden) gaan draaien.
const router = express.Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const USER_AGENT_MAX = 500;
const REFERRER_MAX = 500;

const DPP_PAGE = path.join(__dirname, "..", "..", "public", "dpp.html");

// Per ip, per instance. Ruim genoeg voor echte bezoekers (één pagina = één API-call), maar
// remt het massaal aflopen van willekeurige UUID's. Let op: zonder TRUST_PROXY=true ziet de
// app achter App Service één proxy-ip en deelt iedereen deze limiet.
const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: "Te veel verzoeken, probeer het later opnieuw"
});

function notFound() {
  return new HttpError(404, "Niet gevonden");
}

// Alleen de origin ("https://voorbeeld.nl"): pad en query van de verwijzende pagina kunnen
// persoonsgegevens of tokens bevatten en horen niet in onze database.
function referrerOrigin(value) {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.slice(0, REFERRER_MAX);
  } catch {
    return null;
  }
}

// Landcode alleen uit een expliciet geconfigureerde header van een vertrouwde proxy
// (SCAN_COUNTRY_HEADER). Zonder die config is een header door iedere client te vervalsen,
// dus dan slaan we niets op. Nooit afleiden uit het IP-adres.
function scanCountryCode(req) {
  const headerName = process.env.SCAN_COUNTRY_HEADER;
  if (!headerName) return null;
  const value = req.get(headerName);
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(code) ? code : null;
}

// Een scan registreren mag de publieke pagina nooit breken: een DB-fout hier wordt gelogd
// (zonder request-gegevens) en verder genegeerd.
async function recordScanSafely(req, productId) {
  // HEAD-verzoeken (link-checkers, previews) zijn geen bezoek.
  if (req.method !== "GET") return;
  try {
    const userAgent = req.get("user-agent");
    await scanEventsRepo.recordScanEvent({
      productId,
      source: req.query.src === "qr" ? "qr" : "web",
      userAgent: typeof userAgent === "string" && userAgent !== "" ? userAgent.slice(0, USER_AGENT_MAX) : null,
      referrer: referrerOrigin(req.get("referer")),
      countryCode: scanCountryCode(req)
    });
  } catch (error) {
    console.error("ScanEvent opslaan mislukt:", error.message);
  }
}

// Whitelisted publieke DTO (§8 "Publiek"), veld voor veld opgebouwd. Nooit een DB-rij
// spreaden: een kolom die later aan de query wordt toegevoegd, mag niet vanzelf publiek worden.
function toPublicDocument(document) {
  return {
    title: document.title,
    type: document.type,
    language: document.language ?? null,
    url: document.storage_url
  };
}

function toPublicDpp(product, documents) {
  return {
    publicId: normalizePublicId(product.public_id),
    name: product.name,
    brand: product.brand ?? null,
    manufacturer: product.manufacturer ?? null,
    model: product.model ?? null,
    sku: product.sku ?? null,
    gtin: product.gtin ?? null,
    category: product.category ?? null,
    description: product.description ?? null,
    materials: product.materials ?? null,
    countryOfOrigin: product.country_of_origin ?? null,
    complianceInfo: product.compliance_info ?? null,
    recyclingInfo: product.recycling_info ?? null,
    repairInfo: product.repair_info ?? null,
    issuer: product.issuer ?? null,
    publishedAt: product.published_at ?? null,
    updatedAt: product.updated_at ?? null,
    // Extra filter op https: oudere rijen van vóór de URL-validatie mogen nooit als
    // javascript:/http:-link op de publieke pagina belanden.
    documents: documents.filter((document) => isSafeHttpsUrl(document.storage_url)).map(toPublicDocument)
  };
}

// De HTML-pagina zelf verraadt niets (die haalt de JSON op). Een zichtbaar ongeldige id
// krijgt dezelfde pagina met status 404: een bezoeker met een verminkte QR-link ziet dan de
// nette melding "Productpaspoort niet gevonden" (dpp.js controleert de UUID zelf) in plaats
// van een ruwe JSON-fout. Alleen de API geeft de generieke JSON-404.
router.get("/p/:publicId", (req, res, next) => {
  if (!UUID_PATTERN.test(req.params.publicId)) {
    res.status(404);
  }
  res.sendFile(DPP_PAGE, (error) => {
    if (!error || res.headersSent) return;
    next(error.code === "ENOENT" || error.status === 404 ? notFound() : error);
  });
});

router.get("/api/public/dpp/:publicId", publicApiLimiter, noStore, async (req, res, next) => {
  try {
    // Ongeldig, onbekend, niet (meer) gepubliceerd: allemaal dezelfde generieke 404, zodat de
    // API niet verraadt of een product bestaat of ooit gepubliceerd was.
    const { publicId } = req.params;
    if (!UUID_PATTERN.test(publicId)) {
      throw notFound();
    }

    const product = await productsRepo.getPublishedByPublicId(publicId);
    if (!product) {
      throw notFound();
    }

    const documents = await documentsRepo.listPublicDocumentsForProduct(product.id);
    await recordScanSafely(req, product.id);

    res.json(toPublicDpp(product, documents));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
