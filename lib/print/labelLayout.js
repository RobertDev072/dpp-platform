// Indeling van één label (in mm, oorsprong linksboven). Gedeeld door de PDF-generator
// en de voorvertoning, zodat wat je ziet ook echt is wat er geprint wordt.
const PAD = 2;

export function labelBoxes(settings, labelWidth, labelHeight) {
  const elements = settings.template.elements || {};
  const showQr = elements.qr !== false;
  const qrSize = showQr ? Math.min(settings.qr.sizeMm, labelWidth - 2 * PAD, labelHeight - 2 * PAD) : 0;
  const hasText = Object.entries(elements).some(([key, on]) => on && key !== "qr");
  const captionHeight = showQr && elements.scanText && settings.qr.caption ? 3.2 : 0;

  // Breed label: QR links, tekst rechts. Hoog/vierkant label: QR boven, tekst eronder.
  const landscape = labelWidth >= labelHeight * 1.25 || !hasText;
  let qr = null;
  let text = null;
  let caption = null;

  if (!hasText) {
    qr = { x: (labelWidth - qrSize) / 2, y: (labelHeight - qrSize - captionHeight) / 2, size: qrSize };
  } else if (landscape) {
    const usableQr = Math.min(qrSize, labelHeight - 2 * PAD - captionHeight);
    qr = showQr ? { x: PAD, y: (labelHeight - usableQr - captionHeight) / 2, size: usableQr } : null;
    const textX = showQr ? PAD + usableQr + PAD : PAD;
    text = { x: textX, y: PAD, w: labelWidth - textX - PAD, h: labelHeight - 2 * PAD };
  } else {
    const usableQr = Math.min(qrSize, labelHeight * 0.62);
    qr = showQr ? { x: (labelWidth - usableQr) / 2, y: PAD, size: usableQr } : null;
    const textY = showQr ? PAD + usableQr + captionHeight + 1 : PAD;
    text = { x: PAD, y: textY, w: labelWidth - 2 * PAD, h: labelHeight - textY - PAD };
  }
  if (qr && captionHeight) caption = { x: qr.x, y: qr.y + qr.size + 0.4, w: qr.size, h: captionHeight };

  // Lettergroottes (pt) schalen mee met het label, binnen leesbare grenzen.
  const base = Math.max(5, Math.min(11, Math.min(labelHeight, labelWidth) * 0.22));
  return { qr, text, caption, fontName: base, fontSmall: Math.max(4.5, base * 0.75), center: !landscape };
}

// Tekstregels voor een product volgens het template.
export function labelLines(settings, item) {
  const e = settings.template.elements || {};
  const lines = [];
  if (e.name && item.name) lines.push({ text: item.name, bold: true, wrap: 2 });
  if (e.sku && item.sku) lines.push({ text: `SKU ${item.sku}` });
  if (e.gtin && item.gtin) lines.push({ text: `GTIN ${item.gtin}` });
  if (e.category && item.category_label) lines.push({ text: item.category_label });
  if (e.manufacturer && item.manufacturer) lines.push({ text: item.manufacturer });
  if (e.country && item.country_of_origin) lines.push({ text: `Made in ${item.country_of_origin}` });
  const marks = [e.ce && item.ce_marked ? "CE" : null, e.recyclable && item.recyclable ? "Recyclebaar" : null].filter(Boolean);
  if (marks.length) lines.push({ text: marks.join(" · "), bold: true });
  return lines;
}

export const SAMPLE_ITEM = {
  name: "Voorbeeldproduct Oslo hoekbank",
  sku: "HB-OSLO-01",
  gtin: "8712345678906",
  manufacturer: "Meubelfabriek BV",
  country_of_origin: "Nederland",
  category_label: "Banken",
  ce_marked: true,
  recyclable: true,
  qr_url: "https://qr.veripasso.com/p/9634E4C2-FE21-49AA-953F-26BD83E7D911"
};
