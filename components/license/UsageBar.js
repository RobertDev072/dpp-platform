// Verbruiksbalk voor licentielimieten: label + "x van y" (of "x (onbeperkt)")
// met een voortgangsbalk die van groen naar rood kleurt naarmate de limiet nadert.
// Verbruik geldt altijd per bedrijf; limieten worden nooit gedeeld tussen tenants.

function barColorClass(pct) {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 90) return "bg-orange-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

export default function UsageBar({ label, used, max, pct, format = (n) => Number(n).toLocaleString("nl-NL"), unlimitedLabel = "onbeperkt" }) {
  const unlimited = max == null;
  const value = pct ?? 0;
  const text = unlimited ? `${format(used)} (${unlimitedLabel})` : `${format(used)} van ${format(max)}`;

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-500">
          {text}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={unlimited ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={text}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        {!unlimited && (
          <div
            className={`h-full rounded-full transition-all ${barColorClass(value)}`}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}
