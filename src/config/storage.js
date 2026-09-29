function isBlobStorageConfigured() {
  return Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING);
}

module.exports = { isBlobStorageConfigured };
