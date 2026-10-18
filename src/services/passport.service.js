// Eén bron voor de inhoud van een productpaspoort (DPP), gebruikt door:
// - de publieke JSON voor de paspoortpagina (/api/public/products/:publicId);
// - de machineleesbare DPP-API met content negotiation (/api/dpp/:publicId, en via
//   een rewrite ook /p/:publicId met Accept: application/json, ld+json of xml);
// - het versie-archief (passportArchive.service.js), dat precies deze inhoud als
//   onveranderlijke snapshot vastlegt.
//
// Datamodel: één paspoort per productmodel (dbo.products, permanente sleutel
// public_id). Individuele exemplaren (serienummers) hebben (nog) geen eigen paspoort.

const crypto = require("crypto");
const { getPool } = require("../config/db");
const gs1 = require("../utils/gs1");

// 2: marktdeelnemer-id, vestiging, inhoudsspecificaties, taal en vertalingen.
const SNAPSHOT_SCHEMA_VERSION = 2;

// Versie van de machineleesbare DPP-structuur (header + dataElements), los van de
// interne snapshotversie. Beschreven in docs/dpp-datamodel.md en /api/v1/schema/dpp.json.
const DPP_SCHEMA_VERSION = "1.0.0";

const PRODUCT_COLUMNS = `id, company_id, name, brand, model, sku, gtin, category_label, description,
  manufacturer, country_of_origin, photo_url, photo_blob_name, status, highlights, public_id, published_at,
  facility_id, content_specification_ids, language`;

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
  const translations = await one(
    "SELECT language, name, description FROM dbo.producttranslations WHERE product_id = $1 ORDER BY language"
  );
  const company = (await executor.query("SELECT name, economic_operator_id, economic_operator_id_scheme, (logo IS NOT NULL OR logo_blob_name IS NOT NULL) AS has_logo, left(md5(COALESCE(logo_blob_name, logo, '')), 10) AS logo_version FROM dbo.companies WHERE id = $1", [product.company_id]))
    .rows[0] || null;
  return { sustainability, compliance, parts, documents, company, translations };
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

