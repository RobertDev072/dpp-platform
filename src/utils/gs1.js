// GS1-identificatie: GTIN-controle en GS1 Digital Link-URI's (GS1 Digital Link 1.x).
// Een Digital Link is een gewone web-URL met de GTIN en optioneel het lotnummer (AI 10)
// en serienummer (AI 21), bijv. https://id.gs1.org/01/08712345678906/10/L42/21/S1.
//
// - canonical: onder id.gs1.org, de door GS1 aanbevolen vorm voor identificatie.
// - resolvable: onder ons eigen QR-domein, zodat dezelfde link direct het paspoort opent
//   (de resolver-route in src/routes/gs1Resolver.routes.js).

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function normalizeGtin(value) {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return null;
  return digits.padStart(14, "0");
}

// Modulo-10-controlecijfer (GS1 General Specifications §7.9).
function isValidGtin(value) {
  const gtin = normalizeGtin(value);
  if (!gtin) return false;
  let sum = 0;
  for (let i = 0; i < 13; i += 1) sum += Number(gtin[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(gtin[13]);
}

// AI 10 en 21: maximaal 20 tekens uit GS1 "character set 82".
const AI_VALUE = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]{1,20}$/;

function isValidAiValue(value) {
  return AI_VALUE.test(String(value ?? ""));
}

function encodeAi(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function digitalLinkPath({ gtin, lot = null, serial = null }) {
  const normalized = normalizeGtin(gtin);
  if (!normalized || !isValidGtin(normalized)) return null;
  let path = `/01/${normalized}`;
  if (lot && isValidAiValue(lot)) path += `/10/${encodeAi(lot)}`;
  if (serial && isValidAiValue(serial)) path += `/21/${encodeAi(serial)}`;
  return path;
}

function digitalLink(parts, base = "https://id.gs1.org") {
  const path = digitalLinkPath(parts);
  return path ? `${base}${path}` : null;
}

module.exports = { normalizeGtin, isValidGtin, isValidAiValue, digitalLinkPath, digitalLink };
