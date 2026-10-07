const { createClient } = require("@supabase/supabase-js");

// Supabase-configuratie. De service-role-key geeft volledige beheertoegang (Auth-
// admin, privé Storage-buckets) en staat dus uitsluitend server-side: als Vercel
// Environment Variable, nooit met een NEXT_PUBLIC_-prefix en nooit in de browser.
const REQUIRED_VARS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

const IMAGES_BUCKET = process.env.SUPABASE_STORAGE_IMAGES_BUCKET || "product-images";
const DOCUMENTS_BUCKET = process.env.SUPABASE_STORAGE_DOCUMENTS_BUCKET || "product-documents";

function missingVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name]);
}

function isSupabaseConfigured() {
  return missingVars().length === 0;
}

let adminClient;

// Eén admin-client per instance; geen sessie-opslag (server-side, stateless).
function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    throw new Error(`Supabase is niet geconfigureerd. Ontbrekende env vars: ${missingVars().join(", ")}`);
  }
  if (!adminClient) {
    adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return adminClient;
}

// Losse, wegwerpbare client voor wachtwoordverificatie (signInWithPassword) en de
// wachtwoord-vergeten-flow: die mogen nooit de admin-client "inloggen" als een
// gebruiker. Gebruikt de anon-key als die gezet is, anders de service-role-key
// (beide werken voor deze publieke Auth-endpoints).
function createEphemeralAuthClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(`Supabase is niet geconfigureerd. Ontbrekende env vars: ${missingVars().join(", ")}`);
  }
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

// Voor het config-diagnose-endpoint: alleen niet-geheime waarden; keys alleen als
// aanwezig/afwezig.
function getSupabaseConfigDiagnostics() {
  return {
    configured: isSupabaseConfigured(),
    missingVars: missingVars(),
    url: process.env.SUPABASE_URL || null,
    serviceRoleKeySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anonKeySet: Boolean(process.env.SUPABASE_ANON_KEY),
    imagesBucket: IMAGES_BUCKET,
    documentsBucket: DOCUMENTS_BUCKET,
    databaseUrlSet: Boolean(process.env.DATABASE_URL)
  };
}

module.exports = {
  isSupabaseConfigured,
  getSupabaseAdmin,
  createEphemeralAuthClient,
  getSupabaseConfigDiagnostics,
  IMAGES_BUCKET,
  DOCUMENTS_BUCKET
};
