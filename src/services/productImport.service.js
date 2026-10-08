const XLSX = require("xlsx");
const { unzipSync } = require("fflate");
const { HttpError } = require("../middleware/errorHandler");

// Productimport (xlsx/xls/csv): parsen, kolommen herkennen en rijen valideren. Pure
// functies zonder database; de route en de chunkverwerking gebruiken ze allebei, zodat
// validatie vooraf en verwerking achteraf exact dezelfde regels hanteren.

const MAX_IMPORT_ROWS = 10000;
const MAX_COLUMNS = 60;
const CHUNK_SIZE = 250;

// Velden waarnaar een kolom gekoppeld kan worden. `aliases` zijn genormaliseerde
// kolomkoppen (kleine letters, alleen letters/cijfers) die automatisch herkend worden.
const IMPORT_FIELDS = [
  { key: "name", label: "Productnaam", required: true, aliases: ["name", "naam", "productnaam", "product", "productname", "title", "titel", "artikelnaam", "artikelomschrijving"] },
  { key: "sku", label: "SKU", aliases: ["sku", "artikelnummer", "artikelnr", "artnr", "itemnumber", "itemno", "productcode", "articlenumber", "artikelcode", "referentie"] },
  { key: "gtin", label: "GTIN / EAN", aliases: ["gtin", "ean", "ean13", "gtin13", "gtin14", "barcode", "upc", "eancode"] },
  { key: "model", label: "Model / productnummer", aliases: ["model", "productnummer", "modelnummer", "typenummer", "modelnumber", "productnumber", "type"] },
  { key: "brand", label: "Merk", aliases: ["brand", "merk", "merknaam"] },
  { key: "manufacturer", label: "Fabrikant", aliases: ["manufacturer", "fabrikant", "producent", "producer", "maker", "leverancier"] },
  { key: "category", label: "Categorie", aliases: ["category", "categorie", "productgroep", "productcategorie", "group", "groep"] },
  { key: "country_of_origin", label: "Land van oorsprong", aliases: ["countryoforigin", "land", "landvanherkomst", "landvanoorsprong", "herkomst", "origin", "country", "herkomstland"] },
  { key: "description", label: "Omschrijving", aliases: ["description", "beschrijving", "omschrijving", "productomschrijving"] },
  { key: "material", label: "Materiaal", aliases: ["material", "materiaal", "materials", "materialen", "samenstelling"] },
  { key: "recycled_material_percentage", label: "Gerecycled materiaal %", aliases: ["recycledmaterialpercentage", "recycled", "recycledpct", "recycledpercentage", "gerecycled", "gerecycledmateriaal", "gerecycledpct", "recycledcontent"] },
  { key: "carbon_footprint_kg", label: "CO₂-voetafdruk (kg)", aliases: ["carbonfootprintkg", "carbonfootprint", "co2", "co2kg", "co2voetafdruk", "co2footprint", "co2footprintkg", "co2eq"] },
  { key: "recyclable", label: "Recyclebaar", aliases: ["recyclable", "recyclebaar", "recyclebaarja"] },
  { key: "reach_compliant", label: "REACH-conform", aliases: ["reachcompliant", "reach", "reachconform"] },
  { key: "rohs_compliant", label: "RoHS-conform", aliases: ["rohscompliant", "rohs", "rohsconform"] },
  { key: "ce_marked", label: "CE-markering", aliases: ["cemarked", "ce", "cemarkering", "cemark"] },
  { key: "regulations", label: "Regelgeving", aliases: ["regulations", "regelgeving", "applicableregulations", "normen", "standards"] },
  { key: "expected_lifespan_years", label: "Levensduur (jaren)", aliases: ["expectedlifespanyears", "lifespan", "levensduur", "levensduurjaren"] },
  { key: "photo_url", label: "Foto-URL", aliases: ["photourl", "foto", "fotourl", "afbeelding", "image", "imageurl", "afbeeldingurl"] }
];
const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((field) => [field.key, field]));

const MAX_LENGTHS = {
  name: 200,
  sku: 100,
  gtin: 50,
  model: 150,
  brand: 150,
  manufacturer: 200,
  category: 100,
  country_of_origin: 100,
  photo_url: 1000
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/₂/g, "2")
    .replace(/[^a-z0-9]/g, "");
}

// --- bestanden ---------------------------------------------------------------

