// Paginakop: titel, korte uitleg ("waar ben ik, wat kan ik hier") en de acties
// rechts. Op mobiel schuiven de acties onder de titel.
export default function PageHeader({ title, description, actions, eyebrow, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{eyebrow}</p>}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
