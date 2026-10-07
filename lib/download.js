// Bestanden in de browser maken en laten downloaden (CSV/XLSX/blob). Er gaat niets
// via de server, dus ook grote exports raken de 4,5 MB-limiet van Vercel niet.

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Voorkom formule-injectie in Excel (=, +, -, @ aan het begin).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Puntkomma als scheidingsteken + BOM: opent direct goed in een Nederlandse Excel.
export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))];
  return `﻿${lines.join("\r\n")}`;
}

export function downloadCsv(fileName, headers, rows) {
  downloadBlob(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }), fileName);
}

export async function downloadXlsx(fileName, sheets) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const blob = await writeExcelFile(sheets).toBlob();
  downloadBlob(blob, fileName);
}

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
