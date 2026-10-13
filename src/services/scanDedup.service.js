const crypto = require("crypto");

// Eén scan per apparaat per paspoort per 30 minuten (zelfde regel als een "sessie" in
// webstatistieken). Refreshen, terugnavigeren of een nieuw tabblad telt dus niet
// opnieuw; een ander apparaat, of hetzelfde apparaat na 30 minuten, wel.
//
// Privacy: er wordt geen IP-adres bewaard. De sleutel is een HMAC van IP + user-agent +
// paspoort met een willekeurig geheim dat elke dag wisselt en alleen in het geheugen
// staat; na een dag (of een herstart) is een sleutel niet meer terug te rekenen.
//
// Dit is het vangnet op de server. De browser (ScanBeacon) en de Cloudflare Worker
// passen dezelfde regel al eerder toe.

const WINDOW_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 200_000; // ±20 MB; daarboven worden de oudste vergeten

let salt = { day: null, key: null };
const seen = new Map(); // sleutel -> tijdstip laatst geteld (insertievolgorde = oudste eerst)

function dailyKey(now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (salt.day !== day) salt = { day, key: crypto.randomBytes(32) };
  return salt.key;
}

function visitorKey({ publicId, ip, userAgent }, now) {
  return crypto
    .createHmac("sha256", dailyKey(now))
    .update(`${ip || ""}|${userAgent || ""}|${String(publicId).toLowerCase()}`)
    .digest("base64url");
}

function prune(now) {
  for (const [key, ts] of seen) {
    if (now - ts < WINDOW_MS && seen.size <= MAX_ENTRIES) break;
    seen.delete(key);
  }
}

// true = deze scan telt; false = zelfde apparaat en paspoort binnen 30 minuten.
function shouldCount(input, now = Date.now()) {
  const key = visitorKey(input, now);
  const last = seen.get(key);
  if (last != null && now - last < WINDOW_MS) return false;
  seen.delete(key); // opnieuw invoegen = achteraan in de volgorde
  seen.set(key, now);
  if (seen.size > MAX_ENTRIES || seen.size % 1000 === 0) prune(now);
  return true;
}

function resetForTests() {
  seen.clear();
  salt = { day: null, key: null };
}

module.exports = { shouldCount, WINDOW_MS, resetForTests };
