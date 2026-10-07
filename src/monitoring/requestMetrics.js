// In-memory request-telemetrie. Doel: performance-inzicht zonder externe (betaalde)
// telemetriedienst en zonder de app zelf te vertragen: elke request kost hier alleen
// een paar teller-ophogingen. Persistentie: op Vercel draaien meerdere, kortlevende
// function-instances naast elkaar, dus elke instance telt zijn eigen aggregaten
// hooguit elke minuut op bij system_request_metrics_hourly (flush.js). Wat in het
// geheugen staat (live-minuutgrafiek, recente foutdetails) geldt per instance.
//
// Privacy/veiligheid: er worden uitsluitend route-PATRONEN opgeslagen (id's, GUID's
// en tokens worden genormaliseerd), nooit query strings, headers, bodies of cookies.

const { SCHEDULE } = require("../config/monitoring");

// Histogram-bovengrenzen in ms (log-schaal). Percentielen worden hieruit geschat -
// ruim nauwkeurig genoeg voor dashboards en vele malen goedkoper dan alle
// individuele meetwaarden bewaren.
const HIST_BINS = [5, 10, 25, 50, 100, 200, 400, 700, 1000, 2000, 4000, 8000, 15000, 30000, Infinity];

const MAX_ROUTE_KEYS = 300; // cardinaliteitsrem: daarboven telt alles onder '_overig'
const MINUTES_KEPT = 24 * 60;

const startedAt = Date.now();

let totals = { requests: 0, errors4xx: 0, errors5xx: 0 };

// Per-minuut ringbuffer (24 uur) voor de live/uur-grafieken.
const minuteBuckets = new Map(); // epochMinute -> { count, err4, err5, durSum }

// Per-route-aggregatie sinds de laatste flush (zie flush.js).
let hourRoutes = new Map(); // key scope|method|route -> aggregaat
let hourRoutesStartedAt = null; // tijdstip van de eerste request in hourRoutes

// Recente fouten (ring). Alleen gesaneerde meldingen, nooit bodies/headers.
const recentErrors = [];

function normalizePath(rawUrl) {
  let path = String(rawUrl || "").split("?")[0];
  if (path.length > 200) path = path.slice(0, 200);
  return path
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ":guid")
    .replace(/[0-9a-fA-F]{24,}/g, ":token")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

// Gesaneerde foutmelding: één regel, tokens/lange hexreeksen weggehaald, max 200 tekens.
function sanitizeErrorMessage(message) {
  if (!message) return null;
  return String(message)
    .split("\n")[0]
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, "Bearer [weggelaten]")
    .replace(/[A-Za-z0-9\-_.~+/]{40,}={0,2}/g, "[weggelaten]")
    .slice(0, 200);
}

function binIndex(durationMs) {
  for (let i = 0; i < HIST_BINS.length; i++) {
    if (durationMs <= HIST_BINS[i]) return i;
  }
  return HIST_BINS.length - 1;
}

function record({ scope, method, path, status, durationMs, errorMessage, errorCode }) {
  const now = Date.now();
  const route = normalizePath(path);
  const dur = Math.max(0, Math.round(durationMs));
  const is4xx = status >= 400 && status < 500;
  const is5xx = status >= 500;

  totals.requests += 1;
  if (is4xx) totals.errors4xx += 1;
  if (is5xx) totals.errors5xx += 1;

  // Minuutbucket
  const minute = Math.floor(now / 60000);
  let mb = minuteBuckets.get(minute);
  if (!mb) {
    mb = { count: 0, err4: 0, err5: 0, durSum: 0 };
    minuteBuckets.set(minute, mb);
    // Opruimen: alles ouder dan 24 uur weg (goedkoop, map blijft <= 1441 entries)
    const cutoff = minute - MINUTES_KEPT;
    for (const key of minuteBuckets.keys()) {
      if (key < cutoff) minuteBuckets.delete(key);
    }
  }
  mb.count += 1;
  if (is4xx) mb.err4 += 1;
  if (is5xx) mb.err5 += 1;
  mb.durSum += dur;

  // Route-aggregaat (sinds de laatste flush)
  if (hourRoutesStartedAt === null) hourRoutesStartedAt = now;
  let key = `${scope}|${method}|${route}`;
  if (!hourRoutes.has(key) && hourRoutes.size >= MAX_ROUTE_KEYS) {
    key = `${scope}|${method}|_overig`;
  }
  let agg = hourRoutes.get(key);
  if (!agg) {
    agg = {
      scope,
      method,
      route: key.endsWith("_overig") ? "_overig" : route,
      count: 0,
      err4: 0,
      err5: 0,
      durSum: 0,
      durMax: 0,
      bins: new Array(HIST_BINS.length).fill(0)
    };
    hourRoutes.set(key, agg);
  }
  agg.count += 1;
  if (is4xx) agg.err4 += 1;
  if (is5xx) agg.err5 += 1;
  agg.durSum += dur;
  if (dur > agg.durMax) agg.durMax = dur;
  agg.bins[binIndex(dur)] += 1;

  // Foutenring: 5xx en rate-limits. 401/403/404-ruis (scanners, verlopen sessies)
  // telt wél mee in de aantallen hierboven, maar vervuilt de ring niet.
  if (is5xx || status === 429 || (status === 400 && errorMessage && errorCode)) {
    recentErrors.push({
      timestamp: new Date(now).toISOString(),
      scope,
      method,
      route,
      status,
      durationMs: dur,
      message: sanitizeErrorMessage(errorMessage),
      code: errorCode || null
    });
    if (recentErrors.length > SCHEDULE.recentErrorsBufferSize) recentErrors.shift();
  }
}

