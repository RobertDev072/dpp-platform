import { DPP_VOCABULARY } from "@/lib/dppVocabulary";

export const metadata = {
  title: "VeriPasso DPP-vocabulaire",
  description: "Definities van de velden in VeriPasso digitale productpaspoorten (dictionaryReference)."
};

// Publieke, stabiele definities: elke dictionaryReference "…/vocab/dpp#term" in een
// paspoort verwijst naar een anker op deze pagina. Termen worden nooit hernoemd of
// verwijderd; een nieuwe betekenis krijgt een nieuwe term.
export default function DppVocabularyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-slate-800">
      <h1 className="text-2xl font-semibold text-slate-900">VeriPasso DPP-vocabulaire</h1>
      <p className="mt-2 text-sm text-slate-600">
        Definities van de velden in de machineleesbare paspoorten (JSON, JSON-LD, XML). Velden die schema.org of GS1
        al eenduidig definiëren, verwijzen daarheen; deze pagina beschrijft de overige. Structuurversie:{" "}
        <code>dppSchemaVersion</code> 1.0.0.
      </p>
      <dl className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
        {DPP_VOCABULARY.map((term) => (
          <div key={term.id} id={term.id} className="scroll-mt-6 py-4">
            <dt className="font-mono text-sm font-semibold text-slate-900">
              <a href={`#${term.id}`} className="hover:underline">
                {term.id}
              </a>
            </dt>
            <dd className="mt-1 text-sm text-slate-700">{term.definition}</dd>
            <dd className="mt-1 text-xs text-slate-500">
              Type: {term.type}
              {term.unit ? ` · eenheid: ${term.unit}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
