const { z } = require("zod");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

// Printprofielen en labelopmaak. Eén bron van waarheid voor: het instellingenschema,
// de layoutberekening (labels per pagina, celmaten), de QR-leesbaarheidscontrole en
// het renderen van labels naar PDF. QR-codes worden als vector getekend (nooit als
// screenshot/bitmap), zodat ze op elk formaat scherp printen.

const MM_TO_PT = 72 / 25.4;

const PAPER_SIZES = {
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4]
};

const LABEL_LAYOUTS = {
  "1x1": [1, 1],
  "2x4": [2, 4],
  "2x7": [2, 7],
  "2x8": [2, 8],
  "3x7": [3, 7],
  "3x8": [3, 8],
  "3x9": [3, 9],
  "4x6": [4, 6]
};

const TEMPLATES = ["qr_only", "qr_name", "qr_name_sku", "qr_name_category", "compact", "standard", "professional", "custom"];

// Standaard zichtbare elementen per template (de gebruiker kan ze bij "custom" zelf kiezen).
const TEMPLATE_ELEMENTS = {
  qr_only: { scanText: false },
  qr_name: { name: true },
  qr_name_sku: { name: true, sku: true },
  qr_name_category: { name: true, category: true },
  compact: { name: true, sku: true },
  standard: { name: true, sku: true, gtin: true, scanText: true },
  professional: { logo: true, name: true, sku: true, gtin: true, manufacturer: true, country: true, ce: true, recyclable: true, scanText: true }
};

const ELEMENT_KEYS = ["logo", "name", "sku", "gtin", "scanText", "manufacturer", "country", "ce", "recyclable", "category"];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Gebruik een kleurcode als #000000");

const printSettingsSchema = z
  .object({
    paper: z.enum(["A4", "A5", "A6", "Letter", "custom"]).default("A4"),
    paperWidthMm: z.number().min(20).max(1000).optional(),
    paperHeightMm: z.number().min(20).max(1000).optional(),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    printerType: z.enum(["laser", "inkjet", "label", "thermal", "professional", "pdf"]).default("laser"),
    layout: z.enum([...Object.keys(LABEL_LAYOUTS), "custom"]).default("3x8"),
    columns: z.number().int().min(1).max(10).optional(),
    rows: z.number().int().min(1).max(30).optional(),
    labelWidthMm: z.number().min(10).max(300).optional(),
    labelHeightMm: z.number().min(10).max(300).optional(),
    marginTopMm: z.number().min(0).max(50).default(10),
    marginSideMm: z.number().min(0).max(50).default(8),
    gapXMm: z.number().min(0).max(30).default(2),
    gapYMm: z.number().min(0).max(30).default(0),
    media: z.enum(["plain", "matte", "glossy", "sticker", "transparent", "thermal", "cardboard", "custom"]).default("sticker"),
    mediaWeightGsm: z.number().int().min(40).max(1000).optional(),
    qr: z
      .object({
        sizeMm: z.number().min(5).max(200).default(22),
        errorCorrection: z.enum(["L", "M", "Q", "H"]).default("M"),
        quietZoneModules: z.number().int().min(0).max(10).default(4),
        color: hexColor.default("#000000"),
        background: hexColor.default("#FFFFFF")
      })
      .default({ sizeMm: 22, errorCorrection: "M", quietZoneModules: 4, color: "#000000", background: "#FFFFFF" }),
    template: z.enum(TEMPLATES).default("standard"),
    elements: z.partialRecord(z.enum(ELEMENT_KEYS), z.boolean()).optional(),
    scanText: z.string().max(60).default("Scan voor productpaspoort"),
    fontSizePt: z.number().min(5).max(24).default(8),
    showCutLines: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.paper === "custom" && (!value.paperWidthMm || !value.paperHeightMm)) {
      ctx.addIssue({ code: "custom", path: ["paperWidthMm"], message: "Vul breedte en hoogte van het papier in" });
    }
    if (value.layout === "custom" && (!value.columns || !value.rows)) {
      ctx.addIssue({ code: "custom", path: ["columns"], message: "Vul het aantal kolommen en rijen in" });
    }
    if (["label", "thermal"].includes(value.printerType) && (!value.labelWidthMm || !value.labelHeightMm)) {
      ctx.addIssue({ code: "custom", path: ["labelWidthMm"], message: "Vul breedte en hoogte van het label in" });
    }
  });

