// Identificatie van de marktdeelnemer (economic operator) en controle per schema.
// LEI: ISO 17442 (20 tekens, ISO 7064 mod 97-10). GLN: GS1 (13 cijfers, mod 10).
// EORI: landcode + max. 15 tekens. Btw (VAT): landcode + 2–13 tekens. KvK: 8 cijfers.
// DUNS: 9 cijfers. "other": vrije tekst (de klant is verantwoordelijk voor de juistheid).

const SCHEMES = ["lei", "gln", "eori", "vat", "duns", "kvk", "other"];

function leiChecksumOk(lei) {
  const digits = lei.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

function glnChecksumOk(gln) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(gln[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(gln[12]);
}

function normalize(scheme, value) {
  const raw = String(value ?? "").trim();
  if (scheme === "other") return raw;
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

// Geeft null (geldig) of een Nederlandse foutmelding terug.
function validateOperatorId(scheme, value) {
  if (!SCHEMES.includes(scheme)) return "Kies een identificatieschema";
  const v = normalize(scheme, value);
  if (!v) return "Vul de identificatie in";
  switch (scheme) {
    case "lei":
      return /^[A-Z0-9]{18}[0-9]{2}$/.test(v) && leiChecksumOk(v) ? null : "Ongeldige LEI (20 tekens, controlecijfers kloppen niet)";
    case "gln":
      return /^\d{13}$/.test(v) && glnChecksumOk(v) ? null : "Ongeldige GLN (13 cijfers met controlecijfer)";
    case "eori":
      return /^[A-Z]{2}[A-Z0-9]{1,15}$/.test(v) ? null : "Ongeldig EORI-nummer (landcode + max. 15 tekens)";
    case "vat":
      return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v) ? null : "Ongeldig btw-nummer (landcode + nummer, bijv. NL123456789B01)";
    case "duns":
      return /^\d{9}$/.test(v) ? null : "Ongeldig DUNS-nummer (9 cijfers)";
    case "kvk":
      return /^\d{8}$/.test(v) ? null : "Ongeldig KvK-nummer (8 cijfers)";
    default:
      return v.length <= 100 ? null : "Maximaal 100 tekens";
  }
}

module.exports = { SCHEMES, validateOperatorId, normalizeOperatorId: normalize };
