// Statusweergave voor het observability-dashboard. Statuskleuren (groen/oranje/
// rood) worden UITSLUITEND hier en op drempeloverschrijdingen gebruikt — nooit
// als grafiekserie-kleur. Elke status heeft naast kleur ook altijd een label
// (stip + tekst), zodat de betekenis nooit van kleur alleen afhangt.

const STATUS_STYLES = {
  ok: { label: "Gezond", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700" },
  degraded: { label: "Traag", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700" },
  down: { label: "Storing", dot: "bg-red-500", badge: "bg-red-50 text-red-700" },
  not_configured: {
    label: "Niet geconfigureerd",
    dot: "bg-slate-300",
    badge: "bg-slate-100 text-slate-500"
  },
  unknown: {
    label: "Onbekend",
    dot: "border border-slate-300 bg-white",
    badge: "bg-slate-50 text-slate-500"
  }
};

export default function StatusBadge({ status, label }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.unknown;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      {label || style.label}
    </span>
  );
}

// Kleine gekleurde waarde-badge voor drempelgecodeerde cijfers (bijv. P95).
// Alleen de badge draagt de statuskleur, nooit de hele kaart.
const LEVEL_BADGES = {
  ok: "bg-emerald-50 text-emerald-700",
  degraded: "bg-amber-50 text-amber-700",
  down: "bg-red-50 text-red-700",
  unknown: "bg-slate-100 text-slate-500"
};

export function ValueBadge({ level = "unknown", children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        LEVEL_BADGES[level] || LEVEL_BADGES.unknown
      }`}
    >
      {children}
    </span>
  );
}

// Waarde tegen een {warn, crit}-drempel: ok / degraded (>= warn) / down (>= crit).
export function levelForValue(value, thresholds) {
  if (value == null || !thresholds) return "unknown";
  if (value >= thresholds.crit) return "down";
  if (value >= thresholds.warn) return "degraded";
  return "ok";
}

// Ergste van meerdere niveaus (unknown telt niet mee als er wél metingen zijn).
const LEVEL_RANK = { ok: 0, degraded: 1, down: 2 };

export function worstLevel(...levels) {
  const known = levels.filter((l) => l in LEVEL_RANK);
  if (!known.length) return "unknown";
  return known.reduce((a, b) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b));
}
