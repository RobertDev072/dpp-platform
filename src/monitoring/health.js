// Lichtgewicht healthchecks voor de essentiële onderdelen. Elke check is bewust
// klein (SELECT 1, bucket-bestaat, Auth-health-endpoint) en het geheel wordt 30s
// gecachet (per function-instance) zodat auto-refresh op het dashboard nooit load
// veroorzaakt.

const { query } = require("../config/db");
const { isSupabaseConfigured } = require("../config/supabase");
const { isStorageConfigured, pingStorage } = require("../services/storage.service");
const { THRESHOLDS } = require("../config/monitoring");
const { sanitizeErrorMessage } = require("./requestMetrics");

const lastErrors = new Map(); // component -> { message, at }
const lastSuccess = new Map(); // component -> ISO-tijdstip

let cachedResult = null;
let cachedAt = 0;
const CACHE_MS = 30000;

function noteResult(component, ok, errorMessage) {
  if (ok) {
    lastSuccess.set(component, new Date().toISOString());
  } else if (errorMessage) {
    lastErrors.set(component, { message: sanitizeErrorMessage(errorMessage), at: new Date().toISOString() });
  }
}

function statusFromLatency(ms) {
  if (ms == null) return "down";
  if (ms > THRESHOLDS.healthLatencyMs.crit) return "degraded";
  if (ms > THRESHOLDS.healthLatencyMs.warn) return "degraded";
  return "ok";
}

async function timed(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

async function checkDatabase() {
  try {
    const ms = await timed(() => query("SELECT 1 AS ok"));
    noteResult("database", true);
    return { status: statusFromLatency(ms), latencyMs: ms };
  } catch (error) {
    noteResult("database", false, error.message);
    return { status: "down", latencyMs: null };
  }
}

async function checkStorage() {
  if (!isStorageConfigured()) {
    return { status: "not_configured", latencyMs: null };
  }
  try {
    const ms = await timed(pingStorage);
    noteResult("storage", true);
    return { status: statusFromLatency(ms), latencyMs: ms };
  } catch (error) {
    noteResult("storage", false, error.message);
    return { status: "down", latencyMs: null };
  }
}

// Supabase Auth heeft een eigen, goedkoop health-endpoint.
async function checkAuthentication() {
  if (!isSupabaseConfigured()) {
    return { status: "not_configured", latencyMs: null };
  }
  try {
    const ms = await timed(async () => {
      const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/health`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`Supabase Auth health: HTTP ${response.status}`);
    });
    noteResult("authentication", true);
    return { status: statusFromLatency(ms), latencyMs: ms };
  } catch (error) {
    noteResult("authentication", false, error.message);
    return { status: "down", latencyMs: null };
  }
}

function checkEmail() {
  // E-mail (alleen de "wachtwoord vergeten"-code) verstuurt Supabase Auth via de SMTP-
  // instellingen van het Supabase-project; de app zelf verstuurt niets. Of daar een
  // eigen SMTP-server staat is vanuit de app niet te zien - eerlijk als
  // "niet geconfigureerd" tonen tenzij expliciet bevestigd via SUPABASE_SMTP_CONFIGURED.
  return { status: process.env.SUPABASE_SMTP_CONFIGURED === "true" ? "ok" : "not_configured", latencyMs: null };
}

function checkBaseUrls() {
  const ok = Boolean(process.env.APP_BASE_URL) && Boolean(process.env.QR_BASE_URL);
  return { status: ok ? "ok" : "degraded", latencyMs: null };
}

function decorate(component, result) {
  return {
    ...result,
    lastSuccess: lastSuccess.get(component) || null,
    lastError: lastErrors.get(component) || null
  };
}

async function runHealthChecks() {
  if (cachedResult && Date.now() - cachedAt < CACHE_MS) return cachedResult;

  const [database, storage, authentication] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkAuthentication()
  ]);

  const components = {
    app: decorate("app", { status: "ok", latencyMs: 0 }),
    database: decorate("database", database),
    blobStorage: decorate("storage", storage),
    authentication: decorate("authentication", authentication),
    email: decorate("email", checkEmail()),
    baseUrls: decorate("baseUrls", checkBaseUrls())
  };

  // Totaalstatus: database plat = storing; iets anders plat/traag = verminderd.
  // "not_configured" (e-mail) telt niet als probleem - dat is een bewuste keuze.
  let overall = "ok";
  if (components.database.status === "down") {
    overall = "down";
  } else {
    const relevant = Object.entries(components).filter(([name]) => name !== "email");
    if (relevant.some(([, c]) => c.status === "down" || c.status === "degraded")) {
      overall = "degraded";
    }
  }

  cachedResult = { overall, checkedAt: new Date().toISOString(), components };
  cachedAt = Date.now();
  return cachedResult;
}

module.exports = { runHealthChecks };