function detectFileType(filename, buffer) {
  const ext = String(filename || "").toLowerCase().split(".").pop();
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isOle = buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  // Extensie én inhoud moeten kloppen: een hernoemd bestand komt er niet door.
  if (ext === "xlsx" && isZip) return "xlsx";
  if (ext === "xls" && isOle) return "xls";
  if (ext === "csv" && !isZip && !isOle && !buffer.subarray(0, 4096).includes(0)) return "csv";
  throw new HttpError(400, "Alleen .xlsx, .xls of .csv-bestanden worden ondersteund (en de inhoud moet bij de extensie passen).");
}

function decodeText(buffer) {
  let text = buffer.toString("utf8");
  // Excel bewaart CSV vaak als Windows-1252; dan levert UTF-8-decodering vervangingstekens op.
  if (text.includes("�")) {
    text = buffer.toString("latin1");
  }
  return text.replace(/^﻿/, "");
}

// RFC 4180-CSV met automatische keuze tussen ; , en tab (NL-Excel gebruikt ;).
// Alles blijft tekst: voorloopnullen in SKU's en GTIN's gaan zo nooit verloren.
function parseCsv(text) {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][1] > 0 ? counts[0][0] : ",";

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length > MAX_IMPORT_ROWS + 1) break;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellToString(value) {
  if (value == null) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Grote gehele getallen (GTIN) zonder wetenschappelijke notatie.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === "boolean") return value ? "ja" : "nee";
  return String(value);
}

// Een .xlsx is een zip: 4 MB kan uitpakken tot gigabytes (zip-bom). De centrale
// directory vermeldt de uitgepakte grootte; die lezen we zonder iets uit te pakken.
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

function assertSafeZip(buffer) {
  let total = 0;
  let entries = 0;
  try {
    unzipSync(buffer, {
      filter(file) {
        total += file.originalSize || 0;
        entries += 1;
        return false;
      }
    });
  } catch {
    throw new HttpError(400, "Het bestand kon niet worden gelezen. Controleer of het een geldig Excel-bestand is.");
  }
  if (total > MAX_UNCOMPRESSED_BYTES || entries > 1000) {
    throw new HttpError(400, "Het Excel-bestand is uitgepakt te groot om te verwerken. Splits het bestand in delen.");
  }
}

function parseSpreadsheet(buffer, fileType) {
  if (fileType === "xlsx") assertSafeZip(buffer);
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    dense: true,
    // +2: kopregel en één extra rij om "te veel rijen" te kunnen herkennen.
    sheetRows: MAX_IMPORT_ROWS + 2
  });
  const sheetName = workbook.SheetNames.find((name) => !/^instructi/i.test(name)) || workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: false });
}

// Geeft { fileType, headers, rows } met rows als arrays van strings in kolomvolgorde.
function parseImportFile(filename, buffer) {
  const fileType = detectFileType(filename, buffer);
  let table;
  try {
    table = fileType === "csv" ? parseCsv(decodeText(buffer)) : parseSpreadsheet(buffer, fileType);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Het bestand kon niet worden gelezen. Controleer of het een geldig Excel- of CSV-bestand is.");
  }

  const nonEmpty = table
    .map((row) => row.map(cellToString).map((v) => v.trim()))
    .filter((row) => row.some((v) => v !== ""));
  if (nonEmpty.length < 2) {
    throw new HttpError(400, "Het bestand bevat geen productregels. De eerste rij moet kolomnamen bevatten, daaronder één product per rij.");
  }

  const rawHeaders = nonEmpty[0].slice(0, MAX_COLUMNS);
  const headers = rawHeaders.map((header, index) => header || `Kolom ${index + 1}`);
  const rows = nonEmpty.slice(1).map((row) => headers.map((_, index) => (row[index] ?? "").slice(0, 5000)));
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      400,
      `Het bestand bevat meer dan ${MAX_IMPORT_ROWS.toLocaleString("nl-NL")} producten. Splits het bestand in delen en importeer ze na elkaar.`
    );
  }
  return { fileType, headers, rows };
}

// Automatische koppeling kolom → veld. Elk veld wordt hooguit één keer gekoppeld
// (de eerste passende kolom wint); onbekende kolommen blijven ongekoppeld (null).
function suggestMapping(headers) {
  const used = new Set();
  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    const field = IMPORT_FIELDS.find((f) => !used.has(f.key) && (f.key.replace(/_/g, "") === normalized || f.aliases.includes(normalized)));
    if (!field) return null;
    used.add(field.key);
    return field.key;
  });
}

