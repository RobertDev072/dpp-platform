// Definitie van de velden die via Excel/CSV geïmporteerd kunnen worden. Gedeeld door
// de browser (automatische kolomherkenning, voorvertoning) en de server (de
// gezaghebbende validatie). Geen Node-afhankelijkheden: dit bestand draait ook in de
// browser.

// Aliassen worden genormaliseerd vergeleken (kleine letters, alleen a-z/0-9), dus
// "Recycled %", "recycled_material_percentage" en "Gerecycled materiaal (%)" vallen
// allemaal samen met hun eigen alias.
const IMPORT_FIELDS = [
  {
    key: "name",
    label: "Productnaam",
    required: true,
    type: "text",
    max: 200,
    aliases: ["product_name", "productnaam", "naam", "name", "product", "omschrijving kort", "titel", "title"]
  },
  {
    key: "sku",
    label: "SKU",
    type: "text",
    max: 100,
    aliases: ["sku", "artikelnummer", "artikelnr", "art nr", "productnummer", "productnr", "item number", "itemnumber", "article number"]
  },
  {
    key: "gtin",
    label: "GTIN / EAN",
    type: "gtin",
    max: 50,
    aliases: ["gtin", "ean", "ean13", "ean code", "barcode", "upc", "gtin13", "gtin14"]
  },
  { key: "brand", label: "Merk", type: "text", max: 150, aliases: ["brand", "merk", "merknaam"] },
  {
    key: "manufacturer",
    label: "Fabrikant",
    type: "text",
    max: 200,
    aliases: ["manufacturer", "fabrikant", "producent", "producer", "leverancier", "maker"]
  },
  { key: "model", label: "Model", type: "text", max: 150, aliases: ["model", "type", "modelnummer", "uitvoering"] },
  {
    key: "category",
    label: "Categorie",
    type: "text",
    max: 100,
    aliases: ["category", "categorie", "productcategorie", "product type", "producttype", "productgroep", "groep"]
  },
  {
    key: "countryOfOrigin",
    label: "Land van oorsprong",
    type: "text",
    max: 100,
    aliases: ["country_of_origin", "land", "land van oorsprong", "herkomst", "country", "origin", "made in"]
  },
  {
    key: "description",
    label: "Omschrijving",
    type: "text",
    max: 5000,
    aliases: ["description", "omschrijving", "beschrijving", "productomschrijving"]
  },
  {
    key: "material",
    label: "Materiaal",
    type: "text",
    max: 200,
    aliases: ["material", "materiaal", "materialen", "materials", "grondstof"]
  },
  {
    key: "recycledMaterialPct",
    label: "Gerecycled materiaal (%)",
    type: "percent",
    aliases: ["recycled_material_percentage", "recycled", "recycled %", "gerecycled", "gerecycled materiaal", "gerecycled %", "recycled content"]
  },
  {
    key: "co2FootprintKg",
    label: "CO₂-voetafdruk (kg)",
    type: "number",
    aliases: ["carbon_footprint_kg", "co2", "co2 kg", "co2 voetafdruk", "co2footprint", "carbon footprint", "co2 uitstoot"]
  },
  { key: "recyclable", label: "Recyclebaar", type: "boolean", aliases: ["recyclable", "recyclebaar", "recyclable ja nee"] },
  { key: "reachConform", label: "REACH-conform", type: "boolean", aliases: ["reach_compliant", "reach", "reach conform"] },
  { key: "rohsConform", label: "RoHS-conform", type: "boolean", aliases: ["rohs_compliant", "rohs", "rohs conform"] },
  { key: "ceMarked", label: "CE-markering", type: "boolean", aliases: ["ce_marked", "ce", "ce markering", "ce mark"] }
];

const SUSTAINABILITY_KEYS = ["material", "recycledMaterialPct", "co2FootprintKg", "recyclable", "reachConform", "rohsConform"];
const COMPLIANCE_KEYS = ["ceMarked"];

// Kolomvolgorde van het downloadbare template (snake_case, zoals in de brief).
const TEMPLATE_COLUMNS = [
  { header: "product_name", field: "name", example: "Hoekbank Oslo", help: "Verplicht. Naam van het product." },
  { header: "sku", field: "sku", example: "HB-OSLO-01", help: "Eigen artikelnummer; gebruikt om bestaande producten te herkennen." },
  { header: "gtin", field: "gtin", example: "8712345678906", help: "GTIN/EAN (8, 12, 13 of 14 cijfers)." },
  { header: "brand", field: "brand", example: "VeriPasso Home", help: "Merk." },
  { header: "manufacturer", field: "manufacturer", example: "Meubelfabriek BV", help: "Fabrikant." },
  { header: "category", field: "category", example: "Banken", help: "Categorie (vrije tekst)." },
  { header: "country_of_origin", field: "countryOfOrigin", example: "Nederland", help: "Land van oorsprong." },
  { header: "material", field: "material", example: "Eikenhout", help: "Hoofdmateriaal." },
  { header: "recycled_material_percentage", field: "recycledMaterialPct", example: 35, help: "0 t/m 100." },
  { header: "carbon_footprint_kg", field: "co2FootprintKg", example: 42.5, help: "CO₂-voetafdruk in kg (0 of meer)." },
  { header: "recyclable", field: "recyclable", example: "ja", help: "ja / nee" },
  { header: "reach_compliant", field: "reachConform", example: "ja", help: "ja / nee" },
  { header: "rohs_compliant", field: "rohsConform", example: "nee", help: "ja / nee" },
  { header: "ce_marked", field: "ceMarked", example: "ja", help: "ja / nee" },
  { header: "description", field: "description", example: "Vierzitsbank met afneembare hoezen.", help: "Omschrijving (optioneel)." }
];

