const { PERMISSIONS, hasPermission } = require("../auth/permissions");

// Statusflow en publicatie-checklist voor producten (zie §4 in docs/architecture-roles.md).
// Bewust pure functies zonder database: de regels staan zo op één plek, zijn los te testen
// en de route beslist alleen nog over laden, tenant-scope en opslaan.

const PRODUCT_STATUSES = Object.freeze(["draft", "review", "published", "archived"]);

const P = PERMISSIONS;

// Exacte transitietabel. Alles wat hier niet staat (ook "naar dezelfde status") is een
// 409 INVALID_TRANSITION. `action` is de audit-actie; `permissions` = één daarvan volstaat.
const TRANSITIONS = Object.freeze([
  { from: "draft", to: "review", permissions: [P.PRODUCTS_SUBMIT_REVIEW], action: "submit_review" },
  // Terugsturen: zowel wie ter review aanbiedt als wie publiceert mag dat.
  { from: "review", to: "draft", permissions: [P.PRODUCTS_SUBMIT_REVIEW, P.PRODUCTS_PUBLISH], action: "status_change" },
  { from: "draft", to: "published", permissions: [P.PRODUCTS_PUBLISH], action: "publish", requiresChecklist: true },
  { from: "review", to: "published", permissions: [P.PRODUCTS_PUBLISH], action: "publish", requiresChecklist: true },
  // Depubliceren: public_id blijft staan, zodat een geprinte QR-code bij herpubliceren weer werkt.
  { from: "published", to: "draft", permissions: [P.PRODUCTS_PUBLISH], action: "unpublish" },
  { from: "draft", to: "archived", permissions: [P.PRODUCTS_ARCHIVE], action: "archive" },
  { from: "review", to: "archived", permissions: [P.PRODUCTS_ARCHIVE], action: "archive" },
  { from: "published", to: "archived", permissions: [P.PRODUCTS_ARCHIVE], action: "archive" },
  { from: "archived", to: "draft", permissions: [P.PRODUCTS_ARCHIVE], action: "status_change" }
]);

// Permissies waarmee iemand überhaupt een statuswijziging kan aanvragen. Wie geen van deze
// heeft (viewer, System Owner) krijgt direct 403, los van het product of de doelstatus.
const STATUS_CHANGE_PERMISSIONS = Object.freeze([P.PRODUCTS_SUBMIT_REVIEW, P.PRODUCTS_PUBLISH, P.PRODUCTS_ARCHIVE]);

function findTransition(from, to) {
  return TRANSITIONS.find((transition) => transition.from === from && transition.to === to) || null;
}

// Resultaat in plaats van een exception, zodat deze functie puur blijft:
//   { ok: true, transition } | { ok: false, code: "INVALID_TRANSITION" | "FORBIDDEN" }
// Eerst de tabel, dan de permissie: een onmogelijke overgang is voor iedereen 409.
function canTransition(user, from, to) {
  const transition = findTransition(from, to);
  if (!transition) {
    return { ok: false, code: "INVALID_TRANSITION" };
  }
  if (!transition.permissions.some((permission) => hasPermission(user, permission))) {
    return { ok: false, code: "FORBIDDEN", transition };
  }
  return { ok: true, transition };
}

// Checklist-velden: `field` is de camelCase-naam uit het API-contract, `column` de DB-kolom.
const REQUIRED_FIELDS = Object.freeze([
  { field: "name", column: "name", label: "Productnaam" },
  { field: "sku", column: "sku", label: "SKU / artikelnummer" },
  { field: "manufacturer", column: "manufacturer", label: "Fabrikant" },
  { field: "model", column: "model", label: "Model" },
  { field: "category", column: "category", label: "Categorie" },
  { field: "materials", column: "materials", label: "Materialen" },
  { field: "countryOfOrigin", column: "country_of_origin", label: "Land van herkomst" }
]);

const RECOMMENDED_FIELDS = Object.freeze([
  { field: "complianceInfo", column: "compliance_info", label: "Compliance-informatie" },
  { field: "recyclingInfo", column: "recycling_info", label: "Recyclinginformatie" },
  { field: "repairInfo", column: "repair_info", label: "Reparatie-informatie" }
]);

function hasValue(value) {
  if (value == null) return false;
  return String(value).trim().length > 0;
}

// `product` is een DB-rij (snake_case). `publicDocumentCount` komt uit de documents-repository:
// zo hoeft deze functie zelf niets op te halen. Alleen "required"-items bepalen `ready`;
// aanbevolen items zijn een waarschuwing en blokkeren publiceren niet.
function getChecklist(product, { publicDocumentCount = 0 } = {}) {
  const items = [
    ...REQUIRED_FIELDS.map(({ field, column, label }) => ({
      field,
      label,
      ok: hasValue(product[column]),
      level: "required"
    })),
    ...RECOMMENDED_FIELDS.map(({ field, column, label }) => ({
      field,
      label,
      ok: hasValue(product[column]),
      level: "recommended"
    })),
    {
      field: "publicDocuments",
      label: "Minstens één publiek document",
      ok: Number(publicDocumentCount) > 0,
      level: "recommended"
    }
  ];

  const missing = items.filter((item) => item.level === "required" && !item.ok).map((item) => item.field);

  return { ready: missing.length === 0, items, missing };
}

// Verplichte velden die na een PATCH (camelCase-body over een DB-rij heen) leeg zouden zijn.
// Een gepubliceerd product moet aan de publicatie-eisen blijven voldoen: anders zou de
// publieke pagina (en elke geprinte QR-code) ongemerkt verplichte informatie verliezen.
function getMissingRequiredAfterUpdate(product, changes) {
  return REQUIRED_FIELDS.filter(({ field, column }) => {
    const value = Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== undefined ? changes[field] : product[column];
    return !hasValue(value);
  }).map(({ field }) => field);
}

module.exports = {
  PRODUCT_STATUSES,
  TRANSITIONS,
  STATUS_CHANGE_PERMISSIONS,
  findTransition,
  canTransition,
  getChecklist,
  getMissingRequiredAfterUpdate
};
