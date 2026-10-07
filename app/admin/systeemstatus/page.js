"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import LineChart from "@/components/monitoring/LineChart";
import StatusBadge, {
  ValueBadge,
  levelForValue,
  worstLevel
} from "@/components/monitoring/StatusBadge";
import { documentCategoryLabel } from "@/components/products/documentUtils";
import {
  formatBytes,
  formatBytesSigned,
  formatDate,
  formatDateTime,
  formatDateTimeSec,
  formatDayMonth,
  formatMs,
  formatNumber,
  formatPct,
  formatTimeShort,
  formatUptime
} from "@/lib/format";

// Vaste serieskleuren (gevalideerd kleurenpaar; nooit wisselen bij filteren):
// database = blauw, blob = oranje. Statuskleuren (groen/oranje/rood) zijn
// gereserveerd voor statussen en drempeloverschrijdingen, nooit voor series.
const CHART_BLUE = "#2a78d6";
const CHART_ORANGE = "#eb6834";

// Een Vercel Function heeft standaard 2 GB geheugen; indicatief budget voor de RSS-balk.
const FUNCTION_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;

const PERIOD_OPTIONS = [
  { key: "live", label: "Live" },
  { key: "1h", label: "1 uur" },
  { key: "24h", label: "24 uur" },
  { key: "7d", label: "7 dagen" },
  { key: "30d", label: "30 dagen" },
  { key: "90d", label: "90 dagen" },
  { key: "1y", label: "1 jaar" }
];

const GROWTH_RANGE_OPTIONS = [
  { key: "7d", label: "7 dagen" },
  { key: "30d", label: "30 dagen" },
  { key: "90d", label: "90 dagen" },
  { key: "1y", label: "1 jaar" },
  { key: "all", label: "Alles" }
];

const OVERALL_BANNER = {
  ok: {
    label: "Alles operationeel",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500"
  },
  degraded: {
    label: "Verminderde prestaties",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500"
  },
  down: {
    label: "Storing",
    className: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500"
  }
};

// ---------------------------------------------------------------------------
// Kleine bouwstenen
// ---------------------------------------------------------------------------

