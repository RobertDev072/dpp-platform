// Supabase Storage: twee privé-buckets (aangemaakt door de migratie in
// supabase/migrations). De service-role-key staat uitsluitend server-side in de
// env-vars en verlaat de server nooit; de browser krijgt alleen kortlevende
// signed URL's voor één object.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IMAGES_BUCKET = process.env.SUPABASE_STORAGE_IMAGES_BUCKET || "product-images";
const DOCUMENTS_BUCKET = process.env.SUPABASE_STORAGE_DOCUMENTS_BUCKET || "product-documents";

function isStorageConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = {
  isStorageConfigured,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  IMAGES_BUCKET,
  DOCUMENTS_BUCKET
};
