// Stat-tegel voor de adminoverzichten: dezelfde witte kaart als StatTile,
// maar met een kleurtoon voor het getal en een optionele subregel.

const TONE_CLASSES = {
  default: "text-slate-900",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  neutral: "text-slate-500"
};

export default function AdminStatTile({ label, value, sub, tone = "default" }) {
  const toneClass = TONE_CLASSES[tone] || TONE_CLASSES.default;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