// mapping: array (zelfde lengte als headers) met veldsleutel of null ("niet importeren").
function normalizeMapping(mapping, headers) {
  if (!Array.isArray(mapping) || mapping.length !== headers.length) {
    throw new HttpError(400, "De kolomkoppeling past niet bij het bestand.");
  }
  const seen = new Set();
  return mapping.map((key) => {
    if (key == null || key === "") return null;
    if (!FIELD_BY_KEY.has(key)) throw new HttpError(400, `Onbekend veld in de kolomkoppeling: ${key}`);
    if (seen.has(key)) {
      throw new HttpError(400, `Het veld "${FIELD_BY_KEY.get(key).label}" is aan meer dan één kolom gekoppeld.`);
    }
    seen.add(key);
    return key;
  });
}

// --- validatie ---------------------------------------------------------------

const TRUE_VALUES = new Set(["ja", "j", "yes", "y", "true", "waar", "1", "x", "✓", "v"]);
const FALSE_VALUES = new Set(["nee", "n", "no", "false", "onwaar", "0", "-"]);

function parseBoolean(value) {
  const v = value.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return undefined;
}

function parseNumber(value) {
  // NL-notatie toestaan: "1.234,5" en "12,5" → 1234.5 en 12.5; "%" en "kg" weg.
  let v = value.trim().replace(/\s|%|kg$/gi, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "");
  v = v.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return undefined;
  return Number(v);
}

function gtinChecksumValid(digits) {
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

// "Staal 80%; Hout 20%" → [{material:"Staal",pct:80},{material:"Hout",pct:20}];
// "Aluminium" → [{material:"Aluminium",pct:100}].
function parseMaterials(value) {
  const parts = value.split(/[;|\n]/).map((p) => p.trim()).filter(Boolean);
  const materials = [];
  for (const part of parts) {
    const match = part.match(/^(.*?)[\s:]*(\d+(?:[.,]\d+)?)\s*%$/);
    if (match && match[1].trim()) {
      materials.push({ material: match[1].trim().slice(0, 100), pct: Number(match[2].replace(",", ".")) });
    } else {
      materials.push({ material: part.slice(0, 100), pct: parts.length === 1 ? 100 : 0 });
    }
  }
  return materials;
}

// Valideert één rij. Geeft { values, issues } waarbij values de getypeerde waarden
// zijn (alleen ingevulde velden) en issues { field, severity, message, suggestion }.
function validateRow(row, mapping) {
  const values = {};
  const issues = [];
  const add = (field, severity, message, suggestion) =>
    issues.push({ field, severity, message, suggestion: suggestion || "" });

  mapping.forEach((key, index) => {
    if (!key) return;
    const raw = String(row[index] ?? "").trim();
    if (raw === "") return;

    const max = MAX_LENGTHS[key];
    if (max && raw.length > max) {
      add(key, "error", `Te lang (${raw.length} tekens, maximaal ${max})`, "Kort de waarde in");
      return;
    }

    switch (key) {
      case "gtin": {
        const digits = raw.replace(/[\s-]/g, "");
        if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
          add(key, "error", "Ongeldige GTIN: alleen cijfers, 8, 12, 13 of 14 lang", "Controleer de EAN/GTIN-code");
          return;
        }
        if (!gtinChecksumValid(digits)) {
          add(key, "warning", "Het controlecijfer van de GTIN klopt niet", "Controleer de laatste cijfer van de code");
        }
        values.gtin = digits;
        return;
      }
      case "recycled_material_percentage": {
        const n = parseNumber(raw);
        if (n === undefined || n < 0 || n > 100) {
          add(key, "error", "Percentage moet een getal tussen 0 en 100 zijn", "Bijv. 35 of 35%");
          return;
        }
        values[key] = n;
        return;
      }
      case "carbon_footprint_kg": {
        const n = parseNumber(raw);
        if (n === undefined || n < 0 || n >= 1e8) {
          add(key, "error", "CO₂-voetafdruk moet een getal van 0 of hoger zijn", "Bijv. 12,5");
          return;
        }
        values[key] = n;
        return;
      }
      case "expected_lifespan_years": {
        const n = parseNumber(raw);
        if (n === undefined || !Number.isInteger(n) || n <= 0 || n > 1000) {
          add(key, "error", "Levensduur moet een geheel aantal jaren zijn", "Bijv. 10");
          return;
        }
        values[key] = n;
        return;
      }
      case "recyclable":
      case "reach_compliant":
      case "rohs_compliant":
      case "ce_marked": {
        const b = parseBoolean(raw);
        if (b === undefined) {
          add(key, "error", `Onbekende waarde "${raw.slice(0, 30)}"`, "Gebruik ja of nee");
          return;
        }
        values[key] = b;
        return;
      }
      case "material": {
        const materials = parseMaterials(raw);
        const total = materials.reduce((sum, m) => sum + m.pct, 0);
        if (materials.length > 1 && Math.round(total) !== 100) {
          add(key, "warning", `Materiaalpercentages tellen op tot ${Math.round(total)}%`, "Zorg dat de percentages samen 100% zijn");
        }
        values.materials = materials;
        return;
      }
      case "regulations": {
        values.regulations = raw
          .split(/[;,|]/)
          .map((r) => r.trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 50);
        return;
      }
      case "photo_url": {
        if (!/^https?:\/\/\S+$/i.test(raw)) {
          add(key, "warning", "Foto-URL wordt overgeslagen: geen geldige http(s)-link", "Gebruik een volledige URL (https://...)");
          return;
        }
        values.photo_url = raw;
        return;
      }
      default:
        values[key] = raw;
    }
  });

  if (!values.name) {
    add("name", "error", "Productnaam ontbreekt", "Vul de productnaam in; dit veld is verplicht");
  }
  if (!values.sku && !values.gtin && !issues.some((i) => i.field === "gtin")) {
    add("sku", "warning", "Geen SKU of GTIN: duplicaten kunnen niet worden herkend", "Vul een SKU of GTIN in");
  }
  return { values, issues };
}

