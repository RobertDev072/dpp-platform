// Gratis "DPP-check" op de website: geeft met een paar vragen een indicatie of en wanneer
// een product een digitaal productpaspoort nodig heeft. Indicatief, geen juridisch advies;
// datums alleen als ze in een vastgestelde verordening staan, anders "verwacht".
// Stand: oktober 2026. Bij nieuwe gedelegeerde handelingen hier bijwerken.

const CATEGORIES = [
  { id: "battery", nl: "Batterijen (of producten met een batterij)", en: "Batteries (or products with a battery)" },
  { id: "textile", nl: "Kleding en textiel", en: "Apparel and textiles" },
  { id: "metal", nl: "IJzer, staal of aluminium", en: "Iron, steel or aluminium" },
  { id: "tyre", nl: "Banden", en: "Tyres" },
  { id: "furniture", nl: "Meubels of matrassen", en: "Furniture or mattresses" },
  { id: "electronics", nl: "Elektronica en ICT", en: "Electronics and ICT" },
  { id: "construction", nl: "Bouwproducten", en: "Construction products" },
  { id: "toy", nl: "Speelgoed", en: "Toys" },
  { id: "other", nl: "Iets anders", en: "Something else" }
];

const BATTERY_TYPES = [
  { id: "ev", nl: "Batterij voor een elektrische auto", en: "Electric vehicle battery" },
  { id: "lmt", nl: "Batterij voor licht vervoer (e-bike, e-step, scooter)", en: "Light means of transport battery (e-bike, e-scooter)" },
  { id: "industrial-large", nl: "Industriële batterij boven 2 kWh (bijv. thuisbatterij)", en: "Industrial battery above 2 kWh (e.g. home storage)" },
  { id: "other", nl: "Andere batterij (draagbaar, startaccu, industrieel tot 2 kWh)", en: "Other battery (portable, starter, industrial up to 2 kWh)" }
];

const ROLES = [
  { id: "manufacturer", nl: "Fabrikant of merkeigenaar", en: "Manufacturer or brand owner" },
  { id: "importer", nl: "Importeur (van buiten de EU)", en: "Importer (from outside the EU)" },
  { id: "distributor", nl: "Groothandel, winkel of webshop", en: "Distributor, retailer or web shop" }
];

const ESPR = "Verordening (EU) 2024/1781 (ESPR)";
const ESPR_EN = "Regulation (EU) 2024/1781 (ESPR)";

// level: "required" (datum vastgesteld), "expected" (komt eraan, datum nog niet vastgesteld),
// "none" (nu geen verplichting bekend).
const RULES = {
  battery: {
    ev: { level: "required", date: "2027-02-18" },
    lmt: { level: "required", date: "2027-02-18" },
    "industrial-large": { level: "required", date: "2027-02-18" },
    other: { level: "none" }
  },
  textile: { level: "expected", when: { nl: "naar verwachting vanaf 2028–2029", en: "expected from 2028–2029" } },
  metal: { level: "expected", when: { nl: "naar verwachting vanaf 2028", en: "expected from 2028" } },
  tyre: { level: "expected", when: { nl: "naar verwachting vanaf 2028–2029", en: "expected from 2028–2029" } },
  furniture: { level: "expected", when: { nl: "naar verwachting rond 2028–2030", en: "expected around 2028–2030" } },
  electronics: { level: "expected", when: { nl: "gefaseerd, naar verwachting vanaf 2028", en: "phased, expected from 2028" } },
  construction: { level: "expected", when: { nl: "gefaseerd per productfamilie (Bouwproductenverordening)", en: "phased per product family (Construction Products Regulation)" } },
  toy: { level: "expected", when: { nl: "na de overgangsperiode van de nieuwe speelgoedverordening (naar verwachting rond 2030)", en: "after the transition period of the new Toy Safety Regulation (expected around 2030)" } },
  other: { level: "none" }
};

const LEGAL = {
  battery: { nl: "Batterijverordening (EU) 2023/1542, artikel 77", en: "Batteries Regulation (EU) 2023/1542, Article 77" },
  construction: { nl: "Bouwproductenverordening (EU) 2024/3110", en: "Construction Products Regulation (EU) 2024/3110" },
  toy: { nl: "Nieuwe Europese speelgoedverordening", en: "New EU Toy Safety Regulation" }
};

