"use client";

import { XIcon } from "./icons";

// Balk die verschijnt zodra er rijen geselecteerd zijn. `actions` zijn knoppen;
// `children` ruimte voor bijv. "Selecteer alle 1.248 resultaten".
export default function BulkActionBar({ selectedCount, actions, onClear, children }) {
  if (!selectedCount) return null;
  return (
    <div
      role="region"
      aria-label="Bulkacties"
      className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"
    >
      <span className="mr-1 font-medium tabular-nums" aria-live="polite">
        {selectedCount.toLocaleString("nl-NL")} geselecteerd
      </span>
      {children}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">{actions}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Selectie wissen"
        title="Selectie wissen"
        className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}

// Knop in de donkere balk.
export function BulkButton({ icon: IconComponent, children, tone = "default", ...props }) {
  const tones = {
    default: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    accent: "bg-emerald-600 text-white hover:bg-emerald-500",
    danger: "bg-red-600/90 text-white hover:bg-red-600"
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone] || tones.default}`}
      {...props}
    >
      {IconComponent && <IconComponent size={14} />}
      {children}
    </button>
  );
}
