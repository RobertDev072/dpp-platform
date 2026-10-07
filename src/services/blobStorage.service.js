const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  isStorageConfigured,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  IMAGES_BUCKET,
  DOCUMENTS_BUCKET
} = require("../config/storage");
const { getPool } = require("../config/db");
const { HttpError } = require("../middleware/errorHandler");

const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

// Productdocumenten: handleidingen, certificaten, beschrijvingen e.d.
const ALLOWED_DOCUMENT_MIME_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp"
};

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

// Downloadlinks zijn per aanvraag vers en kortlevend: de stabiele link blijft onze
// eigen API-route (die eerst de toegang controleert en dan doorverwijst).
const SIGNED_DOWNLOAD_SECONDS = 300;

const NOT_CONFIGURED_MESSAGE =
  "Bestandsopslag is niet geconfigureerd. Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY (zie README.md).";

let client;

function getClient() {
  if (!isStorageConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

function storageError(action, bucket, error) {
  if (error && (error.statusCode === "404" || error.status === 404 || /not found/i.test(error.message || ""))) {
    return new HttpError(404, "Bestand niet gevonden");
  }
  return new HttpError(502, `Kon ${action} niet uitvoeren in Supabase Storage-bucket "${bucket}".`);
}

// Nieuwe objecten krijgen het product-id als prefix. Daarmee kan de server bij het
// afronden van een directe upload controleren dat het object echt voor dít product
// is uitgegeven (en niet een object van een ander bedrijf wordt "geclaimd").
// Gemigreerde objecten uit Azure houden hun oorspronkelijke platte naam.
function newObjectName(productId, extension) {
  return `products/${productId}/${crypto.randomUUID()}.${extension}`;
}

function belongsToProduct(objectName, productId) {
  return typeof objectName === "string" && objectName.startsWith(`products/${productId}/`) && !objectName.includes("..");
}

async function uploadObject({ bucket, objectName, buffer, mimeType }) {
  const { error } = await getClient().storage.from(bucket).upload(objectName, buffer, {
    contentType: mimeType,
    upsert: false
  });
  if (error) throw storageError("de upload", bucket, error);
  return objectName;
}

// --- uploads via de server (multipart, alleen bestanden < ~4 MB op Vercel) ----------

async function uploadProductPhoto({ productId, buffer, mimeType }) {
  const extension = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan.");
  }
  return uploadObject({ bucket: IMAGES_BUCKET, objectName: newObjectName(productId, extension), buffer, mimeType });
}

async function uploadProductDocument({ productId, buffer, mimeType }) {
  const extension = ALLOWED_DOCUMENT_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen PDF, JPEG, PNG, SVG of WEBP-bestanden zijn toegestaan.");
  }
  return uploadObject({ bucket: DOCUMENTS_BUCKET, objectName: newObjectName(productId, extension), buffer, mimeType });
}

// --- directe uploads vanuit de browser -------------------------------------------
// Vercel-functies accepteren maximaal 4,5 MB per request; documenten mogen 10 MB zijn.
// Daarom uploadt de browser rechtstreeks naar Supabase Storage met een eenmalige
// signed upload-URL (alleen geldig voor precies dit object). De bucket dwingt
// daarnaast zelf de maximale grootte en toegestane MIME-types af.

async function createSignedUpload({ bucket, productId, mimeType, size, allowed, maxBytes, tooLargeMessage, typeMessage }) {
  const extension = allowed[mimeType];
  if (!extension) {
    throw new HttpError(400, typeMessage);
  }
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
    throw new HttpError(400, tooLargeMessage);
  }
  const objectName = newObjectName(productId, extension);
  const { data, error } = await getClient().storage.from(bucket).createSignedUploadUrl(objectName);
  if (error) throw storageError("een upload-URL aanmaken", bucket, error);
  return { objectName, uploadUrl: data.signedUrl };
}

function createPhotoUpload({ productId, mimeType, size }) {
  return createSignedUpload({
    bucket: IMAGES_BUCKET,
    productId,
    mimeType,
    size,
    allowed: ALLOWED_IMAGE_MIME_TYPES,
    maxBytes: PHOTO_MAX_BYTES,
    tooLargeMessage: "De afbeelding is te groot (max 5 MB).",
    typeMessage: "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan."
  });
}