// Percentiel geschat uit histogrambins (bovengrens van de bin waarin het percentiel valt).
function percentileFromBins(bins, count, p) {
  if (!count) return null;
  const target = Math.ceil((p / 100) * count);
  let seen = 0;
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i];
    if (seen >= target) return HIST_BINS[i] === Infinity ? 30000 : HIST_BINS[i];
  }
  return null;
}

function combineAggregates(aggs) {
  const out = {
    count: 0, err4: 0, err5: 0, durSum: 0, durMax: 0,
    bins: new Array(HIST_BINS.length).fill(0)
  };
  for (const a of aggs) {
    out.count += a.count;
    out.err4 += a.err4;
    out.err5 += a.err5;
    out.durSum += a.durSum;
    if (a.durMax > out.durMax) out.durMax = a.durMax;
    for (let i = 0; i < out.bins.length; i++) out.bins[i] += a.bins[i];
  }
  return out;
}

function describe(agg) {
  return {
    count: agg.count,
    errors4xx: agg.err4,
    errors5xx: agg.err5,
    avgMs: agg.count ? Math.round(agg.durSum / agg.count) : null,
    maxMs: agg.durMax,
    p50Ms: percentileFromBins(agg.bins, agg.count, 50),
    p95Ms: percentileFromBins(agg.bins, agg.count, 95),
    p99Ms: percentileFromBins(agg.bins, agg.count, 99),
    errorRatePct: agg.count ? Math.round(((agg.err4 + agg.err5) / agg.count) * 10000) / 100 : 0
  };
}

// Leesweergave voor de monitoring-API's.
function getLiveSnapshot() {
  const routes = [...hourRoutes.values()].map((a) => ({
    scope: a.scope,
    method: a.method,
    route: a.route,
    ...describe(a)
  }));

  const perScope = {};
  for (const scope of ["api", "public", "page"]) {
    const combined = combineAggregates([...hourRoutes.values()].filter((a) => a.scope === scope));
    perScope[scope] = describe(combined);
  }
  const overall = describe(combineAggregates([...hourRoutes.values()]));

  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    totalsSinceStart: { ...totals },
    currentHour: { overall, perScope, routes },
    recentErrors: [...recentErrors].reverse()
  };
}

// Minuutserie voor live/uurgrafieken (laatste N minuten).
function getMinuteSeries(minutes) {
  const nowMinute = Math.floor(Date.now() / 60000);
  const series = [];
  for (let m = nowMinute - minutes + 1; m <= nowMinute; m++) {
    const b = minuteBuckets.get(m);
    series.push({
      timestamp: new Date(m * 60000).toISOString(),
      requests: b ? b.count : 0,
      errors: b ? b.err4 + b.err5 : 0,
      avgMs: b && b.count ? Math.round(b.durSum / b.count) : null
    });
  }
  return series;
}

// Begin van het uur (UTC) waarin de nog niet geflushte aggregaten begonnen.
function pendingBucketStart() {
  if (hourRoutesStartedAt === null) return null;
  const bucket = new Date(hourRoutesStartedAt);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

// Flush: aggregaten omzetten naar rijen voor system_request_metrics_hourly en de
// teller resetten. flush.js bepaalt wanneer.
function drainHourRoutes() {
  const drained = [...hourRoutes.values()].map((a) => ({
    scope: a.scope,
    method: a.method,
    route: a.route,
    requestCount: a.count,
    error4xx: a.err4,
    error5xx: a.err5,
    durationSumMs: a.durSum,
    durationMaxMs: a.durMax,
    p50Ms: percentileFromBins(a.bins, a.count, 50),
    p95Ms: percentileFromBins(a.bins, a.count, 95),
    p99Ms: percentileFromBins(a.bins, a.count, 99)
  }));
  hourRoutes = new Map();
  hourRoutesStartedAt = null;
  return drained;
}

module.exports = {
  record,
  normalizePath,
  sanitizeErrorMessage,
  getLiveSnapshot,
  getMinuteSeries,
  drainHourRoutes,
  pendingBucketStart,
  HIST_BINS
};
