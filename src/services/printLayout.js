// Print-/labelinstellingen: presets, layoutberekening en leesbaarheidscontroles.
// Gedeeld door de browser (instellingenpagina, voorvertoning, PDF-generatie) en de
// server (validatie bij opslaan). Geen Node-afhankelijkheden. Alle maten in mm.

const PAPER_PRESETS = {
  A4: { label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297 },
  A5: { label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210 },
  A6: { label: "A6 (105 × 148 mm)", widthMm: 105, heightMm: 148 },
  Letter: { label: "Letter (216 × 279 mm)", widthMm: 215.9, heightMm: 279.4 },
  label: { label: "Losse labels (labelprinter)", widthMm: 62, heightMm: 40 },
  custom: { label: "Aangepast formaat", widthMm: 100, heightMm: 150 }
};

const LAYOUT_PRESETS = {
  "1": { label: "1 label per pagina", columns: 1, rows: 1 },
  "2x7": { label: "2 × 7 (14 per vel)", columns: 2, rows: 7 },
  "2x8": { label: "2 × 8 (16 per vel)", columns: 2, rows: 8 },
  "3x7": { label: "3 × 7 (21 per vel)", columns: 3, rows: 7 },
  "3x8": { label: "3 × 8 (24 per vel)", columns: 3, rows: 8 },
  "3x9": { label: "3 × 9 (27 per vel)", columns: 3, rows: 9 },
  "4x6": { label: "4 × 6 (24 per vel)", columns: 4, rows: 6 },
  custom: { label: "Aangepast raster", columns: 2, rows: 5 }
};

const MEDIA_TYPES = {
  plain: "Normaal papier",
  matte: "Mat papier",
  glossy: "Glossy papier",
  sticker: "Stickerpapier",
  transparent: "Transparante sticker",
  thermal: "Thermisch papier",
  cardboard: "Karton",
  custom: "Anders"
};

const PRINTER_TYPES = {
  laser: "A4-/laserprinter",
  inkjet: "Inkjetprinter",
  label: "Labelprinter",
  thermal: "Thermische printer",
  professional: "Professionele drukker",
  pdf: "Alleen PDF-export"
};

const TEMPLATE_ELEMENTS = {
  logo: "Bedrijfslogo",
  name: "Productnaam",
  sku: "SKU",
  gtin: "GTIN",
  qr: "QR-code",
  scanText: "Scantekst",
  manufacturer: "Fabrikant",
  country: "Land van oorsprong",
  ce: "CE-markering",
  recyclable: "Recyclebaar",
  category: "Categorie"
};

const TEMPLATE_PRESETS = {
  compact: { label: "Compact", elements: { qr: true, name: true, sku: true } },
  standard: { label: "Standaard", elements: { qr: true, name: true, sku: true, gtin: true, scanText: true } },
  professional: {
    label: "Professioneel",
    elements: { logo: true, qr: true, name: true, sku: true, gtin: true, scanText: true, manufacturer: true, country: true, ce: true, recyclable: true }
  },
  qr_only: { label: "Alleen QR", elements: { qr: true } },
  custom: { label: "Aangepast", elements: { qr: true, name: true } }
};

const ERROR_CORRECTION = {
  L: "Laag (7%) — kleinste code",
  M: "Middel (15%) — aanbevolen",
  Q: "Hoog (25%)",
  H: "Zeer hoog (30%) — nodig bij een logo over de code"
};

function defaultSettings() {
  return {
    paper: { preset: "A4", widthMm: 210, heightMm: 297, orientation: "portrait" },
    layout: { preset: "3x8", columns: 3, rows: 8, marginTopMm: 10, marginRightMm: 7, marginBottomMm: 10, marginLeftMm: 7, gapXMm: 2.5, gapYMm: 0 },
    media: { type: "sticker", weightGsm: null, finish: "" },
    printer: { type: "laser" },
    qr: { sizeMm: 22, errorCorrection: "M", quietZoneModules: 2, color: "#000000", background: "#FFFFFF", caption: "Scan voor productpaspoort" },
    template: { preset: "standard", elements: { ...TEMPLATE_PRESETS.standard.elements } },
    export: { format: "pdf", dpi: 300 }
  };
}

// Voorbeeldprofielen om mee te beginnen (niet opgeslagen tot de gebruiker er een kiest).
function exampleProfiles() {
  const base = defaultSettings();
  const clone = (patch) => mergeSettings(base, patch);
  return [
    { name: "Productlabel A4 – 3×8", purpose: "Stickervellen op een kantoorprinter", settings: clone({}) },
    {
      name: "Kleine verpakking",
      purpose: "Kleine stickers, alleen QR + SKU",
      settings: clone({
        layout: { preset: "4x6", columns: 4, rows: 6 },
        qr: { sizeMm: 18 },
        template: { preset: "compact", elements: { ...TEMPLATE_PRESETS.compact.elements } }
      })
    },
    {
      name: "Grote verpakking",
      purpose: "A6-label per product met volledige informatie",
      settings: clone({
        paper: { preset: "A6", widthMm: 105, heightMm: 148 },
        layout: { preset: "1", columns: 1, rows: 1, marginTopMm: 6, marginRightMm: 6, marginBottomMm: 6, marginLeftMm: 6, gapXMm: 0, gapYMm: 0 },
        qr: { sizeMm: 45, errorCorrection: "Q" },
        template: { preset: "professional", elements: { ...TEMPLATE_PRESETS.professional.elements } }
      })
    },
    {
      name: "Zebra labelprinter 62×40",
      purpose: "Thermische labelprinter, één label per keer",
      settings: clone({
        paper: { preset: "label", widthMm: 62, heightMm: 40 },
        layout: { preset: "1", columns: 1, rows: 1, marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2, gapXMm: 0, gapYMm: 0 },
        media: { type: "thermal" },
        printer: { type: "thermal" },
        qr: { sizeMm: 26 },
        template: { preset: "compact", elements: { ...TEMPLATE_PRESETS.compact.elements } }
      })
    },
    {
      name: "Alleen QR",
      purpose: "Losse QR-codes, bijv. voor een drukker",
      settings: clone({
        layout: { preset: "4x6", columns: 4, rows: 6 },
        printer: { type: "professional" },
        qr: { sizeMm: 30, caption: "" },
        template: { preset: "qr_only", elements: { ...TEMPLATE_PRESETS.qr_only.elements } }
      })
    }
  ];
}

