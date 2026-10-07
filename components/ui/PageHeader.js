// Vaste paginakop: titel ("waar ben ik?"), korte uitleg ("wat kan ik hier?") en de
// primaire acties rechts. Op mobiel schuiven de acties onder de titel.
export default function PageHeader({ title, description, actions, eyebrow, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{eyebrow}</p>}
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