const printProfileSchema = z.object({
  name: z.string().trim().min(1, "Geef het profiel een naam").max(100),
  description: z.string().max(255).optional().nullable(),
  isDefault: z.boolean().optional(),
  settings: printSettingsSchema
});

// Ingebouwde voorbeelden; een bedrijf zonder eigen profielen kan hiermee meteen printen.
const BUILT_IN_PRESETS = [
  {
    key: "a4-3x8",
    name: "Productlabel A4 – 3×8",
    description: "24 stickers per A4-vel (70×37 mm), laserprinter",
    settings: { paper: "A4", layout: "3x8", printerType: "laser", media: "sticker", marginTopMm: 4.5, marginSideMm: 0, gapXMm: 0, gapYMm: 0, template: "standard", qr: { sizeMm: 24 } }
  },
  {
    key: "a4-2x7",
    name: "Grote verpakking A4 – 2×7",
    description: "14 labels per A4-vel (99×38 mm) met extra productinformatie",
    settings: { paper: "A4", layout: "2x7", printerType: "laser", media: "sticker", marginTopMm: 15, marginSideMm: 5, gapXMm: 2, gapYMm: 0, template: "professional", qr: { sizeMm: 30 } }
  },
  {
    key: "a5-1x1",
    name: "A5 – één label per pagina",
    description: "Groot label of productblad op A5",
    settings: { paper: "A5", layout: "1x1", printerType: "laser", media: "plain", marginTopMm: 12, marginSideMm: 12, template: "professional", qr: { sizeMm: 60 } }
  },
  {
    key: "label-62x29",
    name: "Labelprinter 62×29 mm",
    description: "Kleine verpakking, thermische labelprinter (bijv. Brother/Zebra)",
    settings: { paper: "custom", paperWidthMm: 62, paperHeightMm: 29, printerType: "thermal", labelWidthMm: 62, labelHeightMm: 29, layout: "1x1", media: "thermal", marginTopMm: 1.5, marginSideMm: 1.5, template: "compact", qr: { sizeMm: 21, quietZoneModules: 2 } }
  },
  {
    key: "qr-only-4x6",
    name: "Alleen QR – 4×6",
    description: "24 losse QR-codes per A4-vel",
    settings: { paper: "A4", layout: "4x6", printerType: "laser", media: "sticker", marginTopMm: 10, marginSideMm: 8, gapXMm: 2, gapYMm: 2, template: "qr_only", qr: { sizeMm: 30 } }
  }
];

function resolveSettings(input) {
  return printSettingsSchema.parse(input || {});
}

function elementsOf(settings) {
  if (settings.template === "custom") {
    return { ...TEMPLATE_ELEMENTS.standard, ...(settings.elements || {}) };
  }
  return { ...(TEMPLATE_ELEMENTS[settings.template] || TEMPLATE_ELEMENTS.standard) };
}

// Paginamaat, raster en celmaten in mm.
function computeLayout(settings) {
  const isLabelPrinter = ["label", "thermal"].includes(settings.printerType);
  let pageW;
  let pageH;
  let columns;
  let rows;
  if (isLabelPrinter) {
    pageW = settings.labelWidthMm;
    pageH = settings.labelHeightMm;
    columns = 1;
    rows = 1;
  } else {
    [pageW, pageH] = settings.paper === "custom" ? [settings.paperWidthMm, settings.paperHeightMm] : PAPER_SIZES[settings.paper];
    if (settings.orientation === "landscape") [pageW, pageH] = [pageH, pageW];
    [columns, rows] = settings.layout === "custom" ? [settings.columns, settings.rows] : LABEL_LAYOUTS[settings.layout];
  }
  const marginTop = settings.marginTopMm;
  const marginSide = settings.marginSideMm;
  const gapX = columns > 1 ? settings.gapXMm : 0;
  const gapY = rows > 1 ? settings.gapYMm : 0;
  const cellW = (pageW - 2 * marginSide - (columns - 1) * gapX) / columns;
  const cellH = (pageH - 2 * marginTop - (rows - 1) * gapY) / rows;
  return { pageW, pageH, columns, rows, perPage: columns * rows, marginTop, marginSide, gapX, gapY, cellW, cellH, isLabelPrinter };
}

function luminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Leesbaarheidscontrole. errors blokkeren genereren; warnings worden getoond.
// sampleUrl: een representatieve paspoortlink (bepaalt het aantal QR-modules).
function checkReadability(settings, sampleUrl) {
  const errors = [];
  const warnings = [];
  const layout = computeLayout(settings);
  const { qr } = settings;

  if (!(layout.cellW > 0 && layout.cellH > 0)) {
    errors.push("De marges en tussenruimte zijn groter dan het papier: er past geen label op de pagina.");
    return { errors, warnings, layout, moduleMm: null, modules: null };
  }

  const code = QRCode.create(sampleUrl, { errorCorrectionLevel: qr.errorCorrection });
  const modules = code.modules.size;
  const totalModules = modules + 2 * qr.quietZoneModules;
  const moduleMm = qr.sizeMm / totalModules;

  if (qr.sizeMm < 10) errors.push(`QR-code van ${qr.sizeMm} mm is te klein om betrouwbaar te scannen (minimaal 10 mm).`);
  else if (qr.sizeMm < 15) warnings.push("Deze QR-code is mogelijk te klein voor betrouwbare scanning; 15 mm of groter wordt aangeraden.");

  if (moduleMm < 0.25) {
    errors.push(`Eén QR-blokje wordt ${moduleMm.toFixed(2)} mm: te klein om te printen en scannen. Maak de QR-code groter of kies een lager foutcorrectieniveau.`);
  } else if (moduleMm < 0.4) {
    warnings.push(`Eén QR-blokje wordt ${moduleMm.toFixed(2)} mm. Voor betrouwbaar scannen wordt 0,4 mm of meer aangeraden.`);
  }
  if (layout.isLabelPrinter && moduleMm < 0.375) {
    warnings.push("Thermische labelprinters (203 dpi) hebben minimaal 0,375 mm per QR-blokje nodig voor een scherpe afdruk.");
  }

  if (qr.quietZoneModules === 0) errors.push("Zonder witte rand (quiet zone) rond de QR-code kan een scanner de code niet vinden.");
  else if (qr.quietZoneModules < 2) warnings.push("De witte rand rond de QR-code is erg smal; 4 blokjes is de norm, minimaal 2.");

  const fg = luminance(qr.color);
  const bg = luminance(qr.background);
  const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  if (contrast < 3) errors.push("Het contrast tussen QR-kleur en achtergrond is te laag om te scannen.");
  else if (contrast < 7) warnings.push("Het contrast tussen QR-kleur en achtergrond is laag; donker op licht scant het best.");
  if (fg > bg) warnings.push("Een lichte QR-code op een donkere achtergrond wordt door veel scanners niet herkend.");
  if (settings.media === "transparent" && qr.background.toUpperCase() === "#FFFFFF") {
    warnings.push("Op transparante stickers wordt wit vaak niet geprint: de QR-code heeft dan geen eigen achtergrond.");
  }
  if (settings.printerType === "thermal" && qr.color.toUpperCase() !== "#000000") {
    warnings.push("Thermische printers printen alleen zwart; de gekozen QR-kleur wordt zwart.");
  }

  const padding = Math.min(2, layout.cellW * 0.05);
  if (qr.sizeMm > layout.cellW - 2 * padding + 0.01 || qr.sizeMm > layout.cellH - 2 * padding + 0.01) {
    errors.push(
      `De QR-code (${qr.sizeMm} mm) past niet op het label (${layout.cellW.toFixed(1)} × ${layout.cellH.toFixed(1)} mm). Maak de QR-code kleiner of kies een grotere labelindeling.`
    );
  } else if (settings.template !== "qr_only" && settings.template !== "compact" && settings.template !== "professional") {
    const textSpace = layout.cellH - qr.sizeMm - 2 * padding;
    const lines = Object.entries(elementsOf(settings)).filter(([key, on]) => on && !["logo", "ce", "recyclable"].includes(key)).length;
    if (lines > 0 && textSpace < (settings.fontSizePt * 0.3528 * 1.2)) {
      warnings.push("Er is weinig ruimte voor tekst onder de QR-code; tekst wordt ingekort of weggelaten.");
    }
  }

  return { errors, warnings, layout, moduleMm, modules };
}

function summarize(settings, productCount, sampleUrl) {
  const readability = checkReadability(settings, sampleUrl);
  const perPage = readability.layout.perPage || 1;
  return {
    productCount,
    perPage,
    pages: productCount > 0 ? Math.ceil(productCount / perPage) : 0,
    layout: readability.layout,
    moduleMm: readability.moduleMm,
    errors: readability.errors,
    warnings: readability.warnings
  };
}

