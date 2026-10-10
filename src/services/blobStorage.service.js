const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand
} = require("@aws-sdk/client-s3");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { readConfig, isStorageConfigured } = require("../config/storage");
const { HttpError } = require("../middleware/errorHandler");
const logger = require("../utils/logger");

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
// Een presigned upload hoeft alleen de tijd tussen "upload-url" en de daadwerkelijke
// upload te overbruggen.
const SIGNED_UPLOAD_SECONDS = 300;

const NOT_CONFIGURED_MESSAGE =
  "Bestandsopslag is niet geconfigureerd. Zet AWS_REGION, S3_IMAGES_BUCKET en S3_DOCUMENTS_BUCKET (zie README.md).";

let client;

function getClient() {
  if (!isStorageConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }
  if (!client) {
    const config = readConfig();
    // Geen credentials meegeven: de SDK gebruikt de standaardketen (op AWS de
    // IAM-rol van de ECS-taak, lokaal een AWS-profiel of env-vars).
    client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle
    });
  }
  return client;
}

// Alleen voor tests: een nep-client injecteren (de presign-functies rekenen lokaal,
// zonder netwerk; Head/Delete gaan via client.send).
function setS3ClientForTests(fake) {
  client = fake;
}

function bucketFor(kind) {
  const config = readConfig();
  return kind === "image" ? config.imagesBucket : config.documentsBucket;
}

function isNotFound(error) {
  const status = error?.$metadata?.httpStatusCode;
  return status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

function storageError(action, bucket, error) {
  if (isNotFound(error)) {
    return new HttpError(404, "Bestand niet gevonden");
  }
  // Geen SDK-details (request-id's, ARN's) naar de client; wel loggen voor de beheerder.
  logger.error("s3_error", { action, bucket, errorName: error?.name, status: error?.$metadata?.httpStatusCode });
  return new HttpError(502, `Kon ${action} niet uitvoeren in de bestandsopslag.`);
}

// Nieuwe objecten krijgen het product-id als prefix. Daarmee kan de server bij het
// afronden van een directe upload controleren dat het object echt voor dít product
// is uitgegeven (en niet een object van een ander bedrijf wordt "geclaimd"). De
// sleutel bevat verder alleen een willekeurige UUID: geen bestandsnaam van de
// gebruiker, geen persoonsgegevens. Objecten worden nooit overschreven (elke upload
// krijgt een nieuwe sleutel), zodat eerder gearchiveerde paspoortversies naar
// ongewijzigde bestanden blijven verwijzen.
function newObjectName(productId, extension) {
  return `products/${productId}/${crypto.randomUUID()}.${extension}`;
}

function belongsToProduct(objectName, productId) {
  return (
    typeof objectName === "string" &&
    /^products\/\d+\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(objectName) &&
    objectName.startsWith(`products/${productId}/`)
  );
}

async function uploadObject({ bucket, objectName, buffer, mimeType }) {
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectName,
        Body: buffer,
        ContentType: mimeType,
        // Integriteit: S3 controleert de SHA-256 van de ontvangen bytes.
        ChecksumAlgorithm: "SHA256",
        // Nooit een bestaand object overschrijven.
        IfNoneMatch: "*"
      })
    );
  } catch (error) {
    throw storageError("de upload", bucket, error);
  }
  return objectName;
}

// --- uploads via de server (multipart) ------------------------------------------------

async function uploadProductPhoto({ productId, buffer, mimeType }) {
  const extension = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan.");
  }
  return uploadObject({ bucket: bucketFor("image"), objectName: newObjectName(productId, extension), buffer, mimeType });
}

async function uploadProductDocument({ productId, buffer, mimeType }) {
  const extension = ALLOWED_DOCUMENT_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen PDF, JPEG, PNG, SVG of WEBP-bestanden zijn toegestaan.");
  }
  return uploadObject({ bucket: bucketFor("document"), objectName: newObjectName(productId, extension), buffer, mimeType });
}

// --- directe uploads vanuit de browser -------------------------------------------
// Grote bestanden gaan niet door de applicatieserver: de browser uploadt rechtstreeks
// naar S3 met een presigned POST. De policy in die POST wordt door S3 zelf afgedwongen:
// exact deze objectsleutel, exact dit Content-Type en een maximale grootte. De server
// controleert vóór het ondertekenen de tenant (in de route) en type/grootte (hier), en
// na de upload nogmaals de werkelijke metadata (verifyUploadedObject).

