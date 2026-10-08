// Frontend-kant van de compleetheid: labels en de editor-sectie per criterium. De
// score zelf komt altijd van de server (src/utils/completeness.js), zodat lijst,
// filter, dashboard en editor hetzelfde getal tonen.

export const COMPLETENESS_ITEMS = [
  { key: "identification", label: "Identificatie (SKU of GTIN)", tab: "basis", field: "sku" },
  { key: "category", label: "Categorie", tab: "basis", field: "categoryLabel" },
  { key: "description", label: "Omschrijving", tab: "basis", field: "description" },
  { key: "photo", label: "Productafbeelding", tab: "basis", field: "photo" },
  { key: "sustainability", label: "Duurzaamheid", tab: "sustainability" },
  { key: "compliance", label: "Compliance", tab: "compliance" },
  { key: "documents", label: "Minimaal één document", tab: "documents" }
];

export function missingItems(checks = {}) {
  return COMPLETENESS_ITEMS.filter((item) => !checks[item.key]);
}

export const MISSING_FILTER_LABELS = {
  photo: "zonder foto",
  description: "zonder omschrijving",
  category: "zonder categorie",
  identification: "zonder SKU/GTIN",
  sustainability: "zonder duurzaamheidsgegevens",
  compliance: "zonder compliancegegevens",
  documents: "zonder documenten"
};
