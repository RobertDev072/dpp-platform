const ROW_ONE = [
  "Waar is dit product gemaakt?",
  "Welke materialen zitten erin?",
  "Hoe groot is de CO2-voetafdruk?",
  "Is dit product recyclebaar?",
  "Welke certificaten horen erbij?",
  "Hoe repareer ik dit onderdeel?"
];

const ROW_TWO = [
  "Voldoet dit aan de ESPR?",
  "Wie is de fabrikant?",
  "Waar vind ik de conformiteitsverklaring?",
  "Hoe lang gaat dit mee?",
  "Welke onderdelen zijn vervangbaar?",
  "Hoe lever ik dit in na gebruik?"
];

function MarqueeRow({ items, direction }) {
  const animationClass = direction === "left" ? "animate-marquee-left" : "animate-marquee-right";
  return (
    <div className="flex overflow-hidden">
      <div className={`flex shrink-0 gap-3 pr-3 ${animationClass}`}>
        {[...items, ...items].map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm"
          >
            <span className="text-emerald-600">●</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FaqMarquee() {
  return (
    <section className="border-y border-slate-200 bg-slate-100 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
          Klanten, inkopers en toezichthouders stellen vragen. VeriPasso geeft het antwoord
          met een scan.
        </h2>
      </div>
      <div className="mt-10 space-y-3">
        <MarqueeRow items={ROW_ONE} direction="left" />
        <MarqueeRow items={ROW_TWO} direction="right" />
      </div>
    </section>
  );
}
