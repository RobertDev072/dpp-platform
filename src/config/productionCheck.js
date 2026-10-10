// Fail loud, niet stil: in productie mag de API nooit draaien met een halve
// configuratie (bijv. zonder Supabase Auth zou login stil terugvallen op de lokale
// bcrypt-modus, zonder COOKIE_SECRET zijn tokens niet veilig te ondertekenen).
// Vervangt de opstartcheck uit het oude server.js: op Vercel is er geen "opstart",
// dus de check draait per request (resultaat gecachet per instance).
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "COOKIE_SECRET",
  "APP_BASE_URL",
  "QR_BASE_URL",
  "CRON_SECRET"
];

// Bestanden op AWS S3 i.p.v. Supabase Storage (Supabase blijft dan alleen voor Auth).
const REQUIRED_FOR_S3 = ["AWS_REGION", "S3_IMAGES_BUCKET", "S3_DOCUMENTS_BUCKET"];

function requiredVars() {
  return (process.env.STORAGE_PROVIDER || "").toLowerCase() === "s3"
    ? [...REQUIRED_IN_PRODUCTION, ...REQUIRED_FOR_S3]
    : REQUIRED_IN_PRODUCTION;
}

let cached;

function isProduction() {
  // Op Vercel: alleen de productie-deployment, niet previews/development.
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production" && process.env.ALLOW_INCOMPLETE_CONFIG !== "true";
}

// Geeft null terug als alles in orde is, anders een (niet-geheime) foutmelding.
function assertProductionConfig() {
  if (cached !== undefined) return cached;
  if (!isProduction()) {
    cached = null;
    return cached;
  }
  const missing = requiredVars().filter((name) => !process.env[name]);
  cached = missing.length
    ? `Ontbrekende environment variables in productie: ${missing.join(", ")}. Zie README.md.`
    : null;
  if (cached) console.error(`❌ ${cached}`);
  return cached;
}

module.exports = { assertProductionConfig, REQUIRED_IN_PRODUCTION };
