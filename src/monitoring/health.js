// Lichtgewicht healthchecks voor de essentiële onderdelen. Elke check is bewust
// klein (SELECT 1, container-exists, configuratie-aanwezigheid) en het geheel
// wordt 30s gecachet zodat auto-refresh op het dashboard nooit load veroorzaakt.

const { getPool } = require("../config/db");
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
    const ms = await timed(async () => {
      const pool = await getPool();
      await pool.request().query("SELECT 1 AS ok");
    });
    noteResult("database", true);
    return { status: statusFromLatency(ms), latencyMs: ms };
  } catch (error) {
    noteResult("database", false, error.message);
    return { status: "down", latencyMs: null };
  }
}

async function checkBlobStorage() {
  const { isBlobStorageConfigured, ACCOUNT_NAME } = require("../config/storage");
  if (!isBlobStorageConfigured()) {
    return { status: "not_configured", latencyMs: null };
  }
  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const { DefaultAzureCredential } = require("@azure/identity");
    const { IMAGES_CONTAINER } = require("../services/blobStorage.service");
    const client = new BlobServiceClient(`https://${ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
    const ms = await timed(() => client.getContainerClient(IMAGES_CONTAINER).exists());
    noteResult("blob", true);
    return { status: statusFromLatency(ms), latencyMs: ms };
  } catch (error) {
    noteResult("blob", false, error.message);
    return { status: "down", latencyMs: null };
  }
}

function checkEntra() {
  // Configuratiecheck (geen live Graph-call bij elke refresh: dat zou onnodige
  // tokens/latency kosten; echte Graph-fouten verschijnen via de foutenmonitor).
  const { isEntraConfigured, isEntraLoginConfigured } = require("../config/entra");
  return {
    graphProvisioning: { status: isEntraConfigured() ? "ok" : "not_configured", latencyMs: null },
    login: { status: isEntraLoginConfigured() ? "ok" : "not_configured", latencyMs: null }
  };
}

function checkEmail() {
  // Bewust niet geconfigureerd (besluit Platform Owner: geen SMTP). Eerlijk tonen.
  return { status: "not_configured", latencyMs: null };
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

  const [database, blob] = await Promise.all([checkDatabase(), checkBlobStorage()]);
  const entra = checkEntra();

  const components = {
    app: decorate("app", { status: "ok", latencyMs: 0 }),
    database: decorate("database", database),
    blobStorage: decorate("blob", blob),
    entraGraph: decorate("entraGraph", entra.graphProvisioning),
    authentication: decorate("authentication", entra.login),
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
