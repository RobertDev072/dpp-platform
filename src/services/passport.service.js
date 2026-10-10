// Eén bron voor de inhoud van een productpaspoort (DPP), gebruikt door:
// - de publieke JSON voor de paspoortpagina (/api/public/products/:publicId);
// - de machineleesbare DPP-API met content negotiation (/api/dpp/:publicId, en via
//   een rewrite ook /p/:publicId met Accept: application/json, ld+json of xml);
// - het versie-archief (passportArchive.service.js), dat precies deze inhoud als
//   onveranderlijke snapshot vastlegt.
//
// Datamodel: één paspoort per productmodel (dbo.products, permanente sleutel
// public_id). Individuele exemplaren (serienummers) hebben (nog) geen eigen paspoort;
// zie docs/aws-migration-assessment.md (model- vs. item-QR).

const crypto = require("crypto");
const { getPool } = require("../config/db");

const SNAPSHOT_SCHEMA_VERSION = 1;

const PRODUCT_COLUMNS = `id, company_id, name, brand, model, sku, gtin, category_label, description,
  manufacturer, country_of_origin, photo_url, photo_blob_name, status, highlights, public_id, published_at`;

// Alle reads voor één snapshot lopen via één executor (query(text, values)): een
// transactie-client tijdens het archiveren, anders de pool. Zo houdt het archiveren
// nooit een verbinding vast terwijl het op een tweede verbinding uit dezelfde pool
// wacht (dat kan onder load de pool uitputten).
async function loadPassportData(product, db) {
  const executor = db || (await getPool());
  const one = async (text) => (await executor.query(text, [product.id])).rows;
  const sustainability = (await one(`SELECT co2_footprint_kg, co2_reduction_pct, recycled_material_pct, materials,
      epd_url, recyclable, reach_conform, rohs_conform, expected_lifespan_years
    FROM dbo.productsustainability WHERE product_id = $1`))[0] || null;
  const compliance = (await one(
    "SELECT ce_marked, applicable_regulations FROM dbo.productcompliance WHERE product_id = $1"
  ))[0] || null;
  const parts = await one(
    "SELECT id, part_number, name, description, image_url FROM dbo.productparts WHERE product_id = $1 ORDER BY id"
  );
  const documents = await one(`SELECT id, type, title, language, storage_url, blob_name, file_size, mime_type,
      is_public, category, valid_until, version
    FROM dbo.documents WHERE product_id = $1 ORDER BY id`);
  const company = (await executor.query("SELECT name, logo FROM dbo.companies WHERE id = $1", [product.company_id]))
    .rows[0] || null;
  return { sustainability, compliance, parts, documents, company };
}

async function loadProduct(productId, db) {
  const executor = db || (await getPool());
  const { rows } = await executor.query(`SELECT ${PRODUCT_COLUMNS} FROM dbo.products WHERE id = $1`, [productId]);
  return rows[0] || null;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Canonieke snapshot: alleen inhoud, geen technische tijdstempels (updated_at) die
// zonder inhoudelijke wijziging veranderen. Sleutels in vaste volgorde.
async function buildSnapshot(product, db) {
  return snapshotFromData(product, await loadPassportData(product, db));
}

function snapshotFromData(product, { sustainability, compliance, parts, documents, company }) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    publicId: String(product.public_id).toLowerCase(),
    status: product.status,
    publishedAt: isoOrNull(product.published_at),
    issuer: { name: company ? company.name : null },
    product: {
      name: product.name,
      brand: product.brand ?? null,
      model: product.model ?? null,
      sku: product.sku ?? null,
      gtin: product.gtin ?? null,
      categoryLabel: product.category_label ?? null,
      description: product.description ?? null,
      manufacturer: product.manufacturer ?? null,
      countryOfOrigin: product.country_of_origin ?? null,
      highlights: parseJsonArray(product.highlights),
      photo: product.photo_blob_name
        ? { objectName: product.photo_blob_name }
        : product.photo_url
          ? { externalUrl: product.photo_url }
          : null
    },
    sustainability: sustainability
      ? {
          co2FootprintKg: sustainability.co2_footprint_kg ?? null,
          co2ReductionPct: sustainability.co2_reduction_pct ?? null,
          recycledMaterialPct: sustainability.recycled_material_pct ?? null,
          materials: parseJsonArray(sustainability.materials),
          epdUrl: sustainability.epd_url ?? null,
          recyclable: sustainability.recyclable ?? null,
          reachConform: sustainability.reach_conform ?? null,
          rohsConform: sustainability.rohs_conform ?? null,
          expectedLifespanYears: sustainability.expected_lifespan_years ?? null
        }
      : null,
    compliance: compliance
      ? {
          ceMarked: compliance.ce_marked ?? null,
          applicableRegulations: parseJsonArray(compliance.applicable_regulations)
        }
      : null,
    parts: parts.map((p) => ({
      id: p.id,
      partNumber: p.part_number,
      name: p.name,
      description: p.description ?? null,
      imageUrl: p.image_url ?? null
    })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      category: d.category,
      language: d.language ?? null,
      isPublic: Boolean(d.is_public),
      mimeType: d.mime_type ?? null,
      fileSize: d.file_size ?? null,
      objectName: d.blob_name ?? null,
      externalUrl: d.storage_url ?? null,
      validUntil: dateOnly(d.valid_until),
      version: d.version ?? null
    }))
  };
}

