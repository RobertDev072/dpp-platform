import { computeLayout } from "@/src/services/printLayout";
import { labelBoxes, labelLines } from "@/lib/print/labelLayout";

// Bouwt een PDF met labels in de browser (pdf-lib). QR-codes worden als vectoren
// getekend: scherp op elke printer en een klein bestand, ook bij duizenden labels.
const PT = 72 / 25.4;

function hexToRgb(rgb, hex) {
  const v = String(hex || "#000000").replace("#", "");
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
}

// Standaardfonts in PDF kennen alleen WinAnsi-tekens; vervang wat niet past.
function makeSanitizer(font) {
  const cache = new Map();
  return (text) =>
    Array.from(String(text))
      .map((ch) => {
        if (!cache.has(ch)) {
          try {
            font.encodeText(ch);
            cache.set(ch, ch);
          } catch {
            cache.set(ch, ch === "₂" ? "2" : "?");
          }
        }
        return cache.get(ch);
      })
      .join("");
}

function fitText(font, text, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`.replace("…", "..."), size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function wrapText(font, text, size, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(font, lines.slice(maxLines - 1).join(" "), size, maxWidth);
    return kept;
  }
  return lines.map((line) => fitText(font, line, size, maxWidth));
}

async function embedLogo(pdf, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
  try {
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    if (dataUrl.startsWith("data:image/png")) return await pdf.embedPng(bytes);
    if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return await pdf.embedJpg(bytes);
  } catch {
    /* logo overslaan */
  }
  return null;
}

function drawQr(page, QRCode, rgb, { url, x, y, size, settings, pageHeight }) {
  const qr = QRCode.create(url, { errorCorrectionLevel: settings.qr.errorCorrection });
  const count = qr.modules.size;
  const quiet = settings.qr.quietZoneModules;
  const moduleMm = size / (count + 2 * quiet);
  const color = hexToRgb(rgb, settings.qr.color);
  page.drawRectangle({
    x: x * PT,
    y: (pageHeight - y - size) * PT,
    width: size * PT,
    height: size * PT,
    color: hexToRgb(rgb, settings.qr.background)
  });
  // Eén SVG-pad per QR (aaneengesloten modules per rij samengevoegd): veel kleiner
  // en sneller dan losse rechthoeken. Pad-eenheid = één module; drawSvgPath schaalt.
  const data = qr.modules.data;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let col = 0;
    while (col < count) {
      if (!data[row * count + col]) {
        col += 1;
        continue;
      }
      let end = col;
      while (end + 1 < count && data[row * count + end + 1]) end += 1;
      path += `M${quiet + col} ${quiet + row}h${end - col + 1}v1h-${end - col + 1}z`;
      col = end + 1;
    }
  }
  page.drawSvgPath(path, {
    x: x * PT,
    y: (pageHeight - y) * PT,
    scale: moduleMm * PT,
    color,
    borderWidth: 0
  });
}

export async function buildLabelsPdf({ items, settings, logoDataUrl, onProgress, title = "VeriPasso labels" }) {
  const [{ PDFDocument, StandardFonts, rgb }, QRCodeModule] = await Promise.all([import("pdf-lib"), import("qrcode")]);
  const QRCode = QRCodeModule.default || QRCodeModule;
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("VeriPasso");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(font);
  const logo = settings.template.elements.logo ? await embedLogo(pdf, logoDataUrl) : null;

  const layout = computeLayout(settings);
  const boxes = labelBoxes(settings, layout.labelWidth, layout.labelHeight);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.37, 0.4);
  let page = null;

  for (let i = 0; i < items.length; i += 1) {
    const slot = i % layout.perPage;
    if (slot === 0) page = pdf.addPage([layout.page.width * PT, layout.page.height * PT]);
    const origin = layout.positions[slot];
    const item = items[i];
    const H = layout.page.height;

    if (boxes.qr && item.qr_url) {
      drawQr(page, QRCode, rgb, {
        url: item.qr_url,
        x: origin.x + boxes.qr.x,
        y: origin.y + boxes.qr.y,
        size: boxes.qr.size,
        settings,
        pageHeight: H
      });
    }
    if (boxes.caption) {
      const size = Math.max(4, boxes.fontSmall * 0.85);
      const text = fitText(font, clean(settings.qr.caption), size, boxes.caption.w * PT);
      const width = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: (origin.x + boxes.caption.x) * PT + (boxes.caption.w * PT - width) / 2,
        y: (H - origin.y - boxes.caption.y) * PT - size,
        size,
        font,
        color: muted
      });
    }

    if (boxes.text) {
      let cursorMm = origin.y + boxes.text.y;
      const maxWidth = boxes.text.w * PT;
      const bottomMm = origin.y + boxes.text.y + boxes.text.h;
      if (logo) {
        const logoH = Math.min(6, boxes.text.h * 0.25);
        const scale = (logoH * PT) / logo.height;
        const logoW = Math.min(logo.width * scale, maxWidth);
        const lx = boxes.center ? (origin.x + boxes.text.x) * PT + (maxWidth - logoW) / 2 : (origin.x + boxes.text.x) * PT;
        page.drawImage(logo, { x: lx, y: (H - cursorMm - logoH) * PT, width: logoW, height: logoH * PT });
        cursorMm += logoH + 1;
      }
      for (const line of labelLines(settings, item)) {
        const f = line.bold ? bold : font;
        const size = line.bold && line.wrap ? boxes.fontName : boxes.fontSmall;
        const lineHeightMm = (size * 1.2) / PT;
        const parts = line.wrap ? wrapText(f, clean(line.text), size, maxWidth, line.wrap) : [fitText(f, clean(line.text), size, maxWidth)];
        for (const part of parts) {
          if (cursorMm + lineHeightMm > bottomMm + 0.1) break;
          const width = f.widthOfTextAtSize(part, size);
          const x = boxes.center ? (origin.x + boxes.text.x) * PT + (maxWidth - width) / 2 : (origin.x + boxes.text.x) * PT;
          page.drawText(part, { x, y: (H - cursorMm) * PT - size, size, font: f, color: line.bold ? ink : muted });
          cursorMm += lineHeightMm;
        }
      }
    }

    if (i % 50 === 49) {
      onProgress?.(i + 1);
      // De browser even laten ademhalen: voortgang tekenen, geen "pagina reageert niet".
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(items.length);
  const bytes = await pdf.save();
  return new Blob([bytes], { type: "application/pdf" });
}

// ZIP met losse QR-afbeeldingen (PNG op de gekozen DPI, of SVG).
export async function buildQrZip({ items, format = "png", settings, onProgress }) {
  const [{ default: JSZip }, QRCodeModule] = await Promise.all([import("jszip"), import("qrcode")]);
  const QRCode = QRCodeModule.default || QRCodeModule;
  const zip = new JSZip();
  const sizeMm = settings?.qr?.sizeMm || 30;
  const dpi = settings?.export?.dpi || 300;
  const options = {
    errorCorrectionLevel: settings?.qr?.errorCorrection || "M",
    margin: settings?.qr?.quietZoneModules ?? 2,
    color: { dark: settings?.qr?.color || "#000000", light: settings?.qr?.background || "#FFFFFF" }
  };
  const used = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.qr_url) continue;
    const baseName = `${item.sku || item.id}-${item.name}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    let name = baseName;
    for (let n = 2; used.has(name); n += 1) name = `${baseName}_${n}`;
    used.add(name);
    if (format === "svg") {
      zip.file(`${name}.svg`, await QRCode.toString(item.qr_url, { ...options, type: "svg" }));
    } else {
      const width = Math.max(300, Math.round((sizeMm / 25.4) * dpi));
      const dataUrl = await QRCode.toDataURL(item.qr_url, { ...options, width });
      zip.file(`${name}.png`, dataUrl.split(",")[1], { base64: true });
    }
    if (i % 25 === 24) {
      onProgress?.(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(items.length);
  return zip.generateAsync({ type: "blob" });
}