// --- PDF ---------------------------------------------------------------------

// Vector-QR: één pad met per rij aaneengesloten blokjes (compact en scherp).
function drawQr(doc, url, x, y, sizePt, qr, thermal) {
  const code = QRCode.create(url, { errorCorrectionLevel: qr.errorCorrection });
  const n = code.modules.size;
  const total = n + 2 * qr.quietZoneModules;
  const unit = sizePt / total;
  const color = thermal ? "#000000" : qr.color;
  doc.save();
  doc.rect(x, y, sizePt, sizePt).fill(thermal ? "#FFFFFF" : qr.background);
  let path = "";
  for (let row = 0; row < n; row += 1) {
    let col = 0;
    while (col < n) {
      if (code.modules.get(row, col)) {
        const start = col;
        while (col < n && code.modules.get(row, col)) col += 1;
        const px = x + (start + qr.quietZoneModules) * unit;
        const py = y + (row + qr.quietZoneModules) * unit;
        // Minuscule overlap voorkomt haarlijntjes tussen rijen in sommige viewers.
        path += `M${px.toFixed(3)} ${py.toFixed(3)}h${((col - start) * unit + 0.01).toFixed(3)}v${(unit + 0.01).toFixed(3)}h${(-((col - start) * unit + 0.01)).toFixed(3)}Z`;
      } else {
        col += 1;
      }
    }
  }
  if (path) doc.path(path).fill(color);
  doc.restore();
}

function logoBuffer(dataUri) {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUri || "");
  return match ? Buffer.from(match[2], "base64") : null;
}

function textLines(product, elements) {
  const lines = [];
  if (elements.sku && product.sku) lines.push(`SKU ${product.sku}`);
  if (elements.gtin && product.gtin) lines.push(`GTIN ${product.gtin}`);
  if (elements.category && product.category_label) lines.push(product.category_label);
  if (elements.manufacturer && product.manufacturer) lines.push(product.manufacturer);
  if (elements.country && product.country_of_origin) lines.push(`Herkomst: ${product.country_of_origin}`);
  return lines;
}

function badges(product, elements) {
  const out = [];
  if (elements.ce && product.ce_marked) out.push("CE");
  if (elements.recyclable && product.recyclable) out.push("Recyclebaar");
  return out;
}