function formatDate(date, lang) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// answers: { category, batteryType?, role, sellsInEu }. Geeft { level, title, text, actions[], legal }.
function evaluate(answers, lang = "nl") {
  const nl = lang === "nl";
  const { category, batteryType, role, sellsInEu } = answers || {};
  if (!CATEGORIES.some((c) => c.id === category)) throw new Error("onbekende categorie");
  if (!ROLES.some((r) => r.id === role)) throw new Error("onbekende rol");
  if (category === "battery" && !BATTERY_TYPES.some((b) => b.id === batteryType)) throw new Error("onbekend batterijtype");

  if (sellsInEu === false) {
    return {
      level: "none",
      title: nl ? "Niet van toepassing zolang je niet in de EU verkoopt" : "Not applicable as long as you don't sell in the EU",
      text: nl
        ? "De regels voor het digitale productpaspoort gelden voor producten die in de Europese Unie op de markt komen. Ga je (ook) in de EU verkopen, doe de check dan opnieuw."
        : "Digital product passport rules apply to products placed on the EU market. If you (also) start selling in the EU, take the check again.",
      actions: [],
      legal: nl ? ESPR : ESPR_EN
    };
  }

  const rule = category === "battery" ? RULES.battery[batteryType] : RULES[category];
  const legal = (LEGAL[category] || { nl: ESPR, en: ESPR_EN })[lang];
  const isMaker = role === "manufacturer" || role === "importer";

  const roleAction = isMaker
    ? (nl ? "Als fabrikant of importeur ben jij verantwoordelijk voor het paspoort: gegevens verzamelen, publiceren en de QR-code op het product of de verpakking." : "As manufacturer or importer you are responsible for the passport: collecting data, publishing it and putting the QR code on the product or packaging.")
    : (nl ? "Als verkoper zorg je dat klanten het paspoort kunnen bekijken, en controleer je of je leveranciers het geregeld hebben." : "As a seller you make sure customers can access the passport, and check that your suppliers have it in place.");

  if (rule.level === "required") {
    return {
      level: "required",
      date: rule.date,
      title: nl ? `Verplicht vanaf ${formatDate(rule.date, lang)}` : `Mandatory from ${formatDate(rule.date, lang)}`,
      text: nl
        ? "Voor dit type batterij is het digitale batterijpaspoort wettelijk verplicht. Elke batterij die vanaf die datum op de markt komt, heeft een eigen paspoort met QR-code nodig."
        : "For this type of battery the digital battery passport is a legal requirement. Every battery placed on the market from that date needs its own passport with a QR code.",
      actions: [
        roleAction,
        nl ? "Breng nu in kaart welke gegevens je nodig hebt: samenstelling, CO₂-voetafdruk, gerecycled materiaal, prestaties en levensduur." : "Map the data you need now: composition, carbon footprint, recycled content, performance and durability.",
        nl ? "Begin op tijd: leveranciersgegevens verzamelen kost vaak maanden." : "Start early: collecting supplier data often takes months."
      ],
      legal
    };
  }

  if (rule.level === "expected") {
    return {
      level: "expected",
      title: nl ? "Komt eraan: bereid je voor" : "Coming soon: get ready",
      text: nl
        ? `Voor deze productgroep wordt het digitale productpaspoort verplicht, ${rule.when.nl}. De precieze eisen en datum staan in een uitvoeringshandeling die nog niet (volledig) is vastgesteld.`
        : `For this product group the digital product passport will become mandatory, ${rule.when.en}. The exact requirements and date will be set in an implementing act that has not been (fully) adopted yet.`,
      actions: [
        roleAction,
        nl ? "Leg je productgegevens nu al centraal vast; dan ben je klaar zodra de eisen definitief zijn." : "Centralise your product data now, so you're ready as soon as the requirements are final.",
        nl ? "Een vrijwillig paspoort laat klanten nu al zien dat je transparant bent." : "A voluntary passport already shows customers today that you are transparent."
      ],
      legal
    };
  }

  return {
    level: "none",
    title: nl ? "Nu nog geen verplichting bekend" : "No obligation known yet",
    text: category === "battery"
      ? (nl ? "Voor dit type batterij is geen batterijpaspoort verplicht. Wel gelden andere regels uit de Batterijverordening, zoals etikettering en een QR-code met informatie." : "No battery passport is required for this type of battery. Other Batteries Regulation rules still apply, such as labelling and a QR code with information.")
      : (nl ? "Voor deze productgroep is (nog) geen datum voor het digitale productpaspoort vastgesteld. De EU breidt de lijst stap voor stap uit; een vrijwillig paspoort is wel al mogelijk." : "No date has been set (yet) for a digital product passport for this product group. The EU is extending the list step by step; a voluntary passport is already possible."),
    actions: [
      nl ? "Volg het nieuws op onze blog: we houden nieuwe productgroepen bij." : "Follow our blog: we track new product groups as they are announced."
    ],
    legal
  };
}

module.exports = { CATEGORIES, BATTERY_TYPES, ROLES, evaluate };
