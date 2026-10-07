// Maakt de twee PRIVÉ Storage-buckets aan (of zet bestaande buckets goed), met
// grootte- en typelimieten die Supabase zelf afdwingt bij elke upload - de eerste
// verdedigingslinie naast de controles in src/services/storage.service.js.
// Idempotent: veilig om opnieuw te draaien.
require("dotenv").config();
const { getSupabaseAdmin, isSupabaseConfigured, IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../src/config/supabase");
const {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  PHOTO_MAX_BYTES,
  DOCUMENT_MAX_BYTES
} = require("../src/services/storage.service");

const BUCKETS = [
  { id: IMAGES_BUCKET, fileSizeLimit: PHOTO_MAX_BYTES, allowedMimeTypes: Object.keys(ALLOWED_IMAGE_MIME_TYPES) },
  { id: DOCUMENTS_BUCKET, fileSizeLimit: DOCUMENT_MAX_BYTES, allowedMimeTypes: Object.keys(ALLOWED_DOCUMENT_MIME_TYPES) }
];

async function main() {
  if (!isSupabaseConfigured()) {
    throw new Error("Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  const storage = getSupabaseAdmin().storage;

  for (const bucket of BUCKETS) {
    const options = {
      // NOOIT public: alle toegang loopt via de server (rechtencheck + signed URL).
      public: false,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes
    };
    const existing = await storage.getBucket(bucket.id);
    if (existing.data) {
      const { error } = await storage.updateBucket(bucket.id, options);
      if (error) throw new Error(`Bucket ${bucket.id} bijwerken mislukt: ${error.message}`);
      console.log(`✅ Bucket bijgewerkt: ${bucket.id} (privé, max ${bucket.fileSizeLimit} bytes)`);
    } else {
      const { error } = await storage.createBucket(bucket.id, options);
      if (error) throw new Error(`Bucket ${bucket.id} aanmaken mislukt: ${error.message}`);
      console.log(`✅ Bucket aangemaakt: ${bucket.id} (privé, max ${bucket.fileSizeLimit} bytes)`);
    }
  }
}

main().catch((error) => {
  console.error("❌", error.message);
  process.exit(1);
});