function snapshotFromData(product, { sustainability, compliance, parts, documents, company, translations = [] }) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    publicId: String(product.public_id).toLowerCase(),
    status: product.status,
    publishedAt: isoOrNull(product.published_at),
    issuer: {
      name: company ? company.name : null,
      economicOperatorId: company?.economic_operator_id ?? null,
      economicOperatorIdScheme: company?.economic_operator_id_scheme ?? null
    },
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
      language: product.language || "nl-NL",
      facilityId: product.facility_id ?? null,
      contentSpecificationIds: parseJsonArray(product.content_specification_ids),
      translations: translations.map((t) => ({ language: t.language, name: t.name ?? null, description: t.description ?? null })),
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
// photoUrl/issuerLogo: door de route bepaald (standaard de API-route), zodat de pagina
// lichte, cachebare afbeeldingen laadt i.p.v. inline data.
function toPublicPageView(snapshot, { urlPublicId, issuerLogo = null, photoUrl = null, versionNumber = null } = {}) {
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
    photoUrl: p.photo ? photoUrl || `/api/public/products/${id}/photo` : null,
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
// Woordenboekverwijzingen per dataveld: schema.org of GS1 waar die eenduidig zijn,
// anders de gepubliceerde VeriPasso-vocabulaire (/vocab/dpp). Units volgens UN/CEFACT
// Rec. 20 waar van toepassing.
const DATA_ELEMENTS = [
  { id: "product.name", ref: "https://schema.org/name", get: (s) => s.product.name, multi: "name" },
  { id: "product.description", ref: "https://schema.org/description", get: (s) => s.product.description, multi: "description" },
  { id: "product.brand", ref: "https://schema.org/brand", get: (s) => s.product.brand },
  { id: "product.model", ref: "https://schema.org/model", get: (s) => s.product.model },
  { id: "product.category", ref: "https://schema.org/category", get: (s) => s.product.categoryLabel },
  { id: "product.manufacturer", ref: "https://schema.org/manufacturer", get: (s) => s.product.manufacturer },
  { id: "product.countryOfOrigin", ref: "https://schema.org/countryOfOrigin", get: (s) => s.product.countryOfOrigin },
  { id: "product.gtin", ref: "https://gs1.org/voc/gtin", get: (s) => s.product.gtin },
  { id: "product.sku", ref: "https://schema.org/sku", get: (s) => s.product.sku },
  { id: "sustainability.co2FootprintKg", vocab: "co2FootprintKg", unit: "KGM", get: (s) => s.sustainability?.co2FootprintKg },
  { id: "sustainability.co2ReductionPct", vocab: "co2ReductionPct", unit: "P1", get: (s) => s.sustainability?.co2ReductionPct },
  { id: "sustainability.recycledMaterialPct", vocab: "recycledMaterialPct", unit: "P1", get: (s) => s.sustainability?.recycledMaterialPct },
  { id: "sustainability.materials", vocab: "materials", get: (s) => s.sustainability?.materials },
  { id: "sustainability.recyclable", vocab: "recyclable", get: (s) => s.sustainability?.recyclable },
  { id: "sustainability.reachConform", vocab: "reachConform", get: (s) => s.sustainability?.reachConform },
  { id: "sustainability.rohsConform", vocab: "rohsConform", get: (s) => s.sustainability?.rohsConform },
  { id: "sustainability.expectedLifespanYears", vocab: "expectedLifespanYears", unit: "ANN", get: (s) => s.sustainability?.expectedLifespanYears },
  { id: "sustainability.epdUrl", vocab: "epdUrl", get: (s) => s.sustainability?.epdUrl },
  { id: "compliance.ceMarked", vocab: "ceMarked", get: (s) => s.compliance?.ceMarked },
  { id: "compliance.applicableRegulations", vocab: "applicableRegulations", get: (s) => s.compliance?.applicableRegulations }
];

function isEmpty(value) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

// Meertalige waarde: de basistekst in de taal van het product plus alle vertalingen.
function multiLanguage(snapshot, field) {
  const p = snapshot.product;
  const values = [];
  if (!isEmpty(p[field])) values.push({ language: p.language || "nl-NL", value: p[field] });
  for (const t of p.translations || []) {
    if (!isEmpty(t[field]) && t.language !== (p.language || "nl-NL")) values.push({ language: t.language, value: t[field] });
  }
  return values;
}

function dataElements(snapshot, qrBaseUrl) {
  const out = [];
  for (const el of DATA_ELEMENTS) {
    const value = el.get(snapshot);
    if (isEmpty(value)) continue;
    const element = {
      elementId: el.id,
      dictionaryReference: el.ref || `${qrBaseUrl}/vocab/dpp#${el.vocab}`
    };
    if (el.multi && (snapshot.product.translations || []).length) {
      element.type = "MultiLanguageDataElement";
      element.value = multiLanguage(snapshot, el.multi);
    } else {
      element.type = "DataElement";
      element.value = value;
    }
    if (el.unit) element.unitCode = el.unit;
    out.push(element);
  }
  return out;
}

const DPP_STATUS = { published: "Active", archived: "Archived" };

// Header met de identificatie van het paspoort. `instance` = een batch- of
// itempaspoort (zelfde productgegevens, eigen DPP-id en eigen productidentificatie).
function dppHeader(snapshot, { qrBaseUrl, lastUpdated = null, instance = null }) {
  const p = snapshot.product;
  const dppId = instance?.publicId || snapshot.publicId;
  const granularity = instance?.granularity || "model";
  const link = gs1.digitalLink({ gtin: p.gtin, lot: instance?.lotNumber, serial: instance?.serialNumber });
  return {
    digitalProductPassportId: `urn:uuid:${dppId}`,
    uniqueProductIdentifier: link || `urn:uuid:${dppId}`,
    granularity,
    dppSchemaVersion: DPP_SCHEMA_VERSION,
    dppStatus: DPP_STATUS[snapshot.status] || "Active",
    lastUpdated: isoOrNull(lastUpdated) || snapshot.publishedAt,
    economicOperatorId: snapshot.issuer?.economicOperatorId ?? null,
    economicOperatorIdScheme: snapshot.issuer?.economicOperatorIdScheme ?? null,
    facilityId: p.facilityId ?? null,
    contentSpecificationIds: p.contentSpecificationIds || [],
    language: p.language || "nl-NL"
  };
}

function toDppJson(snapshot, { qrBaseUrl, version = null, lastUpdated = null, instance = null }) {
  const publicId = snapshot.publicId;
  const dppPublicId = instance?.publicId || publicId;
  const passportUrl = passportBaseUrl(qrBaseUrl, dppPublicId);
  const p = snapshot.product;
  const absolute = (url) => (url && url.startsWith("/") ? `${qrBaseUrl}${url}` : url);
  const gs1Path = gs1.digitalLinkPath({ gtin: p.gtin, lot: instance?.lotNumber, serial: instance?.serialNumber });
  const publicDocuments = snapshot.documents.filter((d) => d.isPublic);
  const docUrl = (d) => absolute(documentUrl(publicId, d, version && !version.isCurrent ? version.versionNumber : null));
  return {
    ...dppHeader(snapshot, { qrBaseUrl, lastUpdated: lastUpdated || version?.createdAt, instance }),
    id: passportUrl,
    identifiers: {
      passportId: dppPublicId,
      urn: `urn:uuid:${dppPublicId}`,
      gtin: p.gtin,
      sku: p.sku,
      gs1DigitalLink: gs1Path ? `https://id.gs1.org${gs1Path}` : null,
      ...(instance
        ? {
            modelPassportId: publicId,
            modelPassport: passportBaseUrl(qrBaseUrl, publicId),
            lotNumber: instance.lotNumber ?? null,
            serialNumber: instance.serialNumber ?? null
          }
        : {})
    },
    passportGranularity: instance?.granularity || "model",
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
    issuer: {
      name: snapshot.issuer?.name ?? null,
      economicOperatorId: snapshot.issuer?.economicOperatorId ?? null,
      economicOperatorIdScheme: snapshot.issuer?.economicOperatorIdScheme ?? null
    },
    product: {
      name: p.name,
      brand: p.brand,
      model: p.model,
      category: p.categoryLabel,
      description: p.description,
      manufacturer: p.manufacturer,
      countryOfOrigin: p.countryOfOrigin,
      highlights: p.highlights,
      image: p.photo ? `${qrBaseUrl}/api/public/products/${publicId}/photo` : null,
      language: p.language || "nl-NL",
      nameMultiLanguage: multiLanguage(snapshot, "name"),
      descriptionMultiLanguage: multiLanguage(snapshot, "description")
    },
    sustainability: snapshot.sustainability,
    compliance: snapshot.compliance,
    parts: snapshot.parts.map(({ id, ...rest }) => ({ ...rest })),
    documents: publicDocuments.map((d) => ({
      title: d.title,
      type: d.type,
      category: d.category,
      language: d.language,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      validUntil: d.validUntil,
      version: d.version,
      url: docUrl(d)
    })),
    // Zelfde documenten in de vorm RelatedResource (titel, soort, MIME-type, download-URL).
    relatedResources: publicDocuments.map((d) => ({
      resourceType: d.category || d.type || "document",
      title: d.title,
      mimeType: d.mimeType,
      language: d.language,
      url: docUrl(d),
      validUntil: d.validUntil
    })),
    dataElements: dataElements(snapshot, qrBaseUrl)
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
  DPP_SCHEMA_VERSION,
  DATA_ELEMENTS,
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
