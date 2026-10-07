const productsRepo = require("../repositories/products.repository");
const sustainabilityRepo = require("../repositories/sustainability.repository");
const complianceRepo = require("../repositories/compliance.repository");
const partsRepo = require("../repositories/parts.repository");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Het publieke productpaspoort (bestemming van elke QR-code). Gedeeld door de
// publieke API (/api/public/products/:publicId) en de paspoortpagina (/p/[id]), die
// dit rechtstreeks server-side aanroept - zo kost een QR-scan op Vercel één function-
// aanroep in plaats van twee.
//
// De response is bewust een whitelist: nooit company_id, interne id's of audit-data
// naar buiten. recordScan registreert een ScanEvent (user-agent/referrer, geen
// persoonsgegevens) - bron voor de QR-statistieken.
async function getPublicPassport(publicId, { recordScan = true, userAgent, referrer, onScanRecorded } = {}) {
  const product = await productsRepo.getProductByPublicId(publicId);
  if (!product) return null;

  const { queryOne } = require("../config/db");
  const [sustainability, compliance, parts, documents, company] = await Promise.all([
    sustainabilityRepo.getSustainability(product.id),
    complianceRepo.getCompliance(product.id),
    partsRepo.listPartsForProduct(product.id),
    documentsRepo.listDocumentsForProduct(product.id, { onlyPublic: true }),
    // Alleen naam + logo van het bedrijf (afzender van het paspoort), niets intern.
    queryOne("SELECT name, logo FROM companies WHERE id = $1", [product.company_id])
  ]);

  if (recordScan) {
    // Een mislukte scan-registratie mag de paspoortweergave nooit blokkeren.
    const pending = scanEventsRepo
      .recordScanEvent({ productId: product.id, userAgent, referrer })
      .catch(() => {});
    // Op Vercel kan een function bevriezen zodra de response weg is; de aanroeper kan
    // de belofte via waitUntil() laten afmaken.
    if (onScanRecorded) onScanRecorded(pending);
  }

  if (sustainability) sustainability.materials = parseJsonArray(sustainability.materials);
  if (compliance) compliance.applicable_regulations = parseJsonArray(compliance.applicable_regulations);

  // Links gebruiken de public_id zoals die in de URL stond (de QR-code), zodat ze
  // altijd bij dezelfde, toegestane route uitkomen.
  const base = `/api/public/products/${encodeURIComponent(publicId)}`;

  return {
    companyName: company?.name || null,
    companyLogo: company?.logo || null,
    name: product.name,
    brand: product.brand,
    model: product.model,
    sku: product.sku,
    gtin: product.gtin,
    categoryLabel: product.category_label,
    description: product.description,
    manufacturer: product.manufacturer,
    countryOfOrigin: product.country_of_origin,
    // Stabiele, eigen link i.p.v. de rauwe photo_url/objectnaam: bij een upload
    // stuurt dit media-endpoint door naar een kortlevende signed URL, bij een geplakte
    // externe URL naar die URL. De frontend hoeft dat onderscheid niet te kennen.
    photoUrl: product.photo_blob_name || product.photo_url ? `${base}/photo` : null,
    // Een gedrukte QR-code moet permanent blijven werken, ook na archiveren - de
    // frontend kan hiermee een neutrale "gearchiveerd"-melding tonen.
    archived: product.status === "archived",
    highlights: parseJsonArray(product.highlights),
    publishedAt: product.published_at,
    sustainability,
    compliance,
    parts,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      category: d.category,
      language: d.language,
      fileSize: d.file_size,
      downloadUrl: d.blob_name ? `${base}/documents/${d.id}/file` : d.storage_url
    }))
  };
}

// Bestaat er een (nog niet gepubliceerd) product met deze QR? Dan is de QR al
// geprint maar het paspoort nog niet live: de pagina toont een nette melding in
// plaats van "niet gevonden". Er komt bewust geen productinformatie mee.
async function isReservedQr(publicId) {
  if (!productsRepo.isValidPublicId(publicId)) return false;
  const { queryOne } = require("../config/db");
  const row = await queryOne("SELECT 1 FROM products WHERE public_id = $1 AND status = 'draft'", [publicId]);
  return Boolean(row);
}

module.exports = { getPublicPassport, isReservedQr };
