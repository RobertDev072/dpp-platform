const crypto = require("crypto");
const { getSupabaseAdmin, isSupabaseConfigured, IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../config/supabase");
const { HttpError } = require("../middleware/errorHandler");

// Bestandsopslag in Supabase Storage (vervangt Azure Blob Storage).
//
// Waarom uploads niet meer via onze server lopen: een Vercel Function accepteert
// maximaal 4,5 MB per request/response (harde limiet, ook op Pro). Foto's (5 MB) en
// documenten (10 MB) gaan daarom rechtstreeks van de browser naar Supabase:
//   1. de server controleert rechten, type en grootte en geeft een éénmalige,
//      kortlevende upload-URL uit voor een door de server gekozen pad;
//   2. de browser PUT het bestand naar die URL;
//   3. de server controleert het geüploade object (bestaat, grootte, type) en legt
//      het pad pas dan vast in de database.
// Downloads: de server controleert de rechten en stuurt een redirect naar een
// signed URL die maar kort geldig is (zie DOWNLOAD_URL_TTL_SECONDS). De buckets zelf
// zijn en blijven privé; de service-role-key verlaat nooit de server.

const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

const ALLOWED_DOCUMENT_MIME_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp"
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_MB = 10;
const DOCUMENT_MAX_BYTES = DOCUMENT_MAX_MB * 1024 * 1024;

// Kort genoeg dat een gelekte link snel waardeloos is, lang genoeg voor een trage
// mobiele verbinding om het bestand te starten.
const DOWNLOAD_URL_TTL_SECONDS = 120;

const KINDS = {
  photo: {
    bucket: IMAGES_BUCKET,
    mimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxBytes: PHOTO_MAX_BYTES,
    typeError: "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan.",
    sizeError: "De afbeelding is te groot (max 5 MB)."
  },
  document: {
    bucket: DOCUMENTS_BUCKET,
    mimeTypes: ALLOWED_DOCUMENT_MIME_TYPES,
    maxBytes: DOCUMENT_MAX_BYTES,
    typeError: "Alleen PDF, JPEG, PNG, SVG of WEBP-bestanden zijn toegestaan.",
    sizeError: `Het bestand is te groot (max ${DOCUMENT_MAX_MB} MB). Verklein de PDF (bijv. comprimeren of splitsen) en probeer opnieuw.`
  }
};

const NOT_CONFIGURED_MESSAGE =
  "Bestandsopslag is niet geconfigureerd. Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY (zie README.md).";

function storage() {
  if (!isSupabaseConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }
  return getSupabaseAdmin().storage;
}

function kindConfig(kind) {
  const config = KINDS[kind];
  if (!config) throw new Error(`Onbekend bestandssoort: ${kind}`);
  return config;
}

// Nieuwe uploads krijgen een pad per bedrijf/product; zo kan de server bij het
// afronden afdwingen dat een upload-pad echt bij dít product hoort.
function uploadPrefix(companyId, productId) {
  return `${Number(companyId)}/${Number(productId)}/`;
}

const UPLOAD_PATH_PATTERN = /^\d+\/\d+\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

async function createUploadTarget({ kind, companyId, productId, mimeType, size }) {
  const config = kindConfig(kind);
  const extension = config.mimeTypes[mimeType];
  if (!extension) {
    throw new HttpError(400, config.typeError);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new HttpError(400, "Geen (leeg) bestand ontvangen.");
  }
  if (size > config.maxBytes) {
    throw new HttpError(400, config.sizeError);
  }

  const path = `${uploadPrefix(companyId, productId)}${crypto.randomUUID()}.${extension}`;
  const { data, error } = await storage().from(config.bucket).createSignedUploadUrl(path);
  if (error) {
    throw new HttpError(502, "Kon geen upload starten bij de bestandsopslag. Probeer het opnieuw.");
  }

  return { path: data.path, uploadUrl: data.signedUrl, maxBytes: config.maxBytes };
}

// Grootte en type van een object. Primair via het info-endpoint; valt terug op een
// list() van de map (oudere Storage-versies kennen info nog niet).
async function getObjectMetadata(bucket, path) {
  const api = storage().from(bucket);
  const { data, error } = await api.info(path);
  if (!error && data) {
    return {
      size: Number(data.size ?? data.metadata?.size ?? 0),
      contentType: data.contentType || data.metadata?.mimetype || null
    };
  }

  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const listed = await api.list(folder, { search: name, limit: 10 });
  const entry = listed.data?.find((item) => item.name === name);
  if (!entry) return null;
  return {
    size: Number(entry.metadata?.size ?? 0),
    contentType: entry.metadata?.mimetype || null
  };
}

// Controleert een door de browser afgeronde upload vóórdat het pad in de database
// komt. Supabase dwingt type en grootte ook al af op bucketniveau (zie
// scripts/setup-supabase-storage.js); dit is de tweede, eigen controle.
async function assertUploadedObject({ kind, companyId, productId, path }) {
  const config = kindConfig(kind);
  if (
    typeof path !== "string" ||
    !UPLOAD_PATH_PATTERN.test(path) ||
    !path.startsWith(uploadPrefix(companyId, productId))
  ) {
    throw new HttpError(400, "Ongeldig uploadpad.");
  }

  const meta = await getObjectMetadata(config.bucket, path);
  if (!meta) {
    throw new HttpError(400, "Het bestand is niet (volledig) geüpload. Probeer het opnieuw.");
  }
  const { size, contentType } = meta;

  if (!config.mimeTypes[contentType] || !size || size > config.maxBytes) {
    await removeObject(kind, path);
    throw new HttpError(400, !config.mimeTypes[contentType] ? config.typeError : config.sizeError);
  }

  return { size, contentType };
}

async function createDownloadUrl(kind, path, { downloadName } = {}) {
  const config = kindConfig(kind);
  const { data, error } = await storage()
    .from(config.bucket)
    .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) {
    if (error && (error.status === 404 || error.statusCode === "404" || /not found/i.test(error.message || ""))) {
      throw new HttpError(404, "Bestand niet gevonden");
    }
    throw new HttpError(502, "Kon het bestand niet ophalen uit de bestandsopslag.");
  }
  return data.signedUrl;
}

// Opruimen is best-effort: een achtergebleven bestand kost alleen opslag, een
// mislukte opruiming mag de eigenlijke actie nooit laten falen.
async function removeObject(kind, path) {
  if (!path || !isSupabaseConfigured()) return;
  try {
    await storage().from(kindConfig(kind).bucket).remove([path]);
  } catch (error) {
    console.error("Opruimen van bestand in Storage mislukt:", error.message);
  }
}

// Stuurt de browser door naar een kortlevende signed URL. Nooit cachen: de URL
// verloopt, de redirect zelf moet dus elke keer opnieuw worden opgevraagd.
async function redirectToObject(res, kind, path, options) {
  const url = await createDownloadUrl(kind, path, options);
  res.set("Cache-Control", "no-store");
  res.redirect(302, url);
}

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  PHOTO_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_MB,
  IMAGES_BUCKET,
  DOCUMENTS_BUCKET,
  createUploadTarget,
  assertUploadedObject,
  createDownloadUrl,
  redirectToObject,
  removeObject
};
