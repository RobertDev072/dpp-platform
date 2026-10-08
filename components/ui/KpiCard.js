import Link from "next/link";
import Skeleton from "./Skeleton";

const CHIP_TONES = {
  neutral: "bg-slate-100 text-slate-500",
  success: "bg-emerald-50 text-emerald-600",
  info: "bg-blue-50 text-blue-600",
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-red-50 text-red-600"
};

const TREND_TONES = {
  neutral: "text-slate-400",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600"
};

// KPI-tegel: waarde, label, optioneel icoon, een korte trend/subregel en een link
// ("waar kan ik dit zien?"). value=undefined toont een skeleton tijdens het laden.
export default function KpiCard({ label, value, description, icon: IconComponent, tone = "neutral", trend, href, loading = false }) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value ?? "—"}</p>
        )}
        {!loading && trend && (
          <p className={`mt-0.5 text-xs ${TREND_TONES[trend.tone || "neutral"] || TREND_TONES.neutral}`}>{trend.text}</p>
        )}
        {!loading && description && !trend && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      </div>
      {IconComponent && (
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CHIP_TONES[tone] || CHIP_TONES.neutral}`}>
          <IconComponent size={18} />
        </span>
      )}
    </div>
  );

  const classes = "block rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
  if (href) {
    return (
      <Link href={href} className={`${classes} transition-colors hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
