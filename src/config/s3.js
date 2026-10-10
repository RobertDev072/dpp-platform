const { S3Client } = require("@aws-sdk/client-s3");

// Bestandsopslag op AWS S3 (STORAGE_PROVIDER=s3). Er staan bewust geen access keys in
// de configuratie: op EC2 haalt de SDK tijdelijke credentials op via de instance-rol
// (IMDSv2), lokaal via het AWS-profiel. Alleen regio en bucketnamen zijn nodig.
const REQUIRED_VARS = ["AWS_REGION", "S3_IMAGES_BUCKET", "S3_DOCUMENTS_BUCKET"];

function missingVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name]);
}

function isS3Configured() {
  return missingVars().length === 0;
}

let client;

function getS3Client() {
  if (!isS3Configured()) {
    throw new Error(`S3 is niet geconfigureerd. Ontbrekende env vars: ${missingVars().join(", ")}`);
  }
  if (!client) {
    client = new S3Client({ region: process.env.AWS_REGION });
  }
  return client;
}

function getS3ConfigDiagnostics() {
  return {
    configured: isS3Configured(),
    missingVars: missingVars(),
    region: process.env.AWS_REGION || null,
    imagesBucket: process.env.S3_IMAGES_BUCKET || null,
    documentsBucket: process.env.S3_DOCUMENTS_BUCKET || null
  };
}

module.exports = { isS3Configured, getS3Client, getS3ConfigDiagnostics };
