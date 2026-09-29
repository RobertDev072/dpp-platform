const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const IMAGES_CONTAINER = process.env.AZURE_STORAGE_IMAGES_CONTAINER || "product-images";
const DOCUMENTS_CONTAINER = process.env.AZURE_STORAGE_DOCUMENTS_CONTAINER || "product-documents";

function isBlobStorageConfigured() {
  return Boolean(ACCOUNT_NAME);
}

module.exports = {
  isBlobStorageConfigured,
  ACCOUNT_NAME,
  IMAGES_CONTAINER,
  DOCUMENTS_CONTAINER
};
