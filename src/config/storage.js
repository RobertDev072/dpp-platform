// Bestandsopslag op Amazon S3: twee privé-buckets (productfoto's en productdocumenten),
// aangemaakt door de infrastructuurcode in infra/ met Block Public Access, versioning
// en encryptie. De app krijgt toegang via de IAM-rol van de ECS-taak; er staan nooit
// toegangssleutels in de code of in env-vars op AWS. De browser krijgt alleen
// kortlevende presigned URL's voor precies één object.
//
// S3_ENDPOINT/S3_FORCE_PATH_STYLE zijn alleen bedoeld voor lokaal ontwikkelen tegen een
// S3-compatibele opslag (bijv. MinIO) en voor het eenmalig kopiëren van bestaande
// bestanden; op AWS leeg laten.
function readConfig() {
  return {
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null,
    imagesBucket: process.env.S3_IMAGES_BUCKET || null,
    documentsBucket: process.env.S3_DOCUMENTS_BUCKET || null,
    endpoint: process.env.S3_ENDPOINT || null,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
  };
}

function isStorageConfigured() {
  const config = readConfig();
  return Boolean(config.region && config.imagesBucket && config.documentsBucket);
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
