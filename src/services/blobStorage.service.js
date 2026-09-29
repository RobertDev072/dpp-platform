const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");
const { isBlobStorageConfigured } = require("../config/storage");
const { HttpError } = require("../middleware/errorHandler");

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || "product-images";

const ALLOWED_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

let containerClientPromise;

function getContainerClient() {
  if (!isBlobStorageConfigured()) {
    throw new HttpError(
      503,
      "Foto-upload is niet geconfigureerd. Zet AZURE_STORAGE_CONNECTION_STRING (zie README.md)."
    );
  }

  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const serviceClient = BlobServiceClient.fromConnectionString(
        process.env.AZURE_STORAGE_CONNECTION_STRING
      );
      const containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
      try {
        // Productfoto's horen bij het publieke DPP-paspoort (zonder login zichtbaar via
        // de QR-code), dus de container staat op publieke lees-toegang per blob.
        await containerClient.createIfNotExists({ access: "blob" });
      } catch (err) {
        throw new HttpError(
          502,
          "Kon geen verbinding maken met Azure Blob Storage, of 'Allow Blob public access' staat " +
            "uit op het storage account. Zet dat aan in de Azure Portal onder Configuration.",
          undefined,
          undefined
        );
      }
      return containerClient;
    })().catch((err) => {
      containerClientPromise = undefined;
      throw err;
    });
  }

  return containerClientPromise;
}

async function uploadProductPhoto({ buffer, mimeType }) {
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) {
    throw new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan.");
  }

  const containerClient = await getContainerClient();
  const blobName = `${crypto.randomUUID()}.${extension}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType }
  });

  return blockBlobClient.url;
}

module.exports = { uploadProductPhoto, ALLOWED_MIME_TYPES, isBlobStorageConfigured };