function drawLabel(doc, { product, url, x, y, w, h, settings, elements, logo }) {
  const pad = Math.min(2 * MM_TO_PT, w * 0.05);
  const qrPt = settings.qr.sizeMm * MM_TO_PT;
  const fs = settings.fontSizePt;
  const thermal = settings.printerType === "thermal";
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;

  if (settings.showCutLines) {
    doc.save().lineWidth(0.3).strokeColor("#BBBBBB").rect(x, y, w, h).stroke().restore();
  }

  doc.fillColor("#111111");
  const horizontal = settings.template !== "qr_only" && (["compact", "professional"].includes(settings.template) || w > h * 1.6);

  if (settings.template === "qr_only") {
    const qy = innerY + (innerH - qrPt - (elements.scanText ? fs * 1.3 : 0)) / 2;
    drawQr(doc, url, innerX + (innerW - qrPt) / 2, qy, qrPt, settings.qr, thermal);
    if (elements.scanText && settings.scanText) {
      doc.font("Helvetica").fontSize(fs * 0.85).fillColor("#333333")
        .text(settings.scanText, innerX, qy + qrPt + fs * 0.25, { width: innerW, align: "center", lineBreak: false, ellipsis: true });
    }
    return;
  }

  if (horizontal) {
    const qx = innerX;
    const qy = innerY + Math.max(0, (innerH - qrPt) / 2);
    drawQr(doc, url, qx, qy, qrPt, settings.qr, thermal);
    const tx = qx + qrPt + pad;
    const tw = innerW - qrPt - pad;
    if (tw < fs * 2) return;
    let ty = innerY;
    if (elements.logo && logo) {
      try {
        doc.image(logo, tx, ty, { fit: [tw, fs * 2.2] });
        ty += fs * 2.5;
      } catch {
        // Ongeldige logo-afbeelding: label zonder logo.
      }
    }
    if (elements.name) {
      doc.font("Helvetica-Bold").fontSize(fs * 1.15).fillColor("#111111")
        .text(product.name, tx, ty, { width: tw, height: fs * 2.8, ellipsis: true });
      ty = doc.y + fs * 0.2;
    }
    doc.font("Helvetica").fontSize(fs).fillColor("#333333");
    for (const line of textLines(product, elements)) {
      if (ty + fs * 1.2 > innerY + innerH) break;
      doc.text(line, tx, ty, { width: tw, lineBreak: false, ellipsis: true });
      ty += fs * 1.25;
    }
    const badgeList = badges(product, elements);
    if (badgeList.length && ty + fs * 1.4 <= innerY + innerH) {
      doc.font("Helvetica-Bold").fontSize(fs * 0.85).text(badgeList.join("  ·  "), tx, ty, { width: tw, lineBreak: false, ellipsis: true });
      ty += fs * 1.3;
    }
    if (elements.scanText && settings.scanText && ty + fs <= innerY + innerH) {
      doc.font("Helvetica-Oblique").fontSize(fs * 0.8).fillColor("#555555")
        .text(settings.scanText, tx, innerY + innerH - fs * 0.9, { width: tw, lineBreak: false, ellipsis: true });
    }
    return;
  }

  // Verticaal: naam boven, QR in het midden, details eronder.
  let ty = innerY;
  if (elements.logo && logo) {
    try {
      doc.image(logo, innerX, ty, { fit: [innerW, fs * 2], align: "center" });
      ty += fs * 2.3;
    } catch {
      // zonder logo verder
    }
  }
  if (elements.name) {
    doc.font("Helvetica-Bold").fontSize(fs * 1.1).fillColor("#111111")
      .text(product.name, innerX, ty, { width: innerW, align: "center", lineBreak: false, ellipsis: true });
    ty += fs * 1.4;
  }
  const below = [...textLines(product, elements)];
  const badgeList = badges(product, elements);
  if (badgeList.length) below.push(badgeList.join("  ·  "));
  if (elements.scanText && settings.scanText) below.push(settings.scanText);
  const room = innerY + innerH - (ty + qrPt);
  const fitLines = Math.max(0, Math.floor(room / (fs * 1.2)));
  const qx = innerX + (innerW - qrPt) / 2;
  const qy = ty + Math.max(0, (room - Math.min(fitLines, below.length) * fs * 1.2) / 2);
  drawQr(doc, url, qx, qy, qrPt, settings.qr, thermal);
  let ly = qy + qrPt + fs * 0.2;
  doc.font("Helvetica").fontSize(fs * 0.9).fillColor("#333333");
  for (const line of below.slice(0, fitLines)) {
    doc.text(line, innerX, ly, { width: innerW, align: "center", lineBreak: false, ellipsis: true });
    ly += fs * 1.2;
  }
}

// products: rijen met minimaal name/public_id (+ optionele labelvelden).
function renderLabelsPdf({ products, settings, companyLogo, urlFor, title = "Labels" }) {
  const layout = computeLayout(settings);
  const elements = elementsOf(settings);
  const logo = elements.logo ? logoBuffer(companyLogo) : null;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [layout.pageW * MM_TO_PT, layout.pageH * MM_TO_PT],
        margin: 0,
        autoFirstPage: false,
        compress: true,
        info: { Title: title, Producer: "VeriPasso" }
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      products.forEach((product, index) => {
        const slot = index % layout.perPage;
        if (slot === 0) doc.addPage();
        const col = slot % layout.columns;
        const row = Math.floor(slot / layout.columns);
        const x = (layout.marginSide + col * (layout.cellW + layout.gapX)) * MM_TO_PT;
        const y = (layout.marginTop + row * (layout.cellH + layout.gapY)) * MM_TO_PT;
        drawLabel(doc, {
          product,
          url: urlFor(product),
          x,
          y,
          w: layout.cellW * MM_TO_PT,
          h: layout.cellH * MM_TO_PT,
          settings,
          elements,
          logo
        });
      });
      if (!products.length) doc.addPage();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  PAPER_SIZES,
  LABEL_LAYOUTS,
  TEMPLATES,
  TEMPLATE_ELEMENTS,
  ELEMENT_KEYS,
  BUILT_IN_PRESETS,
  printSettingsSchema,
  printProfileSchema,
  resolveSettings,
  elementsOf,
  computeLayout,
  checkReadability,
  summarize,
  renderLabelsPdf
};
