// Leest een CSV- of XLSX-bestand in de browser naar { headers, rows } (rows = arrays).
// Er gaat geen bestand naar de server: alleen de gekoppelde rijen, in blokken.
export const MAX_IMPORT_ROWS = 20000;

function decodeText(buffer) {
  // Excel op Windows bewaart CSV vaak als Windows-1252; probeer eerst strikt UTF-8.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  return value;
}

function toTable(matrix) {
  const rows = matrix.map((row) => (Array.isArray(row) ? row.map(cellValue) : []));
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell !== null));
  if (headerIndex === -1) return { headers: [], rows: [], headerRowNumber: 1 };
  const headers = rows[headerIndex].map((h, i) => (h === null ? `Kolom ${i + 1}` : String(h)));
  const dataRows = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    if (rows[i].some((cell) => cell !== null)) dataRows.push({ rowNumber: i + 1, cells: rows[i] });
  }
  return { headers, rows: dataRows, headerRowNumber: headerIndex + 1 };
}

export async function readImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) {
    throw new Error("Het oude Excel-formaat (.xls) wordt niet ondersteund. Sla het bestand in Excel op als .xlsx of .csv en probeer opnieuw.");
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("Het bestand is groter dan 50 MB. Splits het in kleinere bestanden.");
  }

  let table;
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/universal");
    table = toTable(await readSheet(file));
  } else if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    const Papa = (await import("papaparse")).default;
    const text = decodeText(await file.arrayBuffer());
    const parsed = Papa.parse(text, { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t", "|"] });
    if (parsed.errors?.length && !parsed.data?.length) throw new Error("Het CSV-bestand kon niet gelezen worden.");
    table = toTable(parsed.data);
  } else {
    throw new Error("Kies een .xlsx- of .csv-bestand.");
  }

  if (!table.headers.length) throw new Error("Het bestand is leeg: geen kolomkoppen gevonden.");
  if (!table.rows.length) throw new Error("Het bestand bevat alleen kolomkoppen, geen producten.");
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Het bestand bevat ${table.rows.length.toLocaleString("nl-NL")} rijen; het maximum per import is ${MAX_IMPORT_ROWS.toLocaleString("nl-NL")}. Splits het bestand.`);
  }
  return table;
}
