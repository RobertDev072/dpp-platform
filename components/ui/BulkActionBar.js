// Verschijnt zodra er rijen geselecteerd zijn: aantal, "alles selecteren" en de
// bulkacties. Plakt onderaan het scherm zodat hij ook bij lange lijsten zichtbaar blijft.
export default function BulkActionBar({ count, total, allMatching, onSelectAllMatching, onClear, children }) {
  if (!count && !allMatching) return null;
  return (
    <div className="sticky bottom-3 z-30 mx-auto flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2.5 text-sm text-white shadow-lg">
      <span className="font-medium">
        {allMatching
          ? `Alle ${Number(total).toLocaleString("nl-NL")} resultaten geselecteerd`
          : `${count.toLocaleString("nl-NL")} geselecteerd`}
      </span>
      {!allMatching && onSelectAllMatching && total > count && (
        <button type="button" onClick={onSelectAllMatching} className="text-emerald-300 underline-offset-2 hover:underline">
          Selecteer alle {Number(total).toLocaleString("nl-NL")}
        </button>
      )}
      <button type="button" onClick={onClear} className="text-slate-300 underline-offset-2 hover:underline">
        Selectie wissen
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// Knopstijl binnen de (donkere) bulkbalk.
export function BulkButton({ children, tone = "default", ...props }) {
  const toneClasses =
    tone === "danger" ? "bg-red-500/90 hover:bg-red-500" : tone === "primary" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-white/10 hover:bg-white/20";
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses}`}
      {...props}
    >
      {children}
    </button>
  );
}
