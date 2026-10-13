const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand
} = require("@aws-sdk/client-s3");
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

// Uploadlimieten. Foto's mogen groot binnenkomen (telefoon), maar worden direct
// verkleind (processProductPhoto); alleen de verkleinde versie wordt bewaard.
// Documenten worden ongewijzigd bewaard (een handleiding van 50 pagina's is als
// gewone PDF 2-5 MB, gescand 15-25 MB).
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const PHOTO_MAX_MB = PHOTO_MAX_BYTES / (1024 * 1024);
const DOCUMENT_MAX_MB = DOCUMENT_MAX_BYTES / (1024 * 1024);

// Downloadlinks zijn per aanvraag vers en kortlevend: de stabiele link blijft onze
// eigen API-route (die eerst de toegang controleert en dan doorverwijst).
const SIGNED_DOWNLOAD_SECONDS = 300;
// Een presigned upload hoeft alleen de tijd tussen "upload-url" en de daadwerkelijke
// upload te overbruggen.
const SIGNED_UPLOAD_SECONDS = 300;

const NOT_CONFIGURED_MESSAGE =
  "Bestandsopslag is niet ingesteld, dus uploads van foto's en documenten staan uit. Zie S3_* in .env.example.";

let client;

function getClient() {
  if (!isStorageConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }
  if (!client) {
    const config = readConfig();
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {})
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
// naar de opslag met een presigned PUT (werkt met elke S3-compatibele opslag, ook
// Cloudflare R2, die geen presigned POST kent). Content-Type en Content-Length zitten in
// de handtekening, dus de opslag accepteert alleen exact deze sleutel, dit type en de
// aangemelde grootte. De server controleert vóór het ondertekenen de tenant (in de
// route) en type/grootte (hier), en na de upload nogmaals de werkelijke metadata
// (verifyUploadedObject).

async function createSignedUpload({ bucket, productId, mimeType, size, allowed, maxBytes, tooLargeMessage, typeMessage }) {
  const extension = allowed[mimeType];
  if (!extension) {
    throw new HttpError(400, typeMessage);
  }
  if (!Number.isInteger(size) || size <= 0 || size > maxBytes) {
    throw new HttpError(400, tooLargeMessage);
  }
  const objectName = newObjectName(productId, extension);
  try {
    const uploadUrl = await getSignedUrl(
      getClient(),
      new PutObjectCommand({ Bucket: bucket, Key: objectName, ContentType: mimeType, ContentLength: size }),
      { expiresIn: SIGNED_UPLOAD_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) }
    );
    return { objectName, uploadUrl, method: "PUT", headers: { "Content-Type": mimeType } };
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
    tooLargeMessage: `De afbeelding is te groot (max ${PHOTO_MAX_MB} MB).`,
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
    tooLargeMessage: `Het bestand is te groot (max ${DOCUMENT_MAX_MB} MB). Exporteer de PDF opnieuw (niet scannen) of splits het document en probeer opnieuw.`,
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

// --- afbeeldingen verwerken ----------------------------------------------------------
// Productfoto: één WebP van max. 2000 × 2000 px (±300-600 kB; ruim genoeg voor scherm
// en drukwerk) plus een miniatuur van 800 px breed (±40-80 kB) voor het publieke
// paspoort. Het origineel (vaak 3-8 MB van een telefoon) wordt niet bewaard. Sleutels:
// products/<id>/<uuid>.webp en <die sleutel>.w800.webp, nooit overschreven.
const PHOTO_MAX_PX = 2000;
const THUMB_WIDTH = 800;

async function streamToBuffer(body) {
  if (body && typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readObject(bucket, objectName, action = "het bestand lezen") {
  try {
    const object = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: objectName }));
    return await streamToBuffer(object.Body);
  } catch (error) {
    throw storageError(action, bucket, error);
  }
}

async function deleteObjectQuietly(bucket, objectName) {
  await getClient()
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: objectName }))
    .catch((error) => logger.warn("s3_delete_failed", { bucket, errorName: error?.name }));
}

const UNREADABLE_IMAGE = "Deze afbeelding kan niet worden verwerkt. Probeer een JPG, PNG of WEBP.";

// Productfoto verwerken: uit een buffer (multipart) of een al geüpload object (directe
// upload; dat origineel wordt daarna verwijderd).
async function processProductPhoto({ productId, objectName = null, sourceBuffer = null }) {
  const sharp = require("sharp");
  const bucket = bucketFor("image");
  const input = sourceBuffer || (await readObject(bucket, objectName, "de foto lezen"));
  let main;
  let thumb;
  try {
    main = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: PHOTO_MAX_PX, height: PHOTO_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    thumb = await sharp(main).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    if (objectName) await deleteObjectQuietly(bucket, objectName);
    throw new HttpError(400, UNREADABLE_IMAGE);
  }
  const photoBlobName = newObjectName(productId, "webp");
  const photoThumbBlobName = `${photoBlobName}.w${THUMB_WIDTH}.webp`;
  await uploadObject({ bucket, objectName: photoBlobName, buffer: main, mimeType: "image/webp" });
  await uploadObject({ bucket, objectName: photoThumbBlobName, buffer: thumb, mimeType: "image/webp" });
  if (objectName) await deleteObjectQuietly(bucket, objectName);
  return { photoBlobName, photoThumbBlobName, bytes: main.length + thumb.length };
}

// Logo of profielfoto: vierkant passend in size × size px, WebP (±5-30 kB).
// prefix: "companies/<id>" of "users/<id>". Geeft de objectnaam terug.
async function storeSmallImage({ prefix, buffer, size = 256 }) {
  const sharp = require("sharp");
  let output;
  try {
    output = await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new HttpError(400, UNREADABLE_IMAGE);
  }
  const objectName = `${prefix}/${crypto.randomUUID()}.webp`;
  await uploadObject({ bucket: bucketFor("image"), objectName, buffer: output, mimeType: "image/webp" });
  return objectName;
}

// Afbeelding uit de (privé) fotobucket ophalen om via de app te serveren.
async function readImage(objectName) {
  const bucket = bucketFor("image");
  try {
    const object = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: objectName }));
    return { buffer: await streamToBuffer(object.Body), contentType: object.ContentType || "image/webp" };
  } catch (error) {
    throw storageError("de afbeelding lezen", bucket, error);
  }
}

// Lichte bereikbaarheidscheck voor de healthcheck.
async function pingStorage() {
  await getClient().send(new HeadBucketCommand({ Bucket: bucketFor("image") }));
}

module.exports = {
  uploadProductPhoto,
  processProductPhoto,
  storeSmallImage,
  readImage,
  deleteObjectQuietly,
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
  streamToBuffer,
  setS3ClientForTests,
  belongsToProduct,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  PHOTO_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  PHOTO_MAX_MB,
  DOCUMENT_MAX_MB
};
