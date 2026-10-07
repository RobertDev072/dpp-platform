"use client";

import CompletenessBar from "@/components/products/CompletenessBar";

// Compleetheidsscore + checklist. Elke regel linkt naar de tab waar het ontbrekende
// onderdeel ingevuld wordt (onNavigate(tabKey)).
const ITEMS = [
  { key: "basic", label: "Basisinformatie", tab: "overview", check: (c) => c.basic },
  { key: "identification", label: "Identificatie (SKU/GTIN)", tab: "overview", check: (c) => c.identification, optional: true },
  { key: "photo", label: "Productafbeelding", tab: "overview", check: (c) => c.photo },
  { key: "description", label: "Omschrijving", tab: "overview", check: (c) => c.description },
  { key: "category", label: "Categorie", tab: "overview", check: (c) => c.category },
  { key: "sustainability", label: "Duurzaamheid", tab: "sustainability", check: (c) => c.sustainability },
  { key: "compliance", label: "Compliance", tab: "compliance", check: (c) => c.compliance },
  { key: "documents", label: "Documenten", tab: "documents", check: (c) => c.documents },
  { key: "qr", label: "QR-code", tab: "qr", check: (c) => c.qr, optional: true }
];

export default function ProductCompleteness({ completeness, checks, onNavigate }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Compleetheid</h2>
        <span className="text-lg font-bold tabular-nums text-slate-900">{completeness}%</span>
      </div>
      <div className="mt-2">
        <CompletenessBar value={completeness} />
      </div>
      <ul className="mt-4 space-y-1">
        {ITEMS.map((item) => {
          const ok = Boolean(item.check(checks));
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onNavigate?.(item.tab)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                title={ok ? `${item.label}: ingevuld` : `${item.label}: ontbreekt — klik om in te vullen`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${
                      ok ? "bg-emerald-100 text-emerald-700" : item.optional ? "bg-slate-100 text-slate-400" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {ok ? "✓" : "!"}
                  </span>
                  <span className={ok ? "text-slate-700" : "text-slate-900"}>{item.label}</span>
                  {item.optional && !ok && <span className="text-xs text-slate-400">(aanbevolen)</span>}
                </span>
                {!ok && <span className="text-xs font-medium text-emerald-700">Invullen →</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        De score telt foto, omschrijving, categorie, duurzaamheid, compliance en documenten.
      </p>
    </div>
  );
}
