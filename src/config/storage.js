// Bestandsopslag via het S3-protocol: twee privé-buckets (productfoto's en
// productdocumenten). Werkt met elke S3-compatibele opslag, bijvoorbeeld lokaal MinIO
// of later Cloudflare R2. De browser krijgt alleen kortlevende presigned URL's voor
// precies één object.
//
// Niet ingesteld (lokaal ontwikkelen zonder opslag): uploads van foto's en documenten
// geven een duidelijke melding (503); de rest van de app werkt gewoon.
//
//   S3_ENDPOINT            bijv. http://127.0.0.1:9000 (MinIO) of https://<account>.r2.cloudflarestorage.com
//   S3_REGION              regio van de opslag; voor R2 "auto" (standaard)
//   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
//   S3_IMAGES_BUCKET / S3_DOCUMENTS_BUCKET
//   S3_FORCE_PATH_STYLE    true voor MinIO
function readConfig() {
  return {
    region: process.env.S3_REGION || "auto",
    imagesBucket: process.env.S3_IMAGES_BUCKET || null,
    documentsBucket: process.env.S3_DOCUMENTS_BUCKET || null,
    endpoint: process.env.S3_ENDPOINT || null,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || null,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
  };
}

function isStorageConfigured() {
  const config = readConfig();
  return Boolean(config.endpoint && config.imagesBucket && config.documentsBucket);
}

// Voor het config-diagnose-endpoint: alleen niet-geheime waarden.
function getStorageDiagnostics() {
  const config = readConfig();
  return {
    configured: isStorageConfigured(),
    region: config.region,
    imagesBucket: config.imagesBucket,
    documentsBucket: config.documentsBucket,
    customEndpoint: Boolean(config.endpoint)
  };
}

module.exports = { readConfig, isStorageConfigured, getStorageDiagnostics };