// Deterministische JSON: object-sleutels gesorteerd, zodat dezelfde inhoud altijd
// dezelfde hash geeft.
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function contentHash(snapshot) {
  return sha256(canonicalJson(snapshot));
}

// --- weergaven ----------------------------------------------------------------------

// Zelfde vorm als op de gedrukte QR-code (GUID in hoofdletters, zie utils/baseUrl.js),
// zodat de identifier in de data exact overeenkomt met de gedrukte data carrier.
function passportBaseUrl(qrBaseUrl, publicId) {
  return `${qrBaseUrl}/p/${String(publicId).toUpperCase()}`;
}

// Documentlinks: huidige versie via de bestaande publieke route; een gearchiveerde
// versie via de versieroute (die het object uit de snapshot ontsluit, ook als het
// document later is verwijderd).
function documentUrl(publicId, doc, versionNumber) {
  if (!doc.objectName) return doc.externalUrl || null;
  return versionNumber
    ? `/api/dpp/${publicId}/versions/${versionNumber}/documents/${doc.id}/file`
    : `/api/public/products/${publicId}/documents/${doc.id}/file`;
}

// De bestaande JSON voor de paspoortpagina (vorm ongewijzigd t.o.v. vóór de
// migratie). urlPublicId = de id zoals in de URL (hoofdletters uit de Azure-tijd
// blijven zo werken).
function toPublicPageView(snapshot, { urlPublicId, issuerLogo = null, versionNumber = null } = {}) {
  const id = urlPublicId || snapshot.publicId;
  const p = snapshot.product;
  return {
    issuer: snapshot.issuer?.name ? { name: snapshot.issuer.name, logo: issuerLogo } : null,
    name: p.name,
    brand: p.brand,
    model: p.model,
    sku: p.sku,
    gtin: p.gtin,
    categoryLabel: p.categoryLabel,
    description: p.description,
    manufacturer: p.manufacturer,
    countryOfOrigin: p.countryOfOrigin,
    photoUrl: p.photo ? `/api/public/products/${id}/photo` : null,
    archived: snapshot.status === "archived",
    highlights: p.highlights,
    publishedAt: snapshot.publishedAt,
    sustainability: snapshot.sustainability
      ? {
          co2_footprint_kg: snapshot.sustainability.co2FootprintKg,
          co2_reduction_pct: snapshot.sustainability.co2ReductionPct,
          recycled_material_pct: snapshot.sustainability.recycledMaterialPct,
          materials: snapshot.sustainability.materials,
          epd_url: snapshot.sustainability.epdUrl,
          recyclable: snapshot.sustainability.recyclable,
          reach_conform: snapshot.sustainability.reachConform,
          rohs_conform: snapshot.sustainability.rohsConform,
          expected_lifespan_years: snapshot.sustainability.expectedLifespanYears
        }
      : null,
    compliance: snapshot.compliance
      ? {
          ce_marked: snapshot.compliance.ceMarked,
          applicable_regulations: snapshot.compliance.applicableRegulations
        }
      : null,
    parts: snapshot.parts.map((part) => ({
      id: part.id,
      part_number: part.partNumber,
      name: part.name,
      description: part.description,
      image_url: part.imageUrl
    })),
    documents: snapshot.documents
      .filter((d) => d.isPublic)
      .map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        category: d.category,
        language: d.language,
        fileSize: d.fileSize,
        downloadUrl: documentUrl(id, d, versionNumber)
      }))
  };
}

