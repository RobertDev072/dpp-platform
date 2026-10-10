const crypto = require("crypto");
const {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  getSupabaseAdmin,
  isSupabaseConfigured,
  IMAGES_BUCKET: SUPABASE_IMAGES_BUCKET,
  DOCUMENTS_BUCKET: SUPABASE_DOCUMENTS_BUCKET
} = require("../config/supabase");
const { isS3Configured, getS3Client } = require("../config/s3");
const { HttpError } = require("../middleware/errorHandler");

// Bestandsopslag: AWS S3 (STORAGE_PROVIDER=s3) of Supabase Storage (standaard).
// Beide backends hebben dezelfde vier operaties; de rest van dit bestand (rechten,
// type- en groottecontrole, paden) is gedeeld en weet niet welke backend draait.
//
// Waarom uploads niet via onze server lopen: grote PDF's (tot DOCUMENT_MAX_MB) zouden
// de server onnodig belasten (en op Vercel geldt een harde limiet van 4,5 MB per
// request). Bestanden gaan daarom rechtstreeks van de browser naar de opslag:
//   1. de server controleert rechten, type en grootte en geeft een éénmalige,
//      kortlevende upload-URL uit voor een door de server gekozen pad;
//   2. de browser PUT het bestand naar die URL;
//   3. de server controleert het geüploade object (bestaat, grootte, type) en legt
//      het pad pas dan vast in de database.
// Downloads: de server controleert de rechten en stuurt een redirect naar een
// signed URL die maar kort geldig is (zie DOWNLOAD_URL_TTL_SECONDS). De buckets zelf
// zijn en blijven privé; sleutels en credentials verlaten nooit de server.

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
// Instelbaar: gebruikers slaan veel en grote PDF's op (handleidingen, certificaten,
// testrapporten). Op S3 is een losse PUT tot 5 GB mogelijk; de grens is dus een
// productkeuze. Op Supabase moet de bucketlimiet (scripts/setup-supabase-storage.js)
// meebewegen.
const DOCUMENT_MAX_MB = Number(process.env.DOCUMENT_MAX_MB) || 10;
const DOCUMENT_MAX_BYTES = DOCUMENT_MAX_MB * 1024 * 1024;

// Kort genoeg dat een gelekte link snel waardeloos is, lang genoeg voor een trage
// mobiele verbinding om het bestand te starten.
const DOWNLOAD_URL_TTL_SECONDS = 120;
// Een grote PDF over een trage verbinding moet binnen deze tijd *starten*; S3 checkt
// de geldigheid bij het begin van de upload, niet aan het eind.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || "supabase").toLowerCase();
const IS_S3 = STORAGE_PROVIDER === "s3";

const IMAGES_BUCKET = IS_S3 ? process.env.S3_IMAGES_BUCKET : SUPABASE_IMAGES_BUCKET;
const DOCUMENTS_BUCKET = IS_S3 ? process.env.S3_DOCUMENTS_BUCKET : SUPABASE_DOCUMENTS_BUCKET;

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

const NOT_CONFIGURED_MESSAGE = IS_S3
  ? "Bestandsopslag is niet geconfigureerd. Zet AWS_REGION, S3_IMAGES_BUCKET en S3_DOCUMENTS_BUCKET (zie infra/aws/README.md)."
  : "Bestandsopslag is niet geconfigureerd. Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY (zie README.md).";

function isStorageConfigured() {
  return IS_S3 ? isS3Configured() : isSupabaseConfigured();
}

function assertConfigured() {
  if (!isStorageConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }
}

function isNotFound(error) {
  return (
    error?.name === "NotFound" ||
    error?.name === "NoSuchKey" ||
    error?.$metadata?.httpStatusCode === 404 ||
    error?.status === 404 ||
    error?.statusCode === "404" ||
    /not found/i.test(error?.message || "")
  );
}