// Sleutel voor duplicaatdetectie: SKU (hoofdletterongevoelig) of anders GTIN.
function identityKeys(values) {
  return {
    sku: values.sku ? values.sku.toLowerCase() : null,
    gtin: values.gtin || null
  };
}

// Valideert alle rijen (incl. dubbelingen binnen het bestand en tegen bestaande
// producten). existing: [{ id, sku_key, gtin }]. Geeft per rij een uitkomst en
// samenvattende tellingen.
function validateAll(rows, mapping, existing, duplicateStrategy) {
  const existingBySku = new Map();
  const existingByGtin = new Map();
  for (const product of existing) {
    if (product.sku_key && !existingBySku.has(product.sku_key)) existingBySku.set(product.sku_key, product.id);
    if (product.gtin && !existingByGtin.has(product.gtin)) existingByGtin.set(product.gtin, product.id);
  }

  const seenSku = new Map();
  const seenGtin = new Map();
  const results = [];
  const summary = { total: rows.length, valid: 0, warnings: 0, errors: 0, duplicates: 0, toCreate: 0, toUpdate: 0, toSkip: 0 };

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 voor de kopregel, +1 omdat Excel bij 1 begint
    const { values, issues } = validateRow(row, mapping);
    const keys = identityKeys(values);

    if (keys.sku && seenSku.has(keys.sku)) {
      issues.push({ field: "sku", severity: "error", message: `Dubbele SKU in het bestand (ook rij ${seenSku.get(keys.sku)})`, suggestion: "Maak de SKU uniek of verwijder de dubbele rij" });
    } else if (keys.gtin && seenGtin.has(keys.gtin)) {
      issues.push({ field: "gtin", severity: "error", message: `Dubbele GTIN in het bestand (ook rij ${seenGtin.get(keys.gtin)})`, suggestion: "Maak de GTIN uniek of verwijder de dubbele rij" });
    }
    if (keys.sku && !seenSku.has(keys.sku)) seenSku.set(keys.sku, rowNumber);
    if (keys.gtin && !seenGtin.has(keys.gtin)) seenGtin.set(keys.gtin, rowNumber);

    const hasError = issues.some((i) => i.severity === "error");
    const existingId = (keys.sku && existingBySku.get(keys.sku)) || (keys.gtin && existingByGtin.get(keys.gtin)) || null;

    let action = "create";
    if (hasError) {
      action = "error";
    } else if (existingId) {
      summary.duplicates += 1;
      action = duplicateStrategy === "update" ? "update" : duplicateStrategy === "create" ? "create" : "skip";
      if (duplicateStrategy === "create") {
        issues.push({ field: keys.sku ? "sku" : "gtin", severity: "warning", message: "Bestaat al; er wordt toch een nieuw product aangemaakt", suggestion: "" });
      }
    }

    if (action === "error") summary.errors += 1;
    else summary.valid += 1;
    if (!hasError && issues.some((i) => i.severity === "warning")) summary.warnings += 1;
    if (action === "create") summary.toCreate += 1;
    if (action === "update") summary.toUpdate += 1;
    if (action === "skip") summary.toSkip += 1;

    results.push({ row: rowNumber, values, issues, action, existingId });
  });

  return { results, summary };
}

// Platte foutlijst voor opslag/rapport (rij, product, veld, ernst, fout, suggestie).
function flattenIssues(results, limit = 5000) {
  const out = [];
  for (const result of results) {
    for (const issue of result.issues) {
      if (out.length >= limit) return out;
      out.push({
        row: result.row,
        product: result.values.name || result.values.sku || "",
        field: issue.field,
        fieldLabel: FIELD_BY_KEY.get(issue.field)?.label || issue.field,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion
      });
    }
  }
  return out;
}