function mergeSettings(base, patch = {}) {
  const result = {};
  for (const key of Object.keys(base)) {
    result[key] = { ...base[key], ...(patch[key] || {}) };
  }
  if (patch.template?.elements) result.template.elements = { ...patch.template.elements };
  return result;
}

// Paginamaat inclusief oriëntatie.
function pageSize(settings) {
  const { widthMm, heightMm, orientation } = settings.paper;
  return orientation === "landscape" ? { width: heightMm, height: widthMm } : { width: widthMm, height: heightMm };
}

function computeLayout(settings) {
  const page = pageSize(settings);
  const l = settings.layout;
  const columns = Math.max(1, Math.round(l.columns));
  const rows = Math.max(1, Math.round(l.rows));
  const usableW = page.width - l.marginLeftMm - l.marginRightMm - l.gapXMm * (columns - 1);
  const usableH = page.height - l.marginTopMm - l.marginBottomMm - l.gapYMm * (rows - 1);
  const labelWidth = usableW / columns;
  const labelHeight = usableH / rows;
  const positions = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      positions.push({
        x: l.marginLeftMm + c * (labelWidth + l.gapXMm),
        y: l.marginTopMm + r * (labelHeight + l.gapYMm)
      });
    }
  }
  return { page, columns, rows, perPage: columns * rows, labelWidth, labelHeight, positions };
}

// Een QR-code voor https://qr.veripasso.com/p/<GUID> (63 tekens, hoofdletters)
// (gemeten met de qrcode-bibliotheek): 29 modules bij L, 33 bij M, 37 bij Q, 41 bij H.
const MODULES_BY_LEVEL = { L: 29, M: 33, Q: 37, H: 41 };

function relativeLuminance(hex) {
  const value = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Controleert of de instellingen een bruikbaar label opleveren. errors blokkeren
// opslaan; warnings worden duidelijk getoond maar blokkeren niet.
function checkSettings(settings) {
  const errors = [];
  const warnings = [];
  const layout = computeLayout(settings);
  const qr = settings.qr;

  if (layout.labelWidth <= 5 || layout.labelHeight <= 5) {
    errors.push("De labels passen niet op de pagina: verklein de marges, tussenruimte of het aantal kolommen/rijen.");
  }

  const qrShown = settings.template.elements.qr !== false;
  if (qrShown) {
    const modules = MODULES_BY_LEVEL[qr.errorCorrection] || 33;
    const totalModules = modules + 2 * qr.quietZoneModules;
    const moduleMm = qr.sizeMm / totalModules;
    const qrWithZone = qr.sizeMm;
    if (qrWithZone > layout.labelWidth + 0.01 || qrWithZone > layout.labelHeight + 0.01) {
      errors.push(
        `De QR-code (${qr.sizeMm} mm) past niet op het label (${layout.labelWidth.toFixed(1)} × ${layout.labelHeight.toFixed(1)} mm).`
      );
    }
    if (qr.sizeMm < 10) {
      errors.push("Een QR-code kleiner dan 10 mm is niet betrouwbaar scanbaar.");
    } else if (qr.sizeMm < 15 || moduleMm < 0.4) {
      warnings.push("Deze QR-code is mogelijk te klein voor betrouwbare scanning (advies: minimaal 15–20 mm).");
    }
    if (qr.quietZoneModules < 2) {
      warnings.push("De witrand rond de QR-code is erg smal; advies is minimaal 2 (liefst 4) modules.");
    }
    const fg = relativeLuminance(qr.color);
    const bg = relativeLuminance(qr.background);
    if (fg != null && bg != null) {
      const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (contrast < 3) errors.push("Te weinig contrast tussen QR-kleur en achtergrond: de code is dan niet leesbaar.");
      else if (contrast < 7) warnings.push("Het contrast van de QR-code is laag; donker op licht scant het best.");
      if (fg > bg) warnings.push("Een lichte QR op een donkere achtergrond wordt door sommige scanners niet herkend.");
    }
    if (settings.printer.type === "thermal" && (qr.color.toUpperCase() !== "#000000" || settings.qr.background.toUpperCase() !== "#FFFFFF")) {
      warnings.push("Thermische printers drukken alleen zwart: kleuren worden genegeerd.");
    }
  } else {
    warnings.push("Er staat geen QR-code op dit label.");
  }

  return { errors, warnings, layout };
}

module.exports = {
  PAPER_PRESETS,
  LAYOUT_PRESETS,
  MEDIA_TYPES,
  PRINTER_TYPES,
  TEMPLATE_ELEMENTS,
  TEMPLATE_PRESETS,
  ERROR_CORRECTION,
  defaultSettings,
  exampleProfiles,
  mergeSettings,
  computeLayout,
  checkSettings
};