// --- backend: AWS S3 -------------------------------------------------------------
// Beide buckets zijn privé met versiebeheer (infra/aws): een "verwijderd" bestand
// krijgt alleen een delete-marker, eerdere versies blijven bewaard (EN 18221).
const s3Backend = {
  async createUploadUrl(bucket, path, { mimeType }) {
    // ContentType zit in de handtekening: de browser moet exact dit type meesturen.
    const command = new PutObjectCommand({ Bucket: bucket, Key: path, ContentType: mimeType });
    return getSignedUrl(getS3Client(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  },

  async getObjectMetadata(bucket, path) {
    try {
      const head = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
      return { size: Number(head.ContentLength || 0), contentType: head.ContentType || null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  async createDownloadUrl(bucket, path, { downloadName } = {}) {
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
    } catch (error) {
      if (isNotFound(error)) throw new HttpError(404, "Bestand niet gevonden");
      throw new HttpError(502, "Kon het bestand niet ophalen uit de bestandsopslag.");
    }
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: path,
      ...(downloadName
        ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
        : {})
    });
    return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  },

  async remove(bucket, path) {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
  },

  async ping() {
    await getS3Client().send(new HeadBucketCommand({ Bucket: IMAGES_BUCKET }));
  }
};

// --- backend: Supabase Storage ---------------------------------------------------
const supabaseBackend = {
  async createUploadUrl(bucket, path) {
    const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw error;
    return data.signedUrl;
  },

  // Grootte en type van een object. Primair via het info-endpoint; valt terug op een
  // list() van de map (oudere Storage-versies kennen info nog niet).
  async getObjectMetadata(bucket, path) {
    const api = getSupabaseAdmin().storage.from(bucket);
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
  },

  async createDownloadUrl(bucket, path, { downloadName } = {}) {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucket)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined);
    if (error || !data?.signedUrl) {
      if (error && isNotFound(error)) {
        throw new HttpError(404, "Bestand niet gevonden");
      }
      throw new HttpError(502, "Kon het bestand niet ophalen uit de bestandsopslag.");
    }
    return data.signedUrl;
  },

  async remove(bucket, path) {
    await getSupabaseAdmin().storage.from(bucket).remove([path]);
  },

  async ping() {
    const { error } = await getSupabaseAdmin().storage.getBucket(IMAGES_BUCKET);
    if (error) throw new Error(error.message);
  }
};

const backend = IS_S3 ? s3Backend : supabaseBackend;

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

  assertConfigured();
  const path = `${uploadPrefix(companyId, productId)}${crypto.randomUUID()}.${extension}`;
  let uploadUrl;
  try {
    uploadUrl = await backend.createUploadUrl(config.bucket, path, { mimeType });
  } catch {
    throw new HttpError(502, "Kon geen upload starten bij de bestandsopslag. Probeer het opnieuw.");
  }

  return { path, uploadUrl, maxBytes: config.maxBytes };
}

// Controleert een door de browser afgeronde upload vóórdat het pad in de database
// komt. Bij S3 is dit de enige groottecontrole (een presigned PUT begrenst de grootte
// niet); bij Supabase dwingt de bucket type en grootte ook al af (zie
// scripts/setup-supabase-storage.js).
async function assertUploadedObject({ kind, companyId, productId, path }) {
  const config = kindConfig(kind);
  if (
    typeof path !== "string" ||
    !UPLOAD_PATH_PATTERN.test(path) ||
    !path.startsWith(uploadPrefix(companyId, productId))
  ) {
    throw new HttpError(400, "Ongeldig uploadpad.");
  }

  assertConfigured();
  const meta = await backend.getObjectMetadata(config.bucket, path);
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

async function createDownloadUrl(kind, path, options) {
  assertConfigured();
  return backend.createDownloadUrl(kindConfig(kind).bucket, path, options);
}

// Opruimen is best-effort: een achtergebleven bestand kost alleen opslag, een
// mislukte opruiming mag de eigenlijke actie nooit laten falen.
async function removeObject(kind, path) {
  if (!path || !isStorageConfigured()) return;
  try {
    await backend.remove(kindConfig(kind).bucket, path);
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

// Voor de health-check en Systeemstatus.
async function pingStorage() {
  assertConfigured();
  await backend.ping();
}

module.exports = {
  STORAGE_PROVIDER,
  isStorageConfigured,
  pingStorage,
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
