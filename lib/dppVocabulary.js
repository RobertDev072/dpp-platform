// Eigen VeriPasso-termen voor dictionaryReference (…/vocab/dpp#<id>). Gedeeld door de
// publieke vocabulairepagina en de API (/api/v1/vocab). Alleen toevoegen, nooit
// hernoemen of verwijderen: oude paspoortversies verwijzen er blijvend naar.
const DPP_VOCABULARY = [
  { id: "DigitalProductPassport", type: "klasse", definition: "Een digitaal productpaspoort: de gegevens over één productmodel, één batch of één exemplaar." },
  { id: "digitalProductPassportId", type: "URI (urn:uuid)", definition: "Permanente, unieke identificatie van dit paspoort. Wordt nooit hergebruikt of gewijzigd." },
  { id: "uniqueProductIdentifier", type: "URI", definition: "Identificatie van het product waarop het paspoort betrekking heeft: een GS1 Digital Link (GTIN, met lot- en serienummer bij batch/item) of, zonder GTIN, de urn:uuid van het paspoort." },
  { id: "granularity", type: "tekst: model | batch | item", definition: "Niveau van het paspoort: productmodel, productiebatch of individueel exemplaar." },
  { id: "dppSchemaVersion", type: "tekst (semver)", definition: "Versie van de VeriPasso-paspoortstructuur waarin dit document is opgesteld." },
  { id: "dppStatus", type: "tekst: Active | Archived", definition: "Active: het product is op de markt. Archived: niet meer op de markt; het paspoort blijft raadpleegbaar." },
  { id: "lastUpdated", type: "datum-tijd (ISO 8601, UTC)", definition: "Moment van de laatste wijziging van de paspoortgegevens." },
  { id: "economicOperatorId", type: "tekst", definition: "Identificatie van de verantwoordelijke marktdeelnemer, volgens economicOperatorIdScheme." },
  { id: "economicOperatorIdScheme", type: "tekst: lei | gln | eori | vat | duns | kvk | other", definition: "Schema van economicOperatorId (LEI volgens ISO 17442, GLN volgens GS1, enz.)." },
  { id: "facilityId", type: "tekst", definition: "Identificatie van de productielocatie (bijv. een GLN)." },
  { id: "contentSpecificationIds", type: "lijst van tekst", definition: "Verwijzingen naar de wetgeving, gedelegeerde handelingen of normen waaraan de inhoud van dit paspoort is opgesteld." },
  { id: "dataElements", type: "lijst", definition: "Alle gevulde datavelden, elk met elementId, value, dictionaryReference en waar van toepassing unitCode (UN/CEFACT Rec. 20)." },
  { id: "MultiLanguageDataElement", type: "klasse", definition: "Dataveld met een waarde per taal: een lijst van { language (BCP 47, bijv. nl-NL), value }." },
  { id: "relatedResources", type: "lijst", definition: "Bijlagen bij het paspoort (handleidingen, certificaten), met resourceType, title, mimeType, language en een downloadbare url." },
  { id: "co2FootprintKg", type: "getal", unit: "KGM (kg CO2-equivalent)", definition: "Koolstofvoetafdruk van het product over de levenscyclus, in kilogram CO2-equivalent." },
  { id: "co2ReductionPct", type: "getal", unit: "P1 (procent)", definition: "Reductie van de koolstofvoetafdruk ten opzichte van de referentie van de fabrikant." },
  { id: "recycledMaterialPct", type: "getal", unit: "P1 (procent)", definition: "Aandeel gerecycled materiaal in het product, als percentage van het gewicht." },
  { id: "materials", type: "lijst", definition: "Materialen waaruit het product bestaat, zoals opgegeven door de fabrikant." },
  { id: "recyclable", type: "ja/nee", definition: "Of het product volgens de fabrikant recyclebaar is." },
  { id: "reachConform", type: "ja/nee", definition: "Of het product volgens de fabrikant voldoet aan REACH (Verordening (EG) 1907/2006)." },
  { id: "rohsConform", type: "ja/nee", definition: "Of het product volgens de fabrikant voldoet aan RoHS (Richtlijn 2011/65/EU)." },
  { id: "expectedLifespanYears", type: "getal", unit: "ANN (jaar)", definition: "Verwachte levensduur van het product in jaren." },
  { id: "epdUrl", type: "URL", definition: "Link naar de milieuproductverklaring (EPD)." },
  { id: "ceMarked", type: "ja/nee", definition: "Of het product een CE-markering draagt." },
  { id: "applicableRegulations", type: "lijst van tekst", definition: "Wetgeving en normen die volgens de fabrikant op het product van toepassing zijn." }
];

module.exports = { DPP_VOCABULARY };
