// Voortgangsbalk voor DPP-compleetheid (0-100%). Kleur volgt de status
// (groen = compleet genoeg, blauw = onderweg, amber = actie nodig); de lege
// track is een lichtere stap van dezelfde kleur zodat de hele balk leesbaar is.

const TONES = [
  { min: 80, bar: "bg-emerald-500", track: "bg-emerald-100" },
  { min: 50, bar: "bg-blue-500", track: "bg-blue-100" },
  { min: 0, bar: "bg-amber-500", track: "bg-amber-100" }
];

export default function CompletenessBar({ value }) {
  const numeric = Number(value);
  const pct = Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
  const tone = TONES.find((t) => pct >= t.min) || TONES[TONES.length - 1];

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Compleetheid"
        className={`h-1.5 w-20 overflow-hidden rounded-full ${tone.track}`}
      >
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-slate-600">{pct}%</span>
    </div>
  );
}
