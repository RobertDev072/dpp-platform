// Centrale, later aanpasbare drempelwaarden voor het monitoringdashboard.
// Alles in één plek zodat de Platform Owner (of een toekomstige instellingen-
// pagina) ze kan bijstellen zonder door de codebase te hoeven zoeken.

const THRESHOLDS = {
  // API-responstijden (P95, in ms): groen < warn, oranje tussen warn en crit, rood > crit.
  apiP95Ms: { warn: 500, crit: 1000 },
  // Publieke paspoortpagina's zijn het visitekaartje: iets strenger.
  publicP95Ms: { warn: 400, crit: 800 },
  // Databasequeryduur (P95, ms) op basis van DMV's/healthcheck.
  dbP95Ms: { warn: 500, crit: 2000 },
  // Foutpercentage over alle requests (in %).
  errorRatePct: { warn: 1, crit: 2 },
  // Databasecapaciteit (gebruikt % van max).
  dbCapacityPct: { warn: 70, high: 85, crit: 95 },
  // Healthcheck-latency (ms) per afhankelijkheid voordat "traag" gemeld wordt.
  healthLatencyMs: { warn: 1500, crit: 5000 },
  // Waarschuwing wanneer de capaciteitsgrens naar verwachting binnen X dagen valt.
  capacityForecastWarnDays: 90,
  // Geheugen: % van het geheugenbudget van een Vercel Function (standaard 2 GB);
  // indicatief, en per instance.
  memoryRssPct: { warn: 70, crit: 85 }
};

// Verzamelcadans. Elke function-instance telt zijn telemetrie hooguit elke minuut op
// bij de uurrij (flush.js); de dagelijkse snapshot (Vercel Cron) doet de zwaardere
// metingen (tabelgroottes, opslag) één keer per dag.
const SCHEDULE = {
  flushIntervalMs: 60 * 1000,
  snapshotMinAgeHours: 22,
  hourlyRetentionDays: 90,
  snapshotRetentionDays: 400,
  recentErrorsBufferSize: 100
};

module.exports = { THRESHOLDS, SCHEDULE };
