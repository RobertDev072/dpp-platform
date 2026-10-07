"use client";

// KPI-rij boven het productenoverzicht. Elke tegel is óók een snelfilter:
// klikken zet het bijbehorende filter in de tabel (via onSelect).

const ICONS = {
  total: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M4 7l8 4 8-4M12 11v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  published: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  drafts: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.5 4.5a1.9 1.9 0 0 1 2.7 2.7L8.5 17.9 4.8 19l1-3.7L16.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  actionRequired: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.3 4.3 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16.75" r="1" fill="currentColor" />
    </svg>
  )
};

const TILES = [
  {
    key: "total",
    label: "Alle producten",
    value: (stats) => stats.total,
    subtitle: (stats) => `+${stats.createdThisMonth ?? 0} deze maand`,
    chip: "bg-slate-100 text-slate-500"
  },
  {
    key: "published",
    label: "Gepubliceerd",
    value: (stats) => stats.published,
    subtitle: (stats) => `+${stats.publishedThisMonth ?? 0} deze maand`,
    chip: "bg-emerald-50 text-emerald-600"
  },
  {
    key: "drafts",
    label: "Concepten",
    value: (stats) => stats.drafts,
    chip: "bg-blue-50 text-blue-600"
  },
  {
    key: "actionRequired",
    label: "Actie vereist",
    value: (stats) => stats.actionRequired,
    chip: "bg-amber-50 text-amber-600"
  }
];

export default function ProductStats({ stats, active, onSelect }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {TILES.map((tile) => {
        const isActive = active === tile.key;
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onSelect(tile.key)}
            aria-pressed={isActive}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition-colors ${
              isActive
                ? "border-emerald-500 ring-1 ring-emerald-500"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-500">{tile.label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {stats ? (tile.value(stats) ?? 0) : "—"}
                </p>
                {stats && tile.subtitle && (
                  <p className="mt-0.5 text-xs text-slate-400">{tile.subtitle(stats)}</p>
                )}
              </div>
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tile.chip}`}
              >
                {ICONS[tile.key]}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
