// Centrale NL-formatteringshelpers voor cijfers, bytes, duur en tijdstippen.
// Eén plek zodat het hele dashboard (en toekomstige pagina's) identiek formatteert:
// komma's als decimaalteken, punten voor duizendtallen (nl-NL).

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

function nlNumber(value, { min = 0, max = 0 } = {}) {
  return Number(value).toLocaleString("nl-NL", {
    minimumFractionDigits: min,
    maximumFractionDigits: max
  });
}

export function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return nlNumber(value);
}

// Bytes: < 1 KB in B, < 1 MB in KB, < 1 GB in MB (1 decimaal), anders GB (2 decimalen).
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return "—";
  const abs = Math.abs(Number(bytes));
  if (abs < KB) return `${nlNumber(bytes)} B`;
  if (abs < MB) return `${nlNumber(bytes / KB)} KB`;
  if (abs < GB) return `${nlNumber(bytes / MB, { min: 1, max: 1 })} MB`;
  return `${nlNumber(bytes / GB, { min: 2, max: 2 })} GB`;
}

// Groeicijfers: expliciet teken zodat krimp ook zichtbaar is.
export function formatBytesSigned(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return "—";
  const num = Number(bytes);
  if (num === 0) return "0 B";
  return `${num > 0 ? "+" : "−"}${formatBytes(Math.abs(num))}`;
}

// Duur in ms; vanaf 1 seconde als "1,2 s".
export function formatMs(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "—";
  const num = Number(ms);
  if (num >= 1000) return `${nlNumber(num / 1000, { min: 1, max: 1 })} s`;
  return `${nlNumber(Math.round(num))} ms`;
}

export function formatPct(value, decimals = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${nlNumber(value, { max: decimals })}%`;
}

// Uptime: "3 d 18 u", onder een dag "18 u 32 m", onder een uur "32 m".
export function formatUptime(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(Number(totalSeconds))) return "—";
  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} u`;
  if (hours > 0) return `${hours} u ${minutes} m`;
  return `${minutes} m`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

// Met seconden, voor foutenlogs en meetmomenten.
export function formatDateTimeSec(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "medium" });
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export function formatTimeShort(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayMonth(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}