function Section({ title, aside, children }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// Per-sectie laad-/foutafhandeling: één falende sectie blokkeert de rest niet.
function SectionBody({ state, skeletonClass = "h-40", children }) {
  if (!state.data && state.error) {
    return (
      <Card className="border-red-200 bg-red-50 text-sm text-red-700">
        Kon niet laden: {state.error}
      </Card>
    );
  }
  if (!state.data) {
    return (
      <Card>
        <Skeleton className={`w-full ${skeletonClass}`} />
      </Card>
    );
  }
  return children(state.data);
}

function PeriodButtons({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === option.key
              ? "bg-blue-600 text-white"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const KPI_TONES = {
  default: "text-slate-900",
  warn: "text-amber-600",
  crit: "text-red-600"
};

// KPI-tegel in de stijl van AdminStatTile; null → "Nog geen gegevens".
function Kpi({ label, value, sub, note, tone = "default" }) {
  const missing = value == null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`text-2xl font-bold tabular-nums ${
          missing ? "text-slate-400" : KPI_TONES[tone] || KPI_TONES.default
        }`}
      >
        {missing ? "—" : value}
      </div>
      <div className="text-sm text-slate-500">{label}</div>
      {(missing || sub) && (
        <div className="mt-0.5 text-xs text-slate-400">{missing ? "Nog geen gegevens" : sub}</div>
      )}
      {!missing && note && (
        <div className="mt-1 text-[11px] leading-snug text-slate-400">{note}</div>
      )}
    </div>
  );
}

// Voortgangsbalk (meter): vulling draagt de ernst, spoor blijft neutraal.
const METER_COLORS = {
  ok: "bg-blue-500",
  degraded: "bg-amber-500",
  high: "bg-orange-500",
  down: "bg-red-500"
};

function MeterBar({ pct, level = "ok", label }) {
  const value = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div
        className={`h-full rounded-full transition-all ${METER_COLORS[level] || METER_COLORS.ok}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function WarningIcon({ className = "" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d="M10 3.2 2.6 16h14.8L10 3.2Z" />
      <path d="M10 8.2v4" />
      <path d="M10 14.6h.01" />
    </svg>
  );
}

// Statuskaart voor één platformcomponent.
function ComponentCard({ name, status, statusLabel, note, rows = [], lastError }) {
  const visibleRows = rows.filter(([, v]) => v != null);
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-900">{name}</h3>
        <StatusBadge status={status} label={statusLabel} />
      </div>
      {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
      {visibleRows.length > 0 && (
        <dl className="mt-2 space-y-1">
          {visibleRows.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 text-xs">
              <dt className="text-slate-500">{key}</dt>
              <dd className="text-right tabular-nums text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {lastError && (
        <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          Laatste fout: {lastError.message}
          <span className="text-red-400"> ({formatDateTime(lastError.at)})</span>
        </p>
      )}
    </Card>
  );
}

function ChartCard({ title, children }) {
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </Card>
  );
}

function NoChartData({ text = "Nog geen gegevens voor deze periode." }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

// Infokader wanneer de monitoring pas net draait (te weinig meetpunten).
function MonitoringStartInfo({ since, onMeasure, measuring }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
      <p>
        {since
          ? `Monitoring gestart op ${formatDate(since)}. Historische gegevens worden vanaf nu verzameld; 7/30/90-dagenanalyses komen vanzelf beschikbaar.`
          : "Er zijn nog geen metingen vastgelegd. Historische gegevens worden vanaf de eerste meting verzameld; 7/30/90-dagenanalyses komen vanzelf beschikbaar."}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-3 bg-white px-3 py-1.5 text-xs"
        onClick={onMeasure}
        disabled={measuring}
      >
        {measuring ? "Bezig met meten…" : "Nu meten"}
      </Button>
    </div>
  );
}

// Endpointtabel (langzaamste/snelste). Cijfers rechts uitgelijnd, tabular-nums.
function EndpointTable({ rows }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">Nog geen requests gemeten in deze periode.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2 pr-3 font-medium">Endpoint</th>
            <th className="py-2 pr-3 font-medium">Methode</th>
            <th className="py-2 pr-3 text-right font-medium">Requests</th>
            <th className="py-2 pr-3 text-right font-medium">Gem.</th>
            <th className="py-2 pr-3 text-right font-medium">P95</th>
            <th className="py-2 pr-3 text-right font-medium">P99</th>
            <th className="py-2 pr-3 text-right font-medium">Fouten</th>
            <th className="py-2 text-right font-medium">Foutratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.scope}-${row.method}-${row.route}`}
              className="border-b border-slate-100"
            >
              <td className="max-w-[18rem] py-2 pr-3">
                <code
                  className="block truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                  title={`${row.route} (${row.scope})`}
                >
                  {row.route}
                </code>
              </td>
              <td className="py-2 pr-3">
                <Badge variant="neutral">{row.method}</Badge>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.requests)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMs(row.avgMs)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMs(row.p95Ms)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMs(row.p99Ms)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.errors)}</td>
              <td className="py-2 text-right tabular-nums">{formatPct(row.errorRatePct, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuratie-sectie (Supabase + secrets + basis-URL's).
// ---------------------------------------------------------------------------

// Statusindicator in de handgetekende iconenstijl: groen vinkje = aanwezig/ok,
// rood kruisje = ontbreekt.
function StatusIcon({ ok }) {
  if (ok) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-emerald-600"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.5" />
        <path d="m6.5 10.3 2.4 2.4 4.6-5.2" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-red-600"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6" />
    </svg>
  );
}

// Eén regel in een configuratiekaart: label + waarde (of aanwezig/ontbreekt).
function StatusRow({ label, ok, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">
        {value ? (
          <code className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
            {value}
          </code>
        ) : (
          <span className={`text-xs font-medium ${ok ? "text-emerald-700" : "text-red-600"}`}>
            {ok ? "Aanwezig" : "Ontbreekt"}
          </span>
        )}
        <StatusIcon ok={ok} />
      </span>
    </div>
  );
}

function ConfigSectionBadge({ ok, okLabel, notOkLabel }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      }`}
    >
      <StatusIcon ok={ok} />
      {ok ? okLabel : notOkLabel}
    </span>
  );
}

function ConfigStatusCards({ status }) {
  const supabase = status?.supabase;
  if (!supabase) {
    return <p className="text-sm text-slate-500">Geen configuratiegegevens beschikbaar.</p>;
  }
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Supabase — Auth, Storage en database</h3>
            <ConfigSectionBadge
              ok={supabase.configured && supabase.databaseUrlSet}
              okLabel="Geconfigureerd"
              notOkLabel="Niet volledig"
            />
          </div>
          <div className="divide-y divide-slate-100">
            <StatusRow label="Project-URL (SUPABASE_URL)" ok={Boolean(supabase.url)} value={supabase.url} />
            <StatusRow label="Service-role-key" ok={supabase.serviceRoleKeySet} />
            <StatusRow label="Anon-key (optioneel)" ok={supabase.anonKeySet} />
            <StatusRow label="Database (DATABASE_URL)" ok={supabase.databaseUrlSet} />
            <StatusRow label="Bucket foto's" ok={Boolean(supabase.imagesBucket)} value={supabase.imagesBucket} />
            <StatusRow label="Bucket documenten" ok={Boolean(supabase.documentsBucket)} value={supabase.documentsBucket} />
          </div>
          {supabase.missingVars?.length > 0 && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
              Ontbrekende variabelen: {supabase.missingVars.join(", ")}
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Secrets (Vercel)</h3>
            <ConfigSectionBadge
              ok={status.cookieSecretSet && status.cronSecretSet}
              okLabel="Aanwezig"
              notOkLabel="Niet volledig"
            />
          </div>
          <div className="divide-y divide-slate-100">
            <StatusRow label="COOKIE_SECRET" ok={Boolean(status.cookieSecretSet)} />
            <StatusRow label="CRON_SECRET (dagelijkse monitoring-cron)" ok={Boolean(status.cronSecretSet)} />
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Basis-URL&apos;s</h3>
        <div className="divide-y divide-slate-100">
          <StatusRow
            label="App-basis-URL (APP_BASE_URL)"
            ok={Boolean(status.appBaseUrl)}
            value={status.appBaseUrl}
          />
          <StatusRow
            label="QR-basis-URL (QR_BASE_URL)"
            ok={Boolean(status.qrBaseUrl)}
            value={status.qrBaseUrl}
          />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Deze URL&apos;s bepalen welke hostnaam in activatielinks en op QR-codes terechtkomt.
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Afgeleide helpers
// ---------------------------------------------------------------------------

function containerLabel(name) {
  const lower = String(name).toLowerCase();
  if (lower.includes("image") || lower.includes("foto")) return "Productfoto's";
  if (lower.includes("document")) return "Documenten";
  return name;
}

function capacityLevel(pct, thresholds) {
  if (pct == null || !thresholds) return "ok";
  if (pct >= thresholds.crit) return "down";
  if (pct >= thresholds.high) return "high";
  if (pct >= thresholds.warn) return "degraded";
  return "ok";
}

function countValid(values) {
  return values.reduce((sum, v) => (v != null ? sum + 1 : sum), 0);
}

// ---------------------------------------------------------------------------
// De pagina
// ---------------------------------------------------------------------------

export default function SysteemstatusPage() {
  const toast = useToast();

  // Periode-kiezer: geldt voor Performance en Fouten. "Live" = 1-uursdata met
  // auto-refresh (60 s) van overview/health/performance/errors.
  const [period, setPeriod] = useState("live");
  const effectivePeriod = period === "live" ? "1h" : period;

  // Groeigrafieken hebben eigen bereikknoppen, losgekoppeld van de periode-kiezer.
  const [growthRange, setGrowthRange] = useState("30d");

  const [health, setHealth] = useState({ data: null, error: null });
  const [overview, setOverview] = useState({ data: null, error: null });
  const [perf, setPerf] = useState({ data: null, error: null });
  const [db, setDb] = useState({ data: null, error: null });
  const [growth, setGrowth] = useState({ data: null, error: null });
  const [storage, setStorage] = useState({ data: null, error: null });
  const [usage, setUsage] = useState({ data: null, error: null });
  const [errorsState, setErrorsState] = useState({ data: null, error: null });
  const [infra, setInfra] = useState({ data: null, error: null });
  const [config, setConfig] = useState({ data: null, error: null });

  const [expandedError, setExpandedError] = useState(null);
  const [measuring, setMeasuring] = useState(false);

  // Bij een refresh blijft de vorige weergave staan (geen flits); bij een fout
  // behouden we eerdere data zodat één mislukte poll de sectie niet leegtrekt.
  const fetchInto = useCallback((url, setState) => {
    return api
      .get(url)
      .then((data) => setState({ data, error: null }))
      .catch((err) => setState((prev) => ({ data: prev.data, error: err.message })));
  }, []);

  // Eerste laadbeurt: alles parallel, met per-sectie foutafhandeling.
  useEffect(() => {
    Promise.all([
      fetchInto("/api/admin/system/health", setHealth),
      fetchInto("/api/admin/system/overview", setOverview),
      fetchInto("/api/admin/system/database", setDb),
      fetchInto("/api/admin/system/storage", setStorage),
      fetchInto("/api/admin/system/usage", setUsage),
      fetchInto("/api/admin/system/infra", setInfra),
      fetchInto("/api/admin/config-status", setConfig)
    ]);
  }, [fetchInto]);

  // Performance + fouten volgen de gekozen periode.
  useEffect(() => {
    Promise.all([
      fetchInto(`/api/admin/system/performance?period=${effectivePeriod}`, setPerf),
      fetchInto(`/api/admin/system/errors?period=${effectivePeriod}`, setErrorsState)
    ]);
  }, [effectivePeriod, fetchInto]);

  // Groeidata volgt het eigen bereik.
  useEffect(() => {
    fetchInto(`/api/admin/system/growth?range=${growthRange}`, setGrowth);
  }, [growthRange, fetchInto]);

  // Live-modus: elke 60 s (niet vaker) overview/health/performance(1h)/errors
  // verversen. Historische secties (groei/opslag/database/gebruik) bewust niet.
  useEffect(() => {
    if (period !== "live") return undefined;
    const id = setInterval(() => {
      fetchInto("/api/admin/system/overview", setOverview);
      fetchInto("/api/admin/system/health", setHealth);
      fetchInto("/api/admin/system/performance?period=1h", setPerf);
      fetchInto("/api/admin/system/errors?period=1h", setErrorsState);
    }, 60000);
    return () => clearInterval(id);
  }, [period, fetchInto]);

  async function takeSnapshot() {
    setMeasuring(true);
    try {
      await api.post("/api/admin/system/snapshot");
      toast.success("Meting uitgevoerd");
      await Promise.all([
        fetchInto(`/api/admin/system/growth?range=${growthRange}`, setGrowth),
        fetchInto("/api/admin/system/storage", setStorage)
      ]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMeasuring(false);
    }
  }

  // ---- afgeleide grafiekdata (hooks altijd op topniveau) --------------------

  const perfData = perf.data;
  const perfSeries = perfData?.series || [];
  const perfTimestamps = useMemo(() => perfSeries.map((s) => s.timestamp), [perfSeries]);
  const requestValues = useMemo(() => perfSeries.map((s) => s.requests ?? 0), [perfSeries]);
  const avgValues = useMemo(() => perfSeries.map((s) => s.avgMs ?? null), [perfSeries]);
  const p95Values = useMemo(() => perfSeries.map((s) => s.p95Ms ?? null), [perfSeries]);
  const errPctValues = useMemo(
    () =>
      perfSeries.map((s) =>
        s.requests > 0 ? Math.round(((s.errors || 0) / s.requests) * 10000) / 100 : null
      ),
    [perfSeries]
  );

  const growthData = growth.data;
  const growthSeries = growthData?.series || [];
  const growthTimestamps = useMemo(() => growthSeries.map((s) => s.timestamp), [growthSeries]);
  const dbBytesValues = useMemo(() => growthSeries.map((s) => s.databaseBytes), [growthSeries]);
  const blobBytesValues = useMemo(() => growthSeries.map((s) => s.blobBytes), [growthSeries]);

  const perfTimeShortFmt =
    effectivePeriod === "1h" || effectivePeriod === "24h" ? formatTimeShort : formatDayMonth;

  const thresholds = perfData?.thresholds || overview.data?.thresholds || null;

  // Afgeleide componentstatus: API uit het lopende uur, publieke pagina's uit de
  // gekozen periode — beide t.o.v. de geconfigureerde drempels.
  const liveApi = perfData?.liveHour?.api;
  const apiLevel =
    !liveApi || !liveApi.count
      ? "unknown"
      : worstLevel(
          levelForValue(liveApi.p95Ms, thresholds?.apiP95Ms),
          levelForValue(liveApi.errorRatePct, thresholds?.errorRatePct)
        );

  const publicScope = perfData?.scopes?.public;
  const publicLevel =
    !publicScope || !publicScope.requests
      ? "unknown"
      : worstLevel(
          levelForValue(publicScope.p95Ms, thresholds?.publicP95Ms),
          levelForValue(publicScope.errorRatePct, thresholds?.errorRatePct)
        );

  const scopeCards = [
    { key: "api", title: "API", thresholdKey: "apiP95Ms" },
    { key: "public", title: "Publieke pagina's", thresholdKey: "publicP95Ms" },
    { key: "page", title: "App-pagina's", thresholdKey: "apiP95Ms" }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Systeemstatus</h1>
        <p className="mt-1 text-sm text-slate-500">
          Observability voor het hele platform: gezondheid, prestaties, groei en gebruik.
          Geheimen worden nooit getoond.
        </p>
      </div>

      {/* Periode-kiezer: geldt voor Performance en Fouten. */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodButtons
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
          ariaLabel="Periode voor performance en fouten"
        />
        {period === "live" && (
          <span className="text-xs text-slate-400">Ververst automatisch elke 60 seconden</span>
        )}
      </div>

      {/* 1. Platformstatus */}
      <Section title="Platformstatus">
        <SectionBody state={health} skeletonClass="h-48">
          {(healthData) => {
            const banner = OVERALL_BANNER[healthData.overall] || OVERALL_BANNER.degraded;
            const c = healthData.components || {};
            return (
              <div className="space-y-4">
                <div
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm ${banner.className}`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 shrink-0 rounded-full ${banner.dot}`}
                    />
                    <span className="text-lg font-semibold">{banner.label}</span>
                  </div>
                  <span className="text-xs opacity-80">
                    Laatst gecontroleerd: {formatDateTime(healthData.checkedAt)}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <ComponentCard
                    name="Website"
                    status={c.app?.status || "unknown"}
                    rows={[
                      ["Responstijd", c.app?.latencyMs != null ? formatMs(c.app.latencyMs) : null],
                      ["Laatste succes", c.app?.lastSuccess ? formatDateTime(c.app.lastSuccess) : null]
                    ]}
                    lastError={c.app?.lastError}
                  />
                  <ComponentCard
                    name="API"
                    status={apiLevel}
                    statusLabel={apiLevel === "unknown" ? "Onbekend" : undefined}
                    note={
                      !liveApi || !liveApi.count
                        ? "Nog geen API-verkeer in het lopende uur."
                        : undefined
                    }
                    rows={[
                      ["P95 (lopend uur)", liveApi?.count ? formatMs(liveApi.p95Ms) : null],
                      ["Foutratio (lopend uur)", liveApi?.count ? formatPct(liveApi.errorRatePct, 2) : null]
                    ]}
                  />
                  <ComponentCard
                    name="Database"
                    status={c.database?.status || "unknown"}
                    rows={[
                      [
                        "Responstijd",
                        c.database?.latencyMs != null ? formatMs(c.database.latencyMs) : null
                      ],
                      [
                        "Laatste succes",
                        c.database?.lastSuccess ? formatDateTime(c.database.lastSuccess) : null
                      ]
                    ]}
                    lastError={c.database?.lastError}
                  />
                  <ComponentCard
                    name="Supabase Storage"
                    status={c.blobStorage?.status || "unknown"}
                    rows={[
                      [
                        "Responstijd",
                        c.blobStorage?.latencyMs != null ? formatMs(c.blobStorage.latencyMs) : null
                      ],
                      [
                        "Laatste succes",
                        c.blobStorage?.lastSuccess ? formatDateTime(c.blobStorage.lastSuccess) : null
                      ]
                    ]}
                    lastError={c.blobStorage?.lastError}
                  />
                  <ComponentCard
                    name="Supabase Auth"
                    status={c.authentication?.status || "unknown"}
                    rows={[
                      [
                        "Laatste succes",
                        c.authentication?.lastSuccess
                          ? formatDateTime(c.authentication.lastSuccess)
                          : null
                      ]
                    ]}
                    lastError={c.authentication?.lastError}
                  />
                  <ComponentCard
                    name="E-mailservice"
                    status={c.email?.status || "not_configured"}
                    note={
                      c.email?.status === "not_configured"
                        ? "Alleen de herstelcode van \"Wachtwoord vergeten\" (via Supabase Auth-SMTP); niet bevestigd."
                        : undefined
                    }
                    lastError={c.email?.lastError}
                  />
                  <ComponentCard
                    name="Publieke paspoorten & QR"
                    status={publicLevel}
                    statusLabel={publicLevel === "unknown" ? "Onbekend" : undefined}
                    note={
                      !publicScope || !publicScope.requests
                        ? "Nog geen publiek verkeer in de gekozen periode."
                        : undefined
                    }
                    rows={[
                      ["P95 (periode)", publicScope?.requests ? formatMs(publicScope.p95Ms) : null],
                      [
                        "Foutratio (periode)",
                        publicScope?.requests ? formatPct(publicScope.errorRatePct, 2) : null
                      ]
                    ]}
                  />
                  <ComponentCard
                    name="Basis-URL's"
                    status={c.baseUrls?.status || "unknown"}
                    note={
                      c.baseUrls?.status === "degraded"
                        ? "APP_BASE_URL en/of QR_BASE_URL ontbreekt."
                        : undefined
                    }
                    lastError={c.baseUrls?.lastError}
                  />
                </div>
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 2. KPI-rij */}
      <Section title="Kerncijfers">
        <SectionBody state={overview} skeletonClass="h-28">
          {(data) => {
            const k = data.kpis || {};
            const errLevel = levelForValue(k.errorRateTodayPct, data.thresholds?.errorRatePct);
            return (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                <Kpi
                  label="Uptime"
                  value={formatUptime(data.uptime?.processUptimeSeconds)}
                  sub="sinds laatste herstart"
                  note={data.uptime?.note}
                />
                <Kpi
                  label="Gem. API-responstijd"
                  value={k.avgApiMs != null ? formatMs(k.avgApiMs) : null}
                  sub="lopend uur"
                />
                <Kpi
                  label="P95 API-responstijd"
                  value={k.p95ApiMs != null ? formatMs(k.p95ApiMs) : null}
                  sub="lopend uur"
                />
                <Kpi label="Requests vandaag" value={formatNumber(k.requestsToday)} />
                <Kpi label="Fouten vandaag" value={formatNumber(k.errorsToday)} />
                <Kpi
                  label="Foutpercentage vandaag"
                  value={formatPct(k.errorRateTodayPct, 2)}
                  tone={errLevel === "down" ? "crit" : errLevel === "degraded" ? "warn" : "default"}
                />
                <Kpi
                  label="Databasegrootte"
                  value={k.databaseBytes != null ? formatBytes(k.databaseBytes) : null}
                  sub={
                    k.databaseMaxBytes != null ? `van ${formatBytes(k.databaseMaxBytes)}` : undefined
                  }
                />
                <Kpi
                  label="DB-groei 30 d"
                  value={
                    k.databaseGrowth30dBytes != null
                      ? formatBytesSigned(k.databaseGrowth30dBytes)
                      : null
                  }
                />
                <Kpi
                  label="Bestandsopslag"
                  value={k.blobBytes != null ? formatBytes(k.blobBytes) : null}
                />
                <Kpi
                  label="Opslaggroei 30 d"
                  value={k.blobGrowth30dBytes != null ? formatBytesSigned(k.blobGrowth30dBytes) : null}
                />
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 3. Performance */}
      <Section title="Performance">
        <SectionBody state={perf} skeletonClass="h-64">
          {(data) => (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Requests">
                  {perfTimestamps.length >= 2 ? (
                    <LineChart
                      timestamps={perfTimestamps}
                      series={[{ name: "Requests", color: CHART_BLUE, values: requestValues }]}
                      label="Aantal requests over de gekozen periode"
                      formatValue={formatNumber}
                      formatTimeShort={perfTimeShortFmt}
                      formatTimeLong={formatDateTime}
                    />
                  ) : (
                    <NoChartData />
                  )}
                </ChartCard>
                <ChartCard title="Foutpercentage">
                  {countValid(errPctValues) >= 2 ? (
                    <LineChart
                      timestamps={perfTimestamps}
                      series={[{ name: "Foutpercentage", color: CHART_BLUE, values: errPctValues }]}
                      label="Foutpercentage over de gekozen periode"
                      formatValue={(v) => formatPct(v, 1)}
                      formatTimeShort={perfTimeShortFmt}
                      formatTimeLong={formatDateTime}
                    />
                  ) : (
                    <NoChartData />
                  )}
                </ChartCard>
                <ChartCard title="Gemiddelde responstijd">
                  {countValid(avgValues) >= 2 ? (
                    <LineChart
                      timestamps={perfTimestamps}
                      series={[{ name: "Gemiddelde", color: CHART_BLUE, values: avgValues }]}
                      label="Gemiddelde responstijd over de gekozen periode"
                      formatValue={formatMs}
                      formatTimeShort={perfTimeShortFmt}
                      formatTimeLong={formatDateTime}
                    />
                  ) : (
                    <NoChartData />
                  )}
                </ChartCard>
                <ChartCard title="P95-responstijd">
                  {countValid(p95Values) >= 2 ? (
                    <LineChart
                      timestamps={perfTimestamps}
                      series={[{ name: "P95", color: CHART_BLUE, values: p95Values }]}
                      label="P95-responstijd over de gekozen periode"
                      formatValue={formatMs}
                      formatTimeShort={perfTimeShortFmt}
                      formatTimeLong={formatDateTime}
                    />
                  ) : (
                    <NoChartData
                      text={
                        effectivePeriod === "1h"
                          ? "P95 is niet beschikbaar op minuutresolutie (1 uur)."
                          : "Nog geen gegevens voor deze periode."
                      }
                    />
                  )}
                </ChartCard>
              </div>

              {/* Scope-opsplitsing: statuskleur alleen op de P95-waardebadge. */}
              <div className="grid gap-4 md:grid-cols-3">
                {scopeCards.map(({ key, title, thresholdKey }) => {
                  const scope = data.scopes?.[key];
                  const level = scope?.requests
                    ? levelForValue(scope.p95Ms, thresholds?.[thresholdKey])
                    : "unknown";
                  return (
                    <Card key={key}>
                      <h3 className="text-sm font-medium text-slate-900">{title}</h3>
                      {scope && scope.requests > 0 ? (
                        <dl className="mt-2 space-y-1">
                          <div className="flex justify-between gap-2 text-xs">
                            <dt className="text-slate-500">Requests</dt>
                            <dd className="tabular-nums text-slate-700">
                              {formatNumber(scope.requests)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2 text-xs">
                            <dt className="text-slate-500">Gem.</dt>
                            <dd className="tabular-nums text-slate-700">{formatMs(scope.avgMs)}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <dt className="text-slate-500">P95</dt>
                            <dd>
                              <ValueBadge level={level}>{formatMs(scope.p95Ms)}</ValueBadge>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2 text-xs">
                            <dt className="text-slate-500">Foutratio</dt>
                            <dd className="tabular-nums text-slate-700">
                              {formatPct(scope.errorRatePct, 2)}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">
                          Nog geen requests in deze periode.
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </SectionBody>
      </Section>

      {/* 4. Langzaamste endpoints */}
      <Section title="Langzaamste endpoints">
        <SectionBody state={perf} skeletonClass="h-48">
          {(data) => (
            <div className="space-y-4">
              <Card>
                <EndpointTable rows={data.slowest || []} />
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">Snelste endpoints</h3>
                <EndpointTable rows={data.fastest || []} />
              </Card>
              {data.note && <p className="text-xs text-slate-400">{data.note}</p>}
            </div>
          )}
        </SectionBody>
      </Section>

      {/* 5. Database */}
      <Section title="Database">
        <SectionBody state={db} skeletonClass="h-48">
          {(data) => {
            const capLevel = capacityLevel(data.usedPct, data.thresholds?.dbCapacityPct);
            const pool = data.performance?.available ? data.performance.connectionPool : null;
            return (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <h3 className="text-sm font-medium text-slate-900">Grootte en capaciteit</h3>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                      {formatBytes(data.sizeBytes)}
                      {data.maxBytes != null && (
                        <span className="text-base font-medium text-slate-400">
                          {" "}
                          / {formatBytes(data.maxBytes)}
                        </span>
                      )}
                    </div>
                    {data.usedPct != null ? (
                      <div className="mt-2 space-y-1">
                        <MeterBar
                          pct={data.usedPct}
                          level={capLevel}
                          label="Databasecapaciteit"
                        />
                        <div className="flex justify-between text-xs text-slate-400">
                          <span className="tabular-nums">{formatPct(data.usedPct, 1)} in gebruik</span>
                          <span className="tabular-nums">
                            {data.freeBytes != null ? `${formatBytes(data.freeBytes)} vrij` : ""}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Geen capaciteitslimiet bekend.</p>
                    )}
                  </Card>
                  <Card>
                    <h3 className="text-sm font-medium text-slate-900">Actieve verbindingen</h3>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                      {data.performance?.available
                        ? formatNumber(data.performance.activeSessions)
                        : "—"}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">actieve sessies op de database</p>
                  </Card>
                  <Card>
                    <h3 className="text-sm font-medium text-slate-900">Connection pool</h3>
                    {pool ? (
                      <>
                        <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                          {formatNumber(pool.used)}
                          <span className="text-base font-medium text-slate-400">
                            {" "}
                            / {formatNumber(pool.max)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">
                          in gebruik · {formatNumber(pool.free)} vrij
                          {pool.pendingAcquires > 0 &&
                            ` · ${formatNumber(pool.pendingAcquires)} wachtend`}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Nog geen gegevens</p>
                    )}
                  </Card>
                </div>

                {data.performance?.available ? (
                  (data.performance.slowestQueries || []).length > 0 && (
                    <Card>
                      <h3 className="mb-3 text-sm font-semibold text-slate-900">
                        Langzaamste queries
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500">
                              <th className="py-2 pr-3 font-medium">Query</th>
                              <th className="py-2 pr-3 text-right font-medium">Uitgevoerd</th>
                              <th className="py-2 pr-3 text-right font-medium">Gem.</th>
                              <th className="py-2 text-right font-medium">Max</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.performance.slowestQueries.map((q, i) => (
                              <tr key={i} className="border-b border-slate-100 align-top">
                                <td className="py-2 pr-3">
                                  <code className="block whitespace-pre-wrap break-all rounded bg-slate-100 px-1.5 py-0.5 text-[11px] leading-snug text-slate-700">
                                    {q.query}
                                  </code>
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">
                                  {formatNumber(q.executions)}
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums">
                                  {formatMs(q.avgMs)}
                                </td>
                                <td className="py-2 text-right tabular-nums">{formatMs(q.maxMs)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )
                ) : (
                  <Card className="text-sm text-slate-500">
                    Prestatiegegevens niet beschikbaar
                    {data.performance?.reason ? ` — ${data.performance.reason}` : ""}
                  </Card>
                )}
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 6. Databasegroei */}
      <Section
        title="Databasegroei"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodButtons
              options={GROWTH_RANGE_OPTIONS}
              value={growthRange}
              onChange={setGrowthRange}
              ariaLabel="Bereik voor groeigrafieken"
            />
            <Button
              type="button"
              variant="outline"
              className="bg-white px-3 py-1.5 text-xs"
              onClick={takeSnapshot}
              disabled={measuring}
            >
              {measuring ? "Bezig met meten…" : "Nu meten"}
            </Button>
          </div>
        }
      >
        <SectionBody state={growth} skeletonClass="h-64">
          {(data) => {
            const g = data.database?.growth || {};
            const forecast = data.database?.forecast;
            const growthCards = [
              { label: "Vandaag", value: g.today },
              { label: "Afgelopen 7 dagen", value: g.last7 },
              { label: "Afgelopen 30 dagen", value: g.last30 },
              { label: "Afgelopen 90 dagen", value: g.last90 }
            ];
            return (
              <div className="space-y-4">
                {countValid(dbBytesValues) >= 2 ? (
                  <ChartCard title="Databasegrootte">
                    <LineChart
                      timestamps={growthTimestamps}
                      series={[{ name: "Database", color: CHART_BLUE, values: dbBytesValues }]}
                      label="Databasegrootte over de tijd"
                      formatValue={formatBytes}
                      formatTimeShort={formatDayMonth}
                      formatTimeLong={formatDateTime}
                    />
                  </ChartCard>
                ) : (
                  <MonitoringStartInfo
                    since={data.monitoringSince}
                    onMeasure={takeSnapshot}
                    measuring={measuring}
                  />
                )}

                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  {growthCards.map(({ label, value }) => (
                    <Kpi
                      key={label}
                      label={label}
                      value={value ? formatBytesSigned(Math.round(value.deltaTotal)) : null}
                      sub={value ? `${formatBytesSigned(Math.round(value.perDay))} per dag` : undefined}
                    />
                  ))}
                </div>

                <Card>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Prognose</h3>
                  {forecast ? (
                    <>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                        <div>
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatBytes(data.database.currentBytes)}
                          </div>
                          <div className="text-xs text-slate-500">Nu</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatBytes(forecast.in90d)}
                          </div>
                          <div className="text-xs text-slate-500">Over 3 maanden</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatBytes(forecast.in180d)}
                          </div>
                          <div className="text-xs text-slate-500">Over 6 maanden</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatBytes(forecast.in365d)}
                          </div>
                          <div className="text-xs text-slate-500">Over 12 maanden</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatBytesSigned(forecast.perDayBytes)}
                          </div>
                          <div className="text-xs text-slate-500">Gem. per dag</div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-400">
                        Trendberekening op basis van {formatNumber(forecast.basedOnDays)} dagen
                        metingen — geen garantie.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Nog geen gegevens — een prognose verschijnt zodra er voldoende metingen zijn.
                    </p>
                  )}
                </Card>

                {data.database?.estimatedDaysUntilCapacity != null && (
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
                      data.database.capacityWarning
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <WarningIcon
                      className={data.database.capacityWarning ? "text-amber-600" : "text-slate-400"}
                    />
                    <p>
                      Bij het huidige tempo wordt de capaciteitsgrens naar verwachting over ~
                      {formatNumber(data.database.estimatedDaysUntilCapacity)} dagen bereikt.
                    </p>
                  </div>
                )}
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 7. Grootste tabellen */}
      <Section title="Grootste tabellen">
        <SectionBody state={db} skeletonClass="h-48">
          {(data) =>
            data.tables && data.tables.length > 0 ? (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">Tabel</th>
                        <th className="py-2 pr-3 text-right font-medium">Records</th>
                        <th className="py-2 pr-3 text-right font-medium">Grootte</th>
                        <th className="py-2 pr-3 text-right font-medium">% van database</th>
                        <th className="py-2 pr-3 text-right font-medium">Groei 7 d</th>
                        <th className="py-2 text-right font-medium">Groei 30 d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.tables]
                        .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
                        .map((table) => (
                          <tr key={table.table} className="border-b border-slate-100">
                            <td className="py-2 pr-3">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                                {table.table}
                              </code>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatNumber(table.rows)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatBytes(table.bytes)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatPct(table.pctOfDatabase, 1)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {table.growth7dBytes != null ? (
                                formatBytesSigned(table.growth7dBytes)
                              ) : (
                                <span title="nog onvoldoende historie">—</span>
                              )}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {table.growth30dBytes != null ? (
                                formatBytesSigned(table.growth30dBytes)
                              ) : (
                                <span title="nog onvoldoende historie">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {data.tablesMeasuredAt && (
                  <p className="mt-3 text-xs text-slate-400">
                    Gemeten op {formatDateTime(data.tablesMeasuredAt)}.
                  </p>
                )}
              </Card>
            ) : (
              <Card className="text-sm text-slate-500">
                Nog geen meting — tabelstatistieken komen uit de dagelijkse snapshot.
              </Card>
            )
          }
        </SectionBody>
      </Section>

      {/* 8. Opslag (Supabase Storage) */}
      <Section title="Opslag (Supabase Storage)">
        <SectionBody state={storage} skeletonClass="h-48">
          {(data) => {
            const blob = data.blob;
            if (!blob || blob.available === false) {
              return (
                <Card>
                  <p className="text-sm text-slate-600">
                    Nog geen meting — wordt dagelijks automatisch gemeten.
                    {blob?.reason ? ` (${blob.reason})` : ""}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 px-3 py-1.5 text-xs"
                    onClick={takeSnapshot}
                    disabled={measuring}
                  >
                    {measuring ? "Bezig met meten…" : "Nu meten"}
                  </Button>
                </Card>
              );
            }
            const containers = Object.entries(blob.containers || {});
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  <Kpi label="Totaal opgeslagen" value={formatBytes(blob.totalBytes)} />
                  <Kpi label="Bestanden" value={formatNumber(blob.totalCount)} />
                  <Kpi
                    label="Gem. bestandsgrootte"
                    value={data.avgFileBytes != null ? formatBytes(data.avgFileBytes) : null}
                  />
                  <Kpi
                    label="Groei 30 d"
                    value={
                      data.growth30dBytes != null ? formatBytesSigned(data.growth30dBytes) : null
                    }
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {containers.map(([name, container]) => (
                    <Card key={name}>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {containerLabel(name)}
                      </h3>
                      {container.available === false ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Niet beschikbaar{container.reason ? ` — ${container.reason}` : ""}
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 text-xs text-slate-500">
                            <span className="tabular-nums">{formatNumber(container.count)}</span>{" "}
                            bestanden ·{" "}
                            <span className="tabular-nums">{formatBytes(container.bytes)}</span>
                          </p>
                          {Object.keys(container.byExtension || {}).length > 0 && (
                            <table className="mt-3 w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-500">
                                  <th className="py-1.5 pr-3 font-medium">Extensie</th>
                                  <th className="py-1.5 pr-3 text-right font-medium">Aantal</th>
                                  <th className="py-1.5 text-right font-medium">Grootte</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(container.byExtension)
                                  .sort(([, a], [, b]) => (b.bytes || 0) - (a.bytes || 0))
                                  .map(([ext, stats]) => (
                                    <tr key={ext} className="border-b border-slate-100">
                                      <td className="py-1.5 pr-3">
                                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                                          .{ext}
                                        </code>
                                      </td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">
                                        {formatNumber(stats.count)}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {formatBytes(stats.bytes)}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          )}
                        </>
                      )}
                    </Card>
                  ))}

                  {data.documentBreakdown && data.documentBreakdown.length > 0 && (
                    <Card>
                      <h3 className="text-sm font-semibold text-slate-900">Per documenttype</h3>
                      <table className="mt-3 w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">Type</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Aantal</th>
                            <th className="py-1.5 text-right font-medium">Grootte</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.documentBreakdown.map((row) => (
                            <tr key={row.type} className="border-b border-slate-100">
                              <td className="py-1.5 pr-3 text-slate-700">
                                {documentCategoryLabel(row.type) || row.type || "Onbekend"}
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">
                                {formatNumber(row.count)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {formatBytes(row.bytes)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {data.documentBreakdownNote && (
                        <p className="mt-3 text-xs text-slate-400">{data.documentBreakdownNote}</p>
                      )}
                    </Card>
                  )}
                </div>

                {blob.measuredAt && (
                  <p className="text-xs text-slate-400">
                    Gemeten op {formatDateTime(blob.measuredAt)}.
                  </p>
                )}
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 9. Opslaggroei: de enige grafiek met twee series → legenda verplicht,
          vaste kleuren (database blauw, blob oranje). */}
      <Section
        title="Opslaggroei"
        aside={
          <PeriodButtons
            options={GROWTH_RANGE_OPTIONS}
            value={growthRange}
            onChange={setGrowthRange}
            ariaLabel="Bereik voor opslaggroei"
          />
        }
      >
        <SectionBody state={growth} skeletonClass="h-64">
          {(data) =>
            countValid(dbBytesValues) >= 2 || countValid(blobBytesValues) >= 2 ? (
              <ChartCard title="Database en bestandsopslag">
                <LineChart
                  timestamps={growthTimestamps}
                  series={[
                    { name: "Database", color: CHART_BLUE, values: dbBytesValues },
                    { name: "Bestandsopslag", color: CHART_ORANGE, values: blobBytesValues }
                  ]}
                  label="Opslaggroei van database en bestandsopslag"
                  formatValue={formatBytes}
                  formatTimeShort={formatDayMonth}
                  formatTimeLong={formatDateTime}
                />
                {countValid(blobBytesValues) < 2 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Bestandsopslag: nog geen (voldoende) metingen.
                  </p>
                )}
              </ChartCard>
            ) : (
              <MonitoringStartInfo
                since={data.monitoringSince}
                onMeasure={takeSnapshot}
                measuring={measuring}
              />
            )
          }
        </SectionBody>
      </Section>

      {/* 10. Platformgebruik */}
      <Section title="Platformgebruik">
        <SectionBody state={usage} skeletonClass="h-40">
          {(data) => {
            const t = data.totals || {};
            const g30 = data.growthLast30d;
            const growthSub = (key) =>
              g30 && g30[key] != null ? `+${formatNumber(g30[key])} afgelopen 30 dagen` : undefined;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                  <Kpi label="Partners" value={formatNumber(t.partners)} sub={growthSub("partners")} />
                  <Kpi
                    label="Klantbedrijven"
                    value={formatNumber(t.companies)}
                    sub={growthSub("companies")}
                  />
                  <Kpi
                    label="Gebruikers"
                    value={formatNumber(t.users)}
                    sub={[`${formatNumber(t.activeUsers)} actief`, growthSub("users")]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Kpi label="Producten" value={formatNumber(t.products)} sub={growthSub("products")} />
                  <Kpi
                    label="Documenten"
                    value={formatNumber(t.documents)}
                    sub={growthSub("documents")}
                  />
                  <Kpi
                    label="Auditlogs"
                    value={formatNumber(t.auditLogs)}
                    sub={growthSub("auditLogs")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  <Kpi label="Logins vandaag" value={formatNumber(data.logins?.today)} />
                  <Kpi label="Logins afgelopen 7 dagen" value={formatNumber(data.logins?.last7)} />
                  <Kpi label="Logins afgelopen 30 dagen" value={formatNumber(data.logins?.last30)} />
                  <Kpi
                    label="Requests sinds start"
                    value={formatNumber(data.requestsSinceStart)}
                    sub="sinds laatste herstart"
                  />
                </div>
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 11. QR & publieke pagina's */}
      <Section title="QR &amp; publieke pagina's">
        <SectionBody state={usage} skeletonClass="h-40">
          {(data) => {
            const scans = data.qr?.scans || {};
            const top = data.qr?.topProductsLast30d || [];
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  <Kpi label="Scans vandaag" value={formatNumber(scans.today)} />
                  <Kpi label="Scans afgelopen 7 dagen" value={formatNumber(scans.last7)} />
                  <Kpi label="Scans afgelopen 30 dagen" value={formatNumber(scans.last30)} />
                  <Kpi label="Scans totaal" value={formatNumber(scans.total)} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Responstijd publieke pagina's
                    </h3>
                    {publicScope && publicScope.requests > 0 ? (
                      <dl className="mt-2 space-y-1">
                        <div className="flex justify-between gap-2 text-xs">
                          <dt className="text-slate-500">Gemiddeld (gekozen periode)</dt>
                          <dd className="tabular-nums text-slate-700">
                            {formatMs(publicScope.avgMs)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <dt className="text-slate-500">P95 (gekozen periode)</dt>
                          <dd>
                            <ValueBadge
                              level={levelForValue(publicScope.p95Ms, thresholds?.publicP95Ms)}
                            >
                              {formatMs(publicScope.p95Ms)}
                            </ValueBadge>
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        Nog geen publiek verkeer in de gekozen periode.
                      </p>
                    )}
                  </Card>

                  <Card>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Meest gescande producten (30 dagen)
                    </h3>
                    {top.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Nog geen scans geregistreerd.</p>
                    ) : (
                      <table className="mt-3 w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">Product</th>
                            <th className="py-1.5 pr-3 font-medium">Bedrijf</th>
                            <th className="py-1.5 text-right font-medium">Scans</th>
                          </tr>
                        </thead>
                        <tbody>
                          {top.map((product, i) => (
                            <tr key={`${product.name}-${i}`} className="border-b border-slate-100">
                              <td className="py-1.5 pr-3 font-medium text-slate-900">
                                {product.name}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-600">{product.company_name}</td>
                              <td className="py-1.5 text-right tabular-nums">
                                {formatNumber(product.scans)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>
                </div>
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 12. Fouten */}
      <Section title="Fouten">
        <SectionBody state={errorsState} skeletonClass="h-48">
          {(data) => {
            const periodLevel = levelForValue(
              data.period?.errorRatePct,
              thresholds?.errorRatePct
            );
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Kpi label="4xx-fouten (lopend uur)" value={formatNumber(data.currentHour?.errors4xx)} />
                  <Kpi label="5xx-fouten (lopend uur)" value={formatNumber(data.currentHour?.errors5xx)} />
                  <Kpi
                    label="Foutratio (gekozen periode)"
                    value={formatPct(data.period?.errorRatePct, 2)}
                    sub={`${formatNumber(data.period?.errors)} van ${formatNumber(
                      data.period?.requests
                    )} requests`}
                    tone={
                      periodLevel === "down" ? "crit" : periodLevel === "degraded" ? "warn" : "default"
                    }
                  />
                </div>

                <Card>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Recente fouten</h3>
                  {(data.recent || []).length === 0 ? (
                    <EmptyState
                      title="Geen recente fouten"
                      description="Er zijn sinds de laatste herstart geen serverfouten geregistreerd."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 pr-3 font-medium">Tijd</th>
                            <th className="py-2 pr-3 font-medium">Route</th>
                            <th className="py-2 pr-3 text-right font-medium">Status</th>
                            <th className="py-2 pr-3 text-right font-medium">Duur</th>
                            <th className="py-2 pr-3 font-medium">Code</th>
                            <th className="py-2 font-medium">Melding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.recent.map((error, i) => {
                            const expanded = expandedError === i;
                            return (
                              <Fragment key={`${error.timestamp}-${i}`}>
                                <tr
                                  className={`border-b border-slate-100 ${
                                    error.message ? "cursor-pointer hover:bg-slate-50" : ""
                                  }`}
                                  onClick={
                                    error.message
                                      ? () => setExpandedError(expanded ? null : i)
                                      : undefined
                                  }
                                  aria-expanded={error.message ? expanded : undefined}
                                >
                                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-slate-600">
                                    {formatDateTimeSec(error.timestamp)}
                                  </td>
                                  <td className="py-2 pr-3">
                                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                                      {error.method} {error.route}
                                    </code>
                                  </td>
                                  <td className="py-2 pr-3 text-right">
                                    <Badge variant={error.status >= 500 ? "danger" : "warning"}>
                                      {error.status}
                                    </Badge>
                                  </td>
                                  <td className="py-2 pr-3 text-right tabular-nums">
                                    {formatMs(error.durationMs)}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {error.code ? (
                                      <code className="text-xs text-slate-500">{error.code}</code>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="max-w-[16rem] truncate py-2 text-xs text-slate-600">
                                    {error.message || "—"}
                                  </td>
                                </tr>
                                {expanded && error.message && (
                                  <tr className="border-b border-slate-100 bg-slate-50">
                                    <td colSpan={6} className="p-3 text-xs text-slate-700">
                                      {error.message}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {data.note && <p className="mt-3 text-xs text-slate-400">{data.note}</p>}
                </Card>
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 13. Infrastructuur */}
      <Section title="Infrastructuur">
        <SectionBody state={infra} skeletonClass="h-32">
          {(data) => {
            const rss = data.memory?.rssBytes;
            const memPct = rss != null ? (rss / FUNCTION_MEMORY_BYTES) * 100 : null;
            const memLevel = levelForValue(
              memPct,
              overview.data?.thresholds?.memoryRssPct || { warn: 70, crit: 85 }
            );
            return (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <Kpi
                  label="Node-versie"
                  value={<code className="text-lg">{data.nodeVersion}</code>}
                />
                <Kpi
                  label="Omgeving"
                  value={data.environment === "production" ? "Productie" : data.environment}
                />
                <Kpi label="Platform" value={data.platform || null} sub={data.region ? `regio ${data.region}` : undefined} />
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-2xl font-bold tabular-nums text-slate-900">
                    {formatBytes(rss)}
                  </div>
                  <div className="text-sm text-slate-500">Geheugen (RSS)</div>
                  {memPct != null && (
                    <div className="mt-2 space-y-1">
                      <MeterBar
                        pct={memPct}
                        level={memLevel === "unknown" ? "ok" : memLevel}
                        label="Geheugengebruik t.o.v. function-budget"
                      />
                      <div className="text-[11px] text-slate-400">
                        van 2 GB (Vercel Function) · heap{" "}
                        <span className="tabular-nums">
                          {formatBytes(data.memory?.heapUsedBytes)}
                        </span>{" "}
                        /{" "}
                        <span className="tabular-nums">
                          {formatBytes(data.memory?.heapTotalBytes)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <Kpi
                  label="CPU"
                  value={
                    data.cpu?.loadAvg1m != null
                      ? Number(data.cpu.loadAvg1m).toLocaleString("nl-NL", {
                          maximumFractionDigits: 2
                        })
                      : null
                  }
                  sub={data.cpu?.cores != null ? `load (1 m) · ${data.cpu.cores} cores` : undefined}
                />
                <Kpi
                  label="Uptime"
                  value={formatUptime(data.processUptimeSeconds)}
                  sub="van deze function-instance"
                />
              </div>
            );
          }}
        </SectionBody>
      </Section>

      {/* 14. Deployment */}
      <Section title="Deployment">
        <SectionBody state={infra} skeletonClass="h-24">
          {(data) =>
            data.build ? (
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi
                  label="Commit"
                  value={
                    <code className="text-lg" title={data.build.commit}>
                      {String(data.build.commit || "").slice(0, 10) || "—"}
                    </code>
                  }
                />
                <Kpi label="Branch" value={data.build.branch ? <code className="text-lg">{data.build.branch}</code> : null} />
                <Kpi
                  label="Deployment"
                  value={data.build.deploymentId ? <code className="text-sm">{data.build.deploymentId}</code> : null}
                  sub={data.build.url || undefined}
                />
                <Kpi
                  label="Uptime"
                  value={formatUptime(data.processUptimeSeconds)}
                  sub="van deze function-instance"
                />
              </div>
            ) : (
              <Card className="text-sm text-slate-500">
                Deployment-info is alleen beschikbaar op Vercel (lokaal niet).
              </Card>
            )
          }
        </SectionBody>
      </Section>

      {/* 15. Configuratie (bestaande config-status-kaarten) */}
      <Section title="Configuratie">
        <p className="-mt-1 text-sm text-slate-500">
          Configuratie van deze omgeving: Supabase, secrets en basis-URL&apos;s. Geheimen worden
          nooit getoond, alleen of ze aanwezig zijn.
        </p>
        <SectionBody state={config} skeletonClass="h-40">
          {(data) => (
            <div className="space-y-4">
              <ConfigStatusCards status={data} />
            </div>
          )}
        </SectionBody>
      </Section>
    </div>
  );
}