// --- template ----------------------------------------------------------------

const TEMPLATE_COLUMNS = [
  ["product_name", "name", "Ja", "Naam van het product (max. 200 tekens)", "Hoekbank Oslo"],
  ["sku", "sku", "Aanbevolen", "Uw artikelnummer; gebruikt om bestaande producten te herkennen", "HB-OSLO-01"],
  ["gtin", "gtin", "Nee", "EAN/GTIN: 8, 12, 13 of 14 cijfers", "8712345678906"],
  ["model", "model", "Nee", "Model- of productnummer", "OSLO-3Z"],
  ["brand", "brand", "Nee", "Merk", "VeriPasso Home"],
  ["manufacturer", "manufacturer", "Nee", "Fabrikant", "Meubelfabriek Noord BV"],
  ["category", "category", "Aanbevolen", "Productcategorie", "Banken"],
  ["country_of_origin", "country_of_origin", "Nee", "Land van oorsprong", "Nederland"],
  ["description", "description", "Aanbevolen", "Omschrijving voor het productpaspoort", "Driezitsbank met afneembare hoezen"],
  ["material", "material", "Nee", 'Eén materiaal, of meerdere met percentage gescheiden door ";"', "Hout 60%; Wol 40%"],
  ["recycled_material_percentage", "recycled_material_percentage", "Nee", "Percentage gerecycled materiaal (0-100)", "35"],
  ["carbon_footprint_kg", "carbon_footprint_kg", "Nee", "CO₂-voetafdruk in kg CO₂-eq", "112,5"],
  ["recyclable", "recyclable", "Nee", "ja / nee", "ja"],
  ["reach_compliant", "reach_compliant", "Nee", "ja / nee", "ja"],
  ["rohs_compliant", "rohs_compliant", "Nee", "ja / nee", "nee"],
  ["ce_marked", "ce_marked", "Nee", "ja / nee", "ja"],
  ["regulations", "regulations", "Nee", 'Toepasselijke regelgeving, gescheiden door ","', "ESPR, REACH"],
  ["expected_lifespan_years", "expected_lifespan_years", "Nee", "Verwachte levensduur in jaren", "15"],
  ["photo_url", "photo_url", "Nee", "Openbare link naar een productfoto (https://...)", ""]
];

function buildTemplateWorkbook() {
  const workbook = XLSX.utils.book_new();
  const header = TEMPLATE_COLUMNS.map((c) => c[0]);
  const example = TEMPLATE_COLUMNS.map((c) => c[4]);
  const sheet = XLSX.utils.aoa_to_sheet([header, example]);
  sheet["!cols"] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c[0].length + 2, String(c[4]).length + 2) }));
  // SKU en GTIN als tekst opmaken, zodat Excel geen voorloopnullen weghaalt.
  for (const col of [1, 2]) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: col })];
    if (cell) cell.t = "s";
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Producten");

  const instructions = [
    ["VeriPasso – productimport"],
    [""],
    ["1. Vul op het tabblad 'Producten' één product per rij in. Laat de kopregel staan."],
    ["2. Alleen product_name is verplicht. Met een SKU of GTIN herkent VeriPasso bestaande producten."],
    ["3. Kolommen met andere namen (bijv. 'Artikelnummer' of 'EAN') kunt u bij het importeren zelf koppelen."],
    ["4. Ja/nee-velden: gebruik ja of nee. Decimalen mogen met een komma."],
    ["5. Maximaal 10.000 producten per bestand. Bestaande producten worden alleen bijgewerkt als u daar bij het importeren voor kiest."],
    [""],
    ["Kolom", "Verplicht", "Uitleg", "Voorbeeld"],
    ...TEMPLATE_COLUMNS.map((c) => [c[0], c[2], c[3], c[4]])
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionSheet["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 70 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, "Instructies");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

// CSV-cel: puntkomma-gescheiden (NL-Excel) en formule-injectie onschadelijk maken.
function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

module.exports = {
  IMPORT_FIELDS: IMPORT_FIELDS.map(({ key, label, required }) => ({ key, label, required: Boolean(required) })),
  MAX_IMPORT_ROWS,
  CHUNK_SIZE,
  parseImportFile,
  suggestMapping,
  normalizeMapping,
  validateRow,
  validateAll,
  identityKeys,
  flattenIssues,
  buildTemplateWorkbook,
  toCsv,
  csvCell
};
