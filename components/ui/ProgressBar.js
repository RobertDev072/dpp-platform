const TONES = {
  success: "bg-emerald-500",
  info: "bg-blue-500",
  warning: "bg-amber-500",
  danger: "bg-red-500"
};

// Voortgangsbalk 0-100 met optioneel label en toelichting (bijv. "872 / 1.248").
export default function ProgressBar({ value, label, description, tone = "success", indeterminate = false }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div>
      {(label || description) && (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
          {label && <span className="font-medium text-slate-700">{label}</span>}
          {description && <span className="tabular-nums text-slate-500">{description}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label || "Voortgang"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuetext={description || `${pct}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${TONES[tone] || TONES.success} ${indeterminate ? "w-1/3 animate-pulse" : ""}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