const MAX_ROWS_PER_REQUEST = 250;
const MAX_ROWS_PER_IMPORT = 20000;

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const ALIAS_INDEX = new Map();
for (const field of IMPORT_FIELDS) {
  for (const alias of [field.key, field.label, ...field.aliases]) {
    const normalized = normalizeHeader(alias);
    if (normalized && !ALIAS_INDEX.has(normalized)) ALIAS_INDEX.set(normalized, field.key);
  }
}

// Stelt per kolomkop een veld voor. Elk veld wordt hooguit één keer gekoppeld
// (de eerste kolom wint), zodat er nooit stil twee kolommen in één veld belanden.
function suggestMapping(headers) {
  const used = new Set();
  return headers.map((header) => {
    const key = ALIAS_INDEX.get(normalizeHeader(header));
    if (key && !used.has(key)) {
      used.add(key);
      return key;
    }
    return null;
  });
}

const TRUE_VALUES = new Set(["ja", "j", "yes", "y", "true", "waar", "1", "x", "✓", "v"]);
const FALSE_VALUES = new Set(["nee", "n", "no", "false", "onwaar", "0", "-"]);

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value).trim().replace(/\s/g, "").replace("%", "");
  // Nederlandse notatie: 1.234,5 → 1234.5; Engelse 1,234.5 → 1234.5
  let normalized = text;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+(,\d+)$/.test(text)) normalized = text.replace(",", ".");
  else normalized = text.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

// GS1-controlecijfer.
function isValidGtin(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1));
}

// Zet één ruwe rij ({ veld: waarde }) om naar een schone rij + fouten/waarschuwingen.
// Fouten blokkeren de rij; waarschuwingen niet.
function normalizeRow(raw) {
  const values = {};
  const errors = [];
  const warnings = [];

  for (const field of IMPORT_FIELDS) {
    const input = raw[field.key];
    if (isEmpty(input)) {
      if (field.required) {
        errors.push({ field: field.key, error: `${field.label} is verplicht`, suggestion: `Vul een ${field.label.toLowerCase()} in` });
      }
      continue;
    }

    if (field.type === "text") {
      const text = String(input).trim();
      if (text.length > field.max) {
        errors.push({ field: field.key, error: `${field.label} is te lang (${text.length} > ${field.max} tekens)`, suggestion: "Kort de tekst in" });
        continue;
      }
      values[field.key] = text;
    } else if (field.type === "gtin") {
      const digits = String(typeof input === "number" ? Math.round(input) : input).replace(/[\s-]/g, "");
      if (!/^\d+$/.test(digits)) {
        errors.push({ field: field.key, error: "GTIN mag alleen cijfers bevatten", suggestion: "Controleer de EAN/GTIN-kolom" });
        continue;
      }
      if (!isValidGtin(digits)) {
        warnings.push({ field: field.key, error: "GTIN heeft geen geldig formaat of controlecijfer", suggestion: "Controleer de code (8, 12, 13 of 14 cijfers)" });
      }
      values[field.key] = digits;
    } else if (field.type === "number" || field.type === "percent") {
      const number = parseNumber(input);
      if (Number.isNaN(number)) {
        errors.push({ field: field.key, error: `${field.label} is geen getal ("${input}")`, suggestion: "Gebruik bijv. 12,5 of 12.5" });
        continue;
      }
      if (number < 0 || (field.type === "percent" && number > 100)) {
        errors.push({ field: field.key, error: `${field.label} moet ${field.type === "percent" ? "tussen 0 en 100" : "0 of hoger"} zijn`, suggestion: "Controleer de waarde" });
        continue;
      }
      values[field.key] = Math.round(number * 100) / 100;
    } else if (field.type === "boolean") {
      const text = String(input).trim().toLowerCase();
      if (typeof input === "boolean") values[field.key] = input;
      else if (TRUE_VALUES.has(text)) values[field.key] = true;
      else if (FALSE_VALUES.has(text)) values[field.key] = false;
      else {
        errors.push({ field: field.key, error: `${field.label}: onbekende waarde "${input}"`, suggestion: "Gebruik ja of nee" });
      }
    }
  }

  return { values, errors, warnings };
}

module.exports = {
  IMPORT_FIELDS,
  SUSTAINABILITY_KEYS,
  COMPLIANCE_KEYS,
  TEMPLATE_COLUMNS,
  MAX_ROWS_PER_REQUEST,
  MAX_ROWS_PER_IMPORT,
  normalizeHeader,
  suggestMapping,
  normalizeRow,
  isValidGtin
};
