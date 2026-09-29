// Gedeelde paginakop voor het productenoverzicht (bedrijfs- én adminpagina),
// zodat titel en subtitel op beide plekken identiek blijven.

export default function ProductsPageHeader({ children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Producten</h1>
        <p className="mt-1 text-sm text-slate-500">
          Beheer digitale productpaspoorten, documentatie en publicatiestatus.
        </p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
