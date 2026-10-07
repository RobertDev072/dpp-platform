// Voortgangsbalk voor lange bewerkingen (import, bulk-PDF, ZIP).
export default function ProgressBar({ value = 0, max = 100, label, showCount = true, tone = "emerald" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-red-500" : "bg-emerald-600";
  return (
    <div>
      {(label || showCount) && (
        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-700">{label}</span>
          {showCount && (
            <span className="tabular-nums text-slate-500">
              {value.toLocaleString("nl-NL")} / {max.toLocaleString("nl-NL")}
            </span>
          )}
        </div>
      )}
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label || "Voortgang"}
      >
        <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
