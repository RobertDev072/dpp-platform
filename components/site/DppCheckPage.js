import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import DppCheck from "@/components/site/DppCheck";
import { SITE_URL } from "@/lib/blog";

// Pagina van de gratis DPP-check (/dpp-check en /en/dpp-check).
const TEXT = {
  nl: {
    title: "Moet mijn product een digitaal productpaspoort hebben?",
    meta: "Gratis DPP-check: moet mijn product een digitaal productpaspoort hebben?",
    intro: "Beantwoord vier korte vragen en zie direct of het digitale productpaspoort (DPP) voor jouw product verplicht is, en vanaf wanneer. Gratis, zonder registratie.",
    faq: [
      ["Wat is een digitaal productpaspoort?", "Een digitaal productpaspoort (DPP) is een online dossier per product, bereikbaar via een QR-code. Het bevat onder meer informatie over materialen, herkomst, duurzaamheid, reparatie en recycling, zoals de Europese Unie voorschrijft."],
      ["Voor welke producten is het paspoort al verplicht?", "Als eerste voor batterijen voor elektrische auto's, voor licht vervoer (zoals e-bikes) en voor industriële batterijen boven 2 kWh: vanaf 18 februari 2027. Andere productgroepen, zoals textiel, staal, aluminium, banden en meubels, volgen via de Ecodesignverordening (ESPR)."],
      ["Wie moet het paspoort maken?", "De fabrikant of de importeur die het product in de EU op de markt brengt. Winkels en webshops moeten ervoor zorgen dat klanten het paspoort kunnen bekijken."]
    ]
  },
  en: {
    title: "Does my product need a digital product passport?",
    meta: "Free DPP check: does my product need a digital product passport?",
    intro: "Answer four short questions and see straight away whether the digital product passport (DPP) is mandatory for your product, and from when. Free, no sign-up.",
    faq: [
      ["What is a digital product passport?", "A digital product passport (DPP) is an online record per product, accessed through a QR code. It holds information on materials, origin, sustainability, repair and recycling, as required by the European Union."],
      ["Which products already need a passport?", "First up are electric vehicle batteries, light means of transport batteries (such as e-bikes) and industrial batteries above 2 kWh: from 18 February 2027. Other product groups such as textiles, steel, aluminium, tyres and furniture follow under the Ecodesign Regulation (ESPR)."],
      ["Who has to create the passport?", "The manufacturer or importer placing the product on the EU market. Retailers and web shops must make sure customers can access the passport."]
    ]
  }
};

export function dppCheckMetadata(lang) {
  const t = TEXT[lang];
  const path = lang === "nl" ? "/dpp-check" : "/en/dpp-check";
  return {
    title: t.meta,
    description: t.intro,
    keywords: lang === "nl" ? ["digitaal productpaspoort", "DPP", "DPP verplicht", "batterijpaspoort", "ESPR", "productpaspoort check"] : ["digital product passport", "DPP", "DPP requirements", "battery passport", "ESPR", "DPP check"],
    alternates: { canonical: `${SITE_URL}${path}`, languages: { nl: `${SITE_URL}/dpp-check`, en: `${SITE_URL}/en/dpp-check`, "x-default": `${SITE_URL}/dpp-check` } },
    openGraph: { title: t.meta, description: t.intro, url: `${SITE_URL}${path}`, siteName: "VeriPasso", type: "website", images: [`${SITE_URL}/landing/og.png`] }
  };
}

export function DppCheckPage({ lang }) {
  const t = TEXT[lang];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } }))
  };
  return (
    <div className="site" lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\u003c") }} />
      <div className="site-hero pb-40">
        <SiteHeader lang={lang} otherHref={lang === "nl" ? "/en/dpp-check" : "/dpp-check"} />
        <div className="mx-auto max-w-3xl px-4 pt-10 text-center sm:px-6 sm:pt-14">
          <p className="site-eyebrow justify-center text-white/85">{lang === "nl" ? "Gratis DPP-check" : "Free DPP check"}</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">{t.title}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/75">{t.intro}</p>
        </div>
      </div>
      <main className="mx-auto -mt-28 max-w-3xl px-4 sm:px-6">
        <DppCheck lang={lang} />
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">{lang === "nl" ? "Veelgestelde vragen" : "Frequently asked questions"}</h2>
          <div className="mt-5 space-y-3">
            {t.faq.map(([q, a]) => (
              <details key={q} className="site-card group p-5">
                <summary className="cursor-pointer list-none text-lg font-semibold">{q}</summary>
                <p className="mt-3 text-[#1d2b40]">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
