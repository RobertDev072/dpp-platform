// Lege staat: wat is er (nog) niet, en wat is de volgende stap. `action` is een
// knop/link (bijv. <ButtonLink>), `icon` een icooncomponent uit ./icons.
export default function EmptyState({ icon: IconComponent, title, description, action, compact = false }) {
  return (
    <div className={`rounded-lg border border-dashed border-slate-300 text-center ${compact ? "p-5" : "p-8"}`}>
      {IconComponent && (
        <span aria-hidden="true" className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <IconComponent size={20} />
        </span>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
