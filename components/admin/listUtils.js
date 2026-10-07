// Hulpfuncties voor de admin-lijstpagina's (bedrijven & gebruikers): relatieve
// tijden in het Nederlands, initialen voor avatars en client-side CSV-export.

const RELATIVE_UNITS = [
  { unit: "year", seconds: 31536000 },
  { unit: "month", seconds: 2592000 },
  { unit: "week", seconds: 604800 },
  { unit: "day", seconds: 86400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 }
];

export function formatRelativeTime(value, emptyLabel = "—") {
  if (!value) {
    return emptyLabel;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return emptyLabel;
  }
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(diffSeconds) < 60) {
    return "zojuist";
  }
  const formatter = new Intl.RelativeTimeFormat("nl-NL", { numeric: "auto" });
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.trunc(diffSeconds / seconds), unit);
    }
  }
  return "zojuist";
}

// Initialen voor een avatar/logo-blok: eerste letters van het eerste en laatste
// woord, of de eerste twee letters bij één woord.
export function initialsOf(...parts) {
  const words = parts.filter(Boolean).join(" ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// CSV met puntkomma's (Excel met nl-NL-instellingen) en een UTF-8 BOM zodat
// accenten goed openen in Excel.
export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  const blob = new Blob(["﻿", lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
