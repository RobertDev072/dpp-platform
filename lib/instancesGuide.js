// Teksten en regels voor het tabblad "Batches & exemplaren". Los van de component, zodat
// de regels (wanneer knoppen uit staan, welke meldingen, de bevestigingsteksten) getest
// kunnen worden zonder browser.

const HELP = {
  lot: "Het nummer van een productieronde. Alleen letters, cijfers, - en _. Maximaal 20 tekens.",
  prefix: "Komt vóór elk serienummer. Voorbeeld: SN- geeft SN-00001, SN-00002.",
  start: "Het eerste nummer. Heb je al SN-00001 t/m SN-00100? Begin dan bij 101.",
  batchLink: "Optioneel. Dan staat bij elk exemplaar ook uit welke productieronde het komt.",
  dataMatrix:
    "Een kleine vierkante code voor kleine onderdelen. Wordt gelezen met een zakelijke scanner, niet met een gewone telefooncamera. Voor consumenten altijd de QR-code gebruiken."
};

const NOT_PUBLISHED = "Publiceer eerst je product. Pas daarna werken de QR-codes van batches en exemplaren.";
const NO_GTIN =
  "Je product heeft geen GTIN (barcode-nummer). Je codes werken wel, maar krijgen geen officieel GS1-adres. Voor batterijen en de meeste winkels heb je een GTIN nodig. Die vraag je aan bij GS1 Nederland.";

// Welke meldingen en of aanmaken kan, op basis van het product.
function instanceGuide(product) {
  const published = Boolean(product?.published_at);
  const hasGtin = Boolean(String(product?.gtin || "").trim());
  const notices = [];
  if (!published) notices.push({ tone: "warning", key: "not-published", text: NOT_PUBLISHED });
  if (!hasGtin) notices.push({ tone: "info", key: "no-gtin", text: NO_GTIN });
  return { canCreate: published, notices };
}

// Aantal exemplaren dat het formulier zal aanmaken (dubbele serienummers in een eigen lijst
// tellen één keer; de server slaat bestaande nummers over).
function plannedItemCount({ mode, count, list }) {
  if (mode === "generate") return Math.max(0, Number.parseInt(count, 10) || 0);
  return new Set(String(list || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)).size;
}

const itemsConfirmMessage = (count) =>
  `Je maakt ${count} ${count === 1 ? "exemplaar" : "exemplaren"} aan. Elk krijgt een eigen QR-code die direct online staat en nooit verandert. Doorgaan?`;
const BATCH_CONFIRM = "Je maakt een batch aan met een eigen QR-code die direct online staat. Doorgaan?";
const itemsCreatedMessage = (count) =>
  `${count} ${count === 1 ? "exemplaar" : "exemplaren"} aangemaakt en online. Download de QR-codes voor je drukker.`;

module.exports = { HELP, NOT_PUBLISHED, NO_GTIN, instanceGuide, plannedItemCount, itemsConfirmMessage, BATCH_CONFIRM, itemsCreatedMessage };
