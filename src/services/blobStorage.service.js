const crypto = require("crypto");
const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const {
  isBlobStorageConfigured,
  ACCOUNT_NAME,
  IMAGES_CONTAINER,
  DOCUMENTS_CONTAINER
} = require("../config/storage");
const { HttpError } = require("../middleware/errorHandler");

const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

const NOT_CONFIGURED_MESSAGE =
  "Foto-opslag is niet geconfigureerd. Zet AZURE_STORAGE_ACCOUNT_NAME (zie README.md).";

// DefaultAzureCredential gebruikt in Azure App Service automatisch de system-assigned
// Managed Identity - er staat nergens een secret in code of .env. Lokaal valt dit terug
// op bijv. `az login` (Azure CLI-credential) of AZURE_CLIENT_ID/SECRET/TENANT_ID
// (Environment-credential); zie README.md voor de benodigde RBAC-rollen.
let credential;
let blobServiceClient;

function getBlobServiceClient() {
  if (!isBlobStorageConfigured()) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE);
  }

  if (!blobServiceClient) {
    credential = credential || new DefaultAzureCredential();
    blobServiceClient = new BlobServiceClient(
      `https://${ACCOUNT_NAME}.blob.core.windows.net`,
      credential
    );
  }

  return blobServiceClient;
}

const containerClientPromises = new Map();

function getContainerClient(containerName) {
  if (!containerClientPromises.has(containerName)) {
    const promise = (async () => {
      const containerClient = getBlobServiceClient().getContainerClient(containerName);
      try {
        // Geen `access`-optie: de container blijft prive (geen anonieme toegang). Bestaat
        // hij al (bijv. handmatig aangemaakt in de Portal), dan verandert dit niets aan
        // het huidige toegangsniveau.
        await containerClient.createIfNotExists();
      } catch (err) {
        throw new HttpError(
          502,
          `Kon geen verbinding maken met Azure Blob Storage-container "${containerName}". ` +
            "Controleer AZURE_STORAGE_ACCOUNT_NAME en of de Managed Identity de rol " +
            "'Storage Blob Data Contributor' heeft op het storage account."
        );
      }
      return containerClient;
    })().catch((err) => {
      containerClientPromises.delete(containerName);
      throw err;
    });
    containerClientPromises.set(containerName, promise);
  }

  return containerClientPromises.get(containerName);
}

async function uploadBlob({ containerName, buffer, mimeType, extension }) {
  const containerClient = await getContainerClient(containerName);
  const blobName = `${crypto.randomUUID()}.${extension}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType }
  });

  return blobName;
}

async function uploadProductPhoto({ buffer, mimeType }) {
  const extension = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan.");
  }

  return uploadBlob({ containerName: IMAGES_CONTAINER, buffer, mimeType, extension });
}

// De containers zijn prive en de Managed Identity heeft alleen 'Storage Blob Data
// Contributor' (geen 'Storage Blob Delegator', dus geen user-delegation SAS mogelijk).
// Downloaden gaat daarom via de server: de app haalt de blob zelf op met zijn eigen
// identiteit en streamt de bytes door naar de aanvrager. Er verlaat nooit een
// storage-accountkey of SAS-token de server.
async function downloadBlob({ containerName, blobName }) {
  const containerClient = await getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  let downloadResponse;
  try {
    downloadResponse = await blockBlobClient.download();
  } catch (err) {
    if (err.statusCode === 404) {
      throw new HttpError(404, "Bestand niet gevonden");
    }
    throw new HttpError(502, "Kon de afbeelding niet ophalen uit Azure Blob Storage.");
  }

  return {
    stream: downloadResponse.readableStreamBody,
    contentType: downloadResponse.contentType,
    contentLength: downloadResponse.contentLength
  };
}

async function downloadProductPhoto(blobName) {
  return downloadBlob({ containerName: IMAGES_CONTAINER, blobName });
}

module.exports = {
  uploadProductPhoto,
  downloadProductPhoto,
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGES_CONTAINER,
  DOCUMENTS_CONTAINER
};
