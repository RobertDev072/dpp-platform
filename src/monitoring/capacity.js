// Capaciteit en continuïteit van de server: loopt er iets vol of dreigt er iets te
// verlopen? Bedoeld voor één Linux-server met Docker (docs/hosting-strato.md), maar
// elke meting die niet kan (lokaal, andere hosting) geeft gewoon "onbekend".
//
//   schijf       vrije ruimte van het bestandssysteem (in de container = die van de host)
//   geheugen     MemAvailable uit /proc/meminfo (in de container = die van de host)
//   back-up      statusbestand dat deploy/backup.sh na elke back-up schrijft
//   certificaten geldigheid van de HTTPS-certificaten (TLS-verbinding met Caddy)
//   R2-opslag    gebruikte opslag t.o.v. de gratis 10 GB van Cloudflare R2
//
// Niveaus: ok | warn | crit | unknown. Drempels in src/config/monitoring.js.

const fs = require("fs");
const os = require("os");
const tls = require("tls");
const { THRESHOLDS } = require("../config/monitoring");

const CACHE_MS = 60 * 1000;
const CERT_CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null;
let certCache = null;

function levelFor(value, { warn, crit }, higherIsWorse = true) {
  if (value == null || Number.isNaN(value)) return "unknown";
  if (higherIsWorse) return value >= crit ? "crit" : value >= warn ? "warn" : "ok";
  return value <= crit ? "crit" : value <= warn ? "warn" : "ok";
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function checkDisk(path = process.env.DISK_CHECK_PATH || "/") {
  try {
    const s = fs.statfsSync(path);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const usedPct = total ? round1(((total - free) / total) * 100) : null;
    return { level: levelFor(usedPct, THRESHOLDS.diskUsedPct), totalBytes: total, freeBytes: free, usedPct };
  } catch (error) {
    return { level: "unknown", reason: error.message };
  }
}

function checkMemory() {
  let total = os.totalmem();
  let available = os.freemem();
  try {
    const info = fs.readFileSync("/proc/meminfo", "utf8");
    const value = (key) => {
      const m = new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(info);
      return m ? Number(m[1]) * 1024 : null;
    };
    total = value("MemTotal") ?? total;
    available = value("MemAvailable") ?? available;
  } catch {
    // geen Linux: os.freemem() is een redelijke benadering
  }
  const usedPct = total ? round1(((total - available) / total) * 100) : null;
  return { level: levelFor(usedPct, THRESHOLDS.serverMemoryPct), totalBytes: total, availableBytes: available, usedPct };
}

function checkBackup(file = process.env.BACKUP_STATUS_FILE) {
  if (!file) return { level: "unknown", reason: "BACKUP_STATUS_FILE niet ingesteld" };
  try {
    const status = JSON.parse(fs.readFileSync(file, "utf8"));
    const at = new Date(status.at);
    const ageHours = round1((Date.now() - at.getTime()) / 3600000);
    let level = levelFor(ageHours, THRESHOLDS.backupAgeHours);
    // Een back-up die alleen op de server staat, beschermt niet tegen verlies van de server.
    if (level === "ok" && status.offsite === false) level = "warn";
    return {
      level,
      at: at.toISOString(),
      ageHours,
      sizeBytes: Number(status.bytes) || null,
      offsite: status.offsite === true,
      offsiteTarget: status.offsiteTarget || null,
      offsiteTotalBytes: Number(status.offsiteTotalBytes) || null
    };
  } catch (error) {
    return { level: "crit", reason: error.code === "ENOENT" ? "nog geen back-up gevonden" : error.message };
  }
}

function certificateExpiry(host, servername, port = 443) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && cert.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function checkCertificates() {
  const domains = String(process.env.DOMAINS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const host = process.env.CERT_CHECK_HOST;
  if (!host || !domains.length) return { level: "unknown", reason: "CERT_CHECK_HOST/DOMAINS niet ingesteld", domains: [] };
  if (certCache && Date.now() - certCache.at < CERT_CACHE_MS) return certCache.value;

  const results = await Promise.all(
    domains.map(async (domain) => {
      const expires = await certificateExpiry(host, domain);
      const daysLeft = expires ? Math.floor((expires.getTime() - Date.now()) / 86400000) : null;
      return {
        domain,
        expiresAt: expires ? expires.toISOString() : null,
        daysLeft,
        level: expires ? levelFor(daysLeft, THRESHOLDS.certDaysLeft, false) : "crit"
      };
    })
  );
  const order = { ok: 0, unknown: 1, warn: 2, crit: 3 };
  const level = results.reduce((worst, r) => (order[r.level] > order[worst] ? r.level : worst), "ok");
  const minDays = results.reduce((min, r) => (r.daysLeft != null && (min == null || r.daysLeft < min) ? r.daysLeft : min), null);
  const value = { level, minDaysLeft: minDays, domains: results };
  certCache = { at: Date.now(), value };
  return value;
}

// R2: bestanden (laatste dagelijkse meting) + back-ups (door backup.sh gemeten).
async function checkObjectStorage(backup) {
  const freeTierBytes = Number(process.env.OBJECT_STORAGE_FREE_BYTES) || 10 * 1024 ** 3;
  let filesBytes = null;
  let measuredAt = null;
  try {
    const { getLatestSnapshot } = require("./collectors");
    const snapshot = await getLatestSnapshot();
    if (snapshot && snapshot.blob_storage_bytes != null) {
      filesBytes = Number(snapshot.blob_storage_bytes);
      measuredAt = snapshot.taken_at || null;
    }
  } catch {
    // zonder database geen meting
  }
  const backupsBytes = backup?.offsiteTotalBytes ?? null;
  if (filesBytes == null && backupsBytes == null) return { level: "unknown", freeTierBytes, reason: "nog niet gemeten" };
  const usedBytes = (filesBytes || 0) + (backupsBytes || 0);
  const usedPct = round1((usedBytes / freeTierBytes) * 100);
  return {
    level: levelFor(usedPct, THRESHOLDS.objectStorageFreeTierPct),
    usedBytes,
    filesBytes,
    backupsBytes,
    freeTierBytes,
    usedPct,
    measuredAt
  };
}

async function getCapacity({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const backup = checkBackup();
  const [certificates, objectStorage] = await Promise.all([checkCertificates(), checkObjectStorage(backup)]);
  const checks = { disk: checkDisk(), memory: checkMemory(), backup, certificates, objectStorage };
  const problems = Object.entries(checks)
    .filter(([, c]) => c.level === "warn" || c.level === "crit")
    .map(([key, c]) => ({ key, level: c.level }));
  const overall = problems.some((p) => p.level === "crit") ? "crit" : problems.length ? "warn" : "ok";
  const value = { overall, problems, checks, checkedAt: new Date().toISOString(), thresholds: pickThresholds() };
  cache = { at: Date.now(), value };
  return value;
}

function pickThresholds() {
  const { diskUsedPct, serverMemoryPct, backupAgeHours, certDaysLeft, objectStorageFreeTierPct } = THRESHOLDS;
  return { diskUsedPct, serverMemoryPct, backupAgeHours, certDaysLeft, objectStorageFreeTierPct };
}

function resetCacheForTests() {
  cache = null;
  certCache = null;
}

module.exports = { getCapacity, checkDisk, checkMemory, checkBackup, levelFor, resetCacheForTests };
