// Lege toestand met uitleg en (optioneel) een vervolgactie, zodat een pagina nooit
// "leeg" voelt maar zegt wat de gebruiker nu kan doen.
export default function EmptyState({ title, description, icon, action, secondaryAction }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      {icon && (
        <div aria-hidden="true" className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