async function createSignedUpload({ bucket, productId, mimeType, size, allowed, maxBytes, tooLargeMessage, typeMessage }) {
  const extension = allowed[mimeType];
  if (!extension) {
    throw new HttpError(400, typeMessage);
  }
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
    throw new HttpError(400, tooLargeMessage);
  }
  const objectName = newObjectName(productId, extension);
  try {
    const { url, fields } = await createPresignedPost(getClient(), {
      Bucket: bucket,
      Key: objectName,
      Conditions: [
        ["content-length-range", 1, maxBytes],
        ["eq", "$Content-Type", mimeType]
      ],
      Fields: { "Content-Type": mimeType },
      Expires: SIGNED_UPLOAD_SECONDS
    });
    return { objectName, uploadUrl: url, method: "POST", fields };
  } catch (error) {
    throw storageError("een upload-URL aanmaken", bucket, error);
  }
}

function createPhotoUpload({ productId, mimeType, size }) {
  return createSignedUpload({
    bucket: bucketFor("image"),
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
    bucket: bucketFor("document"),
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
// binnen de regels valt (HeadObject: alleen metadata, geen download).
async function verifyUploadedObject({ bucket, objectName, productId, allowed, maxBytes }) {
  if (!belongsToProduct(objectName, productId)) {
    throw new HttpError(400, "Onbekende upload.");
  }
  let head;
  try {
    head = await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: objectName }));
  } catch (error) {
    if (isNotFound(error)) {
      throw new HttpError(400, "Het bestand is niet (volledig) geüpload. Probeer het opnieuw.");
    }
    throw storageError("de upload controleren", bucket, error);
  }
  const size = Number(head.ContentLength ?? 0);
  const mimeType = head.ContentType || null;
  if (!allowed[mimeType] || size <= 0 || size > maxBytes) {
    await getClient()
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: objectName }))
      .catch(() => {});
    throw new HttpError(400, "Dit bestand voldoet niet aan de eisen (type of grootte).");
  }
  return { size, mimeType };
}

function verifyUploadedPhoto({ objectName, productId }) {
  return verifyUploadedObject({
    bucket: bucketFor("image"),
    objectName,
    productId,
    allowed: ALLOWED_IMAGE_MIME_TYPES,
    maxBytes: PHOTO_MAX_BYTES
  });
}

function verifyUploadedDocument({ objectName, productId }) {
  return verifyUploadedObject({
    bucket: bucketFor("document"),
    objectName,
    productId,
    allowed: ALLOWED_DOCUMENT_MIME_TYPES,
    maxBytes: DOCUMENT_MAX_BYTES
  });
}

// --- downloads ------------------------------------------------------------------
// De buckets zijn privé. Onze routes controleren eerst de toegang (tenant of
// "gepubliceerd + publiek") en verwijzen dan door naar een presigned URL die maar een
// paar minuten geldig is. Zo loopt het bestandsverkeer niet via de applicatieserver.

async function getSignedDownloadUrl(bucket, objectName, { downloadName } = {}) {
  try {
    return await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectName,
        // SVG kan script bevatten: nooit inline laten renderen.
        ...(objectName.endsWith(".svg") || downloadName
          ? { ResponseContentDisposition: `attachment${downloadName ? `; filename="${downloadName.replace(/["\\\r\n]/g, "")}"` : ""}` }
          : {})
      }),
      { expiresIn: SIGNED_DOWNLOAD_SECONDS }
    );
  } catch (error) {
    throw storageError("een downloadlink aanmaken", bucket, error);
  }
}

function getProductPhotoUrl(objectName) {
  return getSignedDownloadUrl(bucketFor("image"), objectName);
}

function getProductDocumentUrl(objectName) {
  return getSignedDownloadUrl(bucketFor("document"), objectName);
}

// Lichte bereikbaarheidscheck voor de healthcheck.
async function pingStorage() {
  await getClient().send(new HeadBucketCommand({ Bucket: bucketFor("image") }));
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
  getClient,
  bucketFor,
  setS3ClientForTests,
  belongsToProduct,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  PHOTO_MAX_BYTES,
  DOCUMENT_MAX_BYTES
};
