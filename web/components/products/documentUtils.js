// Gedeelde helpers voor productdocumenten. Bewust zonder "use client": zowel de
// client-side Documenten-tab als het server-gerenderde publieke paspoort gebruiken dit.

export const DOCUMENT_CATEGORY_LABELS = {
  document: "Document",
  manual: "Handleiding",
  video: "Video",
  "3d_model": "3D-model"
};

export const DOCUMENT_CATEGORY_OPTIONS = [
  { value: "document", label: "Document" },
  { value: "manual", label: "Handleiding" },
  { value: "video", label: "Video" },
  { value: "3d_model", label: "3D-model" }
];

// Geeft het Nederlandse label, of een lege string als er geen categorie is —
// de aanroeper bepaalt zelf de placeholder ("—" in de tabel, weglaten op het paspoort).
export function documentCategoryLabel(category) {
  return DOCUMENT_CATEGORY_LABELS[category] || category || "";
}

// Bestandsgrootte in bytes -> "1,2 MB" / "340 kB" (Nederlandse decimaalkomma).
export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (bytes == null || Number.isNaN(size) || size < 0) {
    return "—";
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} kB`;
  }
  return `${size} B`;
}