// Machineleesbare DPP-representatie (JSON). Alleen openbare gegevens; interne id's
// (bedrijf, gebruiker, objectnamen in de opslag) komen er nooit in.
function toDppJson(snapshot, { qrBaseUrl, version = null }) {
  const publicId = snapshot.publicId;
  const passportUrl = passportBaseUrl(qrBaseUrl, publicId);
  const p = snapshot.product;
  const absolute = (url) => (url && url.startsWith("/") ? `${qrBaseUrl}${url}` : url);
  return {
    id: passportUrl,
    identifiers: {
      passportId: publicId,
      urn: `urn:uuid:${publicId}`,
      gtin: p.gtin,
      sku: p.sku
    },
    passportGranularity: "model",
    status: snapshot.status,
    publishedAt: snapshot.publishedAt,
    version: version
      ? {
          number: version.versionNumber,
          createdAt: version.createdAt,
          contentSha256: version.contentSha256,
          chainSha256: version.chainSha256,
          history: `${qrBaseUrl}/api/dpp/${publicId}/versions`
        }
      : null,
    issuer: { name: snapshot.issuer?.name ?? null },
    product: {
      name: p.name,
      brand: p.brand,
      model: p.model,
      category: p.categoryLabel,
      description: p.description,
      manufacturer: p.manufacturer,
      countryOfOrigin: p.countryOfOrigin,
      highlights: p.highlights,
      image: p.photo ? `${qrBaseUrl}/api/public/products/${publicId}/photo` : null
    },
    sustainability: snapshot.sustainability,
    compliance: snapshot.compliance,
    parts: snapshot.parts.map(({ id, ...rest }) => ({ ...rest })),
    documents: snapshot.documents
      .filter((d) => d.isPublic)
      .map((d) => ({
        title: d.title,
        type: d.type,
        category: d.category,
        language: d.language,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        validUntil: d.validUntil,
        version: d.version,
        url: absolute(documentUrl(publicId, d, version && !version.isCurrent ? version.versionNumber : null))
      }))
  };
}

// JSON-LD: dezelfde JSON met een context die de velden aan schema.org koppelt waar
// dat eenduidig kan; overige velden vallen onder een eigen VeriPasso-vocabulaire.
// Een gewone JSON-parser kan het document ongewijzigd lezen (EN 18216 §5 c).
function toDppJsonLd(snapshot, options) {
  const json = toDppJson(snapshot, options);
  return {
    "@context": {
      "@vocab": `${options.qrBaseUrl}/vocab/dpp#`,
      schema: "https://schema.org/",
      id: "@id",
      name: "schema:name",
      description: "schema:description",
      brand: "schema:brand",
      model: "schema:model",
      category: "schema:category",
      manufacturer: "schema:manufacturer",
      countryOfOrigin: "schema:countryOfOrigin",
      image: { "@id": "schema:image", "@type": "@id" },
      gtin: "schema:gtin",
      sku: "schema:sku",
      url: { "@id": "schema:url", "@type": "@id" },
      publishedAt: { "@id": "schema:datePublished", "@type": "schema:DateTime" }
    },
    "@type": "DigitalProductPassport",
    ...json,
    product: { "@type": "schema:Product", ...json.product }
  };
}

// --- XML ------------------------------------------------------------------------------

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Tekens die in XML 1.0 niet zijn toegestaan.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function xmlName(key) {
  const name = String(key).replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

function toXmlNode(name, value, indent) {
  const pad = "  ".repeat(indent);
  const tag = xmlName(name);
  if (value === null || value === undefined) return `${pad}<${tag} nil="true"/>`;
  if (Array.isArray(value)) {
    const items = value.map((item) => toXmlNode("item", item, indent + 1)).join("\n");
    return items ? `${pad}<${tag}>\n${items}\n${pad}</${tag}>` : `${pad}<${tag}/>`;
  }
  if (typeof value === "object") {
    const children = Object.entries(value)
      .map(([k, v]) => toXmlNode(k, v, indent + 1))
      .join("\n");
    return children ? `${pad}<${tag}>\n${children}\n${pad}</${tag}>` : `${pad}<${tag}/>`;
  }
  return `${pad}<${tag}>${xmlEscape(value)}</${tag}>`;
}

function toDppXml(snapshot, options) {
  const json = toDppJson(snapshot, options);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${toXmlNode("digitalProductPassport", json, 0)}\n`;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  loadProduct,
  loadPassportData,
  buildSnapshot,
  snapshotFromData,
  canonicalJson,
  contentHash,
  sha256,
  toPublicPageView,
  toDppJson,
  toDppJsonLd,
  toDppXml
};