function createDocumentUpload({ productId, mimeType, size }) {
  return createSignedUpload({
    bucket: DOCUMENTS_BUCKET,
    productId,
    mimeType,
    size,
    allowed: ALLOWED_DOCUMENT_MIME_TYPES,
    maxBytes: DOCUMENT_MAX_BYTES,
    tooLargeMessage: "Het bestand is te groot (max 10 MB). Verklein de PDF (bijv. comprimeren of splitsen) en probeer opnieuw.",
    typeMessage: "Alleen PDF, JPEG, PNG, SVG of WEBP-bestanden zijn toegestaan."
  });
}

// Controleert na een directe upload dat het object bestaat, bij dit product hoort en
// binnen de regels valt. Leest de metadata rechtstreeks uit storage.objects (zelfde
// database), zodat er geen extra API-call naar Storage nodig is.
async function verifyUploadedObject({ bucket, objectName, productId, allowed, maxBytes }) {
  if (!belongsToProduct(objectName, productId)) {
    throw new HttpError(400, "Onbekende upload.");
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input("bucket", bucket)
    .input("name", objectName)
    .query("SELECT metadata FROM storage.objects WHERE bucket_id = @bucket AND name = @name");
  const metadata = result.recordset[0]?.metadata;
  if (!metadata) {
    throw new HttpError(400, "Het bestand is niet (volledig) geüpload. Probeer het opnieuw.");
  }
  const size = Number(metadata.size ?? metadata.contentLength ?? 0);
  const mimeType = metadata.mimetype || metadata.contentType || null;
  if (!allowed[mimeType] || size <= 0 || size > maxBytes) {
    await getClient().storage.from(bucket).remove([objectName]).catch(() => {});
    throw new HttpError(400, "Dit bestand voldoet niet aan de eisen (type of grootte).");
  }
  return { size, mimeType };
}

function verifyUploadedPhoto({ objectName, productId }) {
  return verifyUploadedObject({
    bucket: IMAGES_BUCKET,
    objectName,
    productId,
    allowed: ALLOWED_IMAGE_MIME_TYPES,
    maxBytes: PHOTO_MAX_BYTES
  });
}

function verifyUploadedDocument({ objectName, productId }) {
  return verifyUploadedObject({
    bucket: DOCUMENTS_BUCKET,
    objectName,
    productId,
    allowed: ALLOWED_DOCUMENT_MIME_TYPES,
    maxBytes: DOCUMENT_MAX_BYTES
  });
}

// --- downloads ------------------------------------------------------------------
// De buckets zijn privé. Onze routes controleren eerst de toegang (tenant of
// "gepubliceerd + publiek") en verwijzen dan door naar een signed URL die maar een
// paar minuten geldig is. Doorverwijzen i.p.v. zelf streamen: Vercel-functies
// hebben een maximale responsgrootte, en zo loopt het dataverkeer niet via Vercel.

async function getSignedDownloadUrl(bucket, objectName, { downloadName } = {}) {
  const options = downloadName ? { download: downloadName } : undefined;
  const { data, error } = await getClient()
    .storage.from(bucket)
    .createSignedUrl(objectName, SIGNED_DOWNLOAD_SECONDS, options);
  if (error) throw storageError("een downloadlink aanmaken", bucket, error);
  return data.signedUrl;
}

function getProductPhotoUrl(objectName) {
  return getSignedDownloadUrl(IMAGES_BUCKET, objectName);
}

function getProductDocumentUrl(objectName) {
  return getSignedDownloadUrl(DOCUMENTS_BUCKET, objectName);
}

// Lichte bereikbaarheidscheck voor de healthcheck.
async function pingStorage() {
  const { error } = await getClient().storage.getBucket(IMAGES_BUCKET);
  if (error) throw new Error(error.message);
}

module.exports = {
  uploadProductPhoto,
  uploadProductDocument,
  createPhotoUpload,
  createDocumentUpload,
  verifyUploadedPhoto,
  verifyUploadedDocument,
  getProductPhotoUrl,
  getProductDocumentUrl,
  pingStorage,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  IMAGES_BUCKET,
  DOCUMENTS_BUCKET
};
