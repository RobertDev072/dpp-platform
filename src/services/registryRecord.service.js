const { getPool } = require("../config/db");
const passport = require("./passport.service");
const { productGroup } = require("../../lib/productGroups");

// Registry-adapter voor het EU DPP-register (DPP Registry User Guide for Economic Operators,
// v1.03, 2026-09-16). Het register bewaart alleen een registratierecord; de klant (de
// marktdeelnemer) registreert zelf, na verificatie met EU Login en een QSeal/QES, via het
// online formulier of een JSON/XML-bestand van max. 100 paspoorten. VeriPasso levert de
// gegevens en zorgt dat de UPI altijd naar het paspoort leidt.
//
// Per paspoort: granulariteit (model/batch/item; voor batterijen alleen item), de UPI
// (https-URL, max. 2000 tekens), en optioneel model- en batch-ID. Het officiële bestands-
// sjabloon is (nog) niet openbaar; zodra het er is, hoort alleen de bestandsopbouw hier
// bij te komen. Tot dan alleen een CSV-werklijst voor handmatige invoer (niet uploadbaar:
// het register accepteert alleen JSON of XML).

const MAX_PER_FILE = 100;
const MAX_UPI_LENGTH = 2000;
const CHECK_TIMEOUT_MS = 10000;

// Zelfde regels als het register (hoofdstuk 6.2.1): alleen letters, cijfers, punt,
// underscore en koppelteken; geen spaties, slashes of mapnavigatie.
function safeFileName(value) {
  const name = String(value || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90);
  return name || "registratie";
}

function record(product, instance, qrBaseUrl) {
  const snapshotLike = { publicId: String(product.public_id).toLowerCase(), product: { gtin: product.gtin ?? null } };
  const group = productGroup(product.product_group);
  return {
    productGroup: group.eu || null,
    granularity: instance?.granularity || "model",
    upi: passport.uniqueProductIdentifier(snapshotLike, { qrBaseUrl, instance }),
    modelIdentifier: product.model || product.sku || null,
    batchIdentifier: instance?.lotNumber || null,
    serialNumber: instance?.granularity === "item" ? instance.serialNumber || null : null,
    digitalProductPassportId: `urn:uuid:${String(instance?.publicId || product.public_id).toLowerCase()}`,
    publicId: String(instance?.publicId || product.public_id).toLowerCase()
  };
}

// Alle registratierecords van één product: het model, elke batch en elk exemplaar.
async function recordsForProduct(product, { qrBaseUrl, granularity = null } = {}) {
  const pool = await getPool();
  const out = [];
  if (!granularity || granularity === "model") out.push(record(product, null, qrBaseUrl));
  if (!granularity || granularity === "batch") {
    const batches = (await pool.query(
      "SELECT public_id, batch_number FROM dbo.productbatches WHERE product_id = $1 ORDER BY id",
      [product.id]
    )).rows;
    for (const b of batches) out.push(record(product, { granularity: "batch", publicId: String(b.public_id), lotNumber: b.batch_number }, qrBaseUrl));
  }
  if (!granularity || granularity === "item") {
    const items = (await pool.query(
      `SELECT i.public_id, i.serial_number, b.batch_number FROM dbo.productitems i
       LEFT JOIN dbo.productbatches b ON b.id = i.batch_id WHERE i.product_id = $1 ORDER BY i.id`,
      [product.id]
    )).rows;
    for (const i of items) {
      out.push(record(product, { granularity: "item", publicId: String(i.public_id), serialNumber: i.serial_number, lotNumber: i.batch_number }, qrBaseUrl));
    }
  }
  return out;
}

// Controles die het register ook doet. Eén fout keurt in het register het hele bestand
// af, dus vooraf controleren. Foutcodes (eigen namen) met de melding van het register.
function validate(records) {
  const issues = [];
  const seen = new Map();
  records.forEach((r, index) => {
    const add = (code, message) => issues.push({ index, upi: r.upi, code, message });
    let url = null;
    try {
      url = new URL(r.upi);
    } catch {
      // hieronder gemeld
    }
    if (!url || url.protocol !== "https:") add("INVALID_URL_FORMAT", "Invalid URL format. Enter a URL starting with https://.");
    else if (url.port && url.port !== "443") add("UPI_INVALID", "The UPI URL is invalid (geen afwijkende poort toegestaan).");
    if (String(r.upi).length > MAX_UPI_LENGTH) add("UPI_TOO_LONG", `De UPI is langer dan ${MAX_UPI_LENGTH} tekens.`);
    if (seen.has(r.upi)) add("DUPLICATE_UPI", "The same unique identifier has been used for more than one DPP in the same registration request.");
    else seen.set(r.upi, index);
  });
  return issues;
}

// Vooraf controleren volgens de eisen uit de handleiding: te veel doorverwijzingen of een
// doorverwijzing naar http gaan fout. Het exacte maximum noemt de handleiding niet; wij staan
// er hooguit één toe (veilig). Het eindantwoord moet 200 zijn. Het register doet zelf de
// definitieve controle.
async function checkResolvable(upi, { maxRedirects = 1 } = {}) {
  let current = upi;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!/^https:\/\//i.test(current)) return { ok: false, code: "INSECURE_REDIRECT", message: `Doorverwijzing naar een niet-https-adres: ${current}` };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html,application/json" } });
    } catch (error) {
      return { ok: false, code: "UPI_NOT_RESOLVABLE", message: `Niet bereikbaar: ${error.name === "AbortError" ? "time-out" : error.message}` };
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, code: "UPI_NOT_RESOLVABLE", message: `HTTP ${response.status} zonder Location` };
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status !== 200) return { ok: false, code: "UPI_NOT_RESOLVABLE", message: `HTTP ${response.status}` };
    return { ok: true, finalUrl: current, redirects: hop };
  }
  return { ok: false, code: "TOO_MANY_REDIRECTS", message: `Meer dan ${maxRedirects} doorverwijzing(en)` };
}

function chunk(records, size = MAX_PER_FILE) {
  const parts = [];
  for (let i = 0; i < records.length; i += size) parts.push(records.slice(i, i + size));
  return parts;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // Ook formule-injectie in spreadsheets voorkomen.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(records) {
  const header = ["productGroup", "granularity", "upi", "modelIdentifier", "batchIdentifier", "serialNumber", "digitalProductPassportId"];
  const lines = [header.join(",")];
  for (const r of records) lines.push(header.map((key) => csvCell(r[key])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

module.exports = { MAX_PER_FILE, MAX_UPI_LENGTH, safeFileName, record, recordsForProduct, validate, checkResolvable, chunk, toCsv };
