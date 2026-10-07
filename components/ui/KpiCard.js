import Link from "next/link";

// KPI-tegel: grote waarde, label en optioneel een secundaire trend/hint
// ("+42 deze maand", "12 aandacht nodig"). tone kleurt alleen de hint, nooit de waarde.
const TONES = {
  neutral: "text-slate-500",
  positive: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-red-700"
};

export default function KpiCard({ label, value, hint, tone = "neutral", href, icon, loading = false }) {
  const body = (
    <div className="flex h-full items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm text-slate-500">{label}</div>
        {loading ? (
          <div className="mt-1.5 h-7 w-16 animate-pulse rounded bg-slate-200" />
        ) : (
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value ?? "—"}</div>
        )}
        {hint && !loading && <div className={`mt-1 text-xs font-medium ${TONES[tone] || TONES.neutral}`}>{hint}</div>}
      </div>
      {icon && (
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
          {icon}
        </span>
      )}
    </div>
  );
  const classes = "block rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
  if (href) {
    return (
      <Link href={href} className={`${classes} transition-colors hover:border-emerald-300 hover:shadow`}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
