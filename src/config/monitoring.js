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
  // Geheugen: % van het geheugenbudget van de container (CONTAINER_MEMORY_MB,
  // gezet door de ECS-taakdefinitie); indicatief.
  memoryRssPct: { warn: 70, crit: 85 }
};

// Verzamelcadans. Telemetrie wordt elke paar minuten weggeschreven; het dagelijkse
// onderhoud (snapshot, opschonen, paspoortversies aanvullen) draait in het
// serverproces onder een advisory lock (zie monitoring/scheduler.js).
const SCHEDULE = {
  flushIntervalMs: 5 * 60 * 1000,
  snapshotMinAgeHours: 22,
  hourlyRetentionDays: 90,
  snapshotRetentionDays: 400,
  recentErrorsBufferSize: 100,
  maintenanceInitialDelayMs: 2 * 60 * 1000,
  maintenanceCheckIntervalMs: 60 * 60 * 1000,
  versionBackfillBatch: 500
};

module.exports = { THRESHOLDS, SCHEDULE };
