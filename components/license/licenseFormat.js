// Kleine gedeelde formatters voor licentiegegevens.

// Backend levert "YYYY-MM-DD" of een volledige ISO-string; we tonen dd-mm-jjjj.
export function formatDateNL(value) {
  if (!value) {
    return null;
  }
  const isoDate = String(value).slice(0, 10);
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${day}-${month}-${year}`;
}

// "1-1-2026 t/m 31-12-2026", een halve variant, of "—" als beide leeg zijn.
export function formatValidity(licenseStart, licenseEnd) {
  const start = formatDateNL(licenseStart);
  const end = formatDateNL(licenseEnd);
  if (start && end) return `${start} t/m ${end}`;
  if (start) return `vanaf ${start}`;
  if (end) return `t/m ${end}`;
  return "—";
}

// Datumwaarde uit de API terugbrengen naar "YYYY-MM-DD" voor <input type="date">.
export function toDateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

// Compacte verbruikssamenvatting: "gebruikers 5/5 · producten 12/300".
export function usageSummary(usage) {
  const part = (label, item) =>
    item.max == null ? `${label} ${item.used}` : `${label} ${item.used}/${item.max}`;
  return `${part("gebruikers", usage.users)} · ${part("producten", usage.products)}`;
}

// Prijs in centen -> "€ 149 / maand" (null = onbekend).
export function formatPrice(cents) {
  if (cents == null) return null;
  const euros = Number(cents) / 100;
  return `${euros.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: euros % 1 ? 2 : 0 })} / maand`;
}

// Bytes -> "2,8 GB" / "340 MB".
export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${Math.round(n / 1024).toLocaleString("nl-NL")} kB`;
  return `${n} B`;
}
