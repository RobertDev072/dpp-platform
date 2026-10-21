// Productgroepen voor het EU DPP-register. Gedeeld door de app (keuzelijst, registerkaart)
// en de server (validatie, overzicht voor handmatige invoer). Het register opent per
// productgroep; eerst batterijen (batterijpaspoort verplicht vanaf 18 februari 2027).
// eu: de Engelse naam zoals in het register; registryOpen: aanmelden is voor deze groep
// aan de orde (de registerkaart staat dan open en actief).
const PRODUCT_GROUPS = [
  { key: "battery", label: "Batterij", eu: "Batteries", registryOpen: true },
  { key: "textile", label: "Textiel", eu: "Textiles", registryOpen: false },
  { key: "iron_steel", label: "IJzer & staal", eu: "Iron and steel", registryOpen: false },
  { key: "aluminium", label: "Aluminium", eu: "Aluminium", registryOpen: false },
  { key: "tyres", label: "Banden", eu: "Tyres", registryOpen: false },
  { key: "furniture", label: "Meubels", eu: "Furniture", registryOpen: false },
  { key: "other", label: "Overig", eu: "Other", registryOpen: false },
  { key: "unknown", label: "Nog niet bekend", eu: "", registryOpen: false }
];

const PRODUCT_GROUP_KEYS = PRODUCT_GROUPS.map((g) => g.key);

function productGroup(key) {
  return PRODUCT_GROUPS.find((g) => g.key === key) || PRODUCT_GROUPS[PRODUCT_GROUPS.length - 1];
}

module.exports = { PRODUCT_GROUPS, PRODUCT_GROUP_KEYS, productGroup };
