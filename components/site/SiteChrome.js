import Link from "next/link";

// Kop en voet van de openbare websitepagina's (blog, DPP-check), in het Nederlands of Engels.
export const SITE_TEXT = {
  nl: {
    home: "/",
    blog: "/blog",
    check: "/dpp-check",
    nav: { blog: "Blog", check: "DPP-check", login: "Inloggen", demo: "Demo aanvragen" },
    footerPitch: "Digitale productpaspoorten met een QR-code die altijd werkt.",
    footerSub: "Productgegevens, documenten en QR-codes op één plek, volgens de Europese regels.",
    product: "Product",
    resources: "Kennis",
    contact: "Contact",
    howItWorks: "Hoe het werkt",
    whatIsDpp: "Wat is een DPP?",
    rights: "© 2026 VeriPasso, een platform van Robertdev.nl",
    other: { label: "English", href: "/en/blog" }
  },
  en: {
    home: "/",
    blog: "/en/blog",
    check: "/en/dpp-check",
    nav: { blog: "Blog", check: "DPP check", login: "Log in", demo: "Request a demo" },
    footerPitch: "Digital product passports with a QR code that always works.",
    footerSub: "Product data, documents and QR codes in one place, in line with EU rules.",
    product: "Product",
    resources: "Resources",
    contact: "Contact",
    howItWorks: "How it works",
    whatIsDpp: "What is a DPP?",
    rights: "© 2026 VeriPasso, a platform by Robertdev.nl",
    other: { label: "Nederlands", href: "/blog" }
  }
};

export function LogoMark({ className = "h-8 w-8" }) {
  return (
    <svg className={className} viewBox="0 0 280 280" aria-hidden="true">
      <path fill="#72E600" d="M34 42C20 52 18 72 27 91l78 145c8 15 29 16 38 1l24-42-68-132C85 36 55 27 34 42Z" />
      <path fill="#1476FF" d="M222 38c21-9 40 10 35 32l-31 142c-3 14-12 26-25 33l-59 31c-14 7-30-4-26-20l49-181c7-18 31-30 57-37Z" />
      <path fill="#FFFFFF" d="M174 91h47c7 0 12 5 12 12s-5 12-12 12h-47c-7 0-12-5-12-12s5-12 12-12Zm-10 45h48c7 0 12 5 12 12s-5 12-12 12h-48c-7 0-12-5-12-12s5-12 12-12Z" />
    </svg>
  );
}

// otherHref: link naar dezelfde pagina in de andere taal (valt terug op de blog).
export function SiteHeader({ lang = "nl", otherHref }) {
  const t = SITE_TEXT[lang];
  return (
    <header className="relative z-10">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-5 sm:px-6" aria-label={lang === "nl" ? "Hoofdmenu" : "Main menu"}>
        <a href={t.home} className="flex items-center gap-2 text-white no-underline">
          <LogoMark />
          <span className="text-xl font-semibold tracking-tight">VeriPasso</span>
        </a>
        <ul className="order-3 flex w-full items-center gap-5 text-[0.9375rem] font-semibold text-white/85 sm:order-none sm:w-auto">
          <li><Link className="no-underline hover:text-white" href={t.blog}>{t.nav.blog}</Link></li>
          <li><Link className="no-underline hover:text-white" href={t.check}>{t.nav.check}</Link></li>
          <li><Link className="no-underline hover:text-white" href={otherHref || t.other.href} hrefLang={lang === "nl" ? "en" : "nl"}>{t.other.label}</Link></li>
        </ul>
        <div className="ml-auto flex items-center gap-4">
          <a className="hidden text-[0.9375rem] font-semibold text-white/85 no-underline hover:text-white sm:inline" href="https://app.veripasso.com/login">{t.nav.login}</a>
          <a className="site-btn !py-2.5 text-[0.9375rem]" href="/#start">{t.nav.demo}</a>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter({ lang = "nl" }) {
  const t = SITE_TEXT[lang];
  return (
    <footer className="site-hero mt-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">{t.footerPitch}</h2>
          <p className="mt-3 text-white/75">{t.footerSub}</p>
          <a className="site-btn mt-6" href="/#start">{t.nav.demo}</a>
        </div>
        <div>
          <h3 className="font-semibold">{t.product}</h3>
          <ul className="mt-3 space-y-2 text-white/75">
            <li><a className="no-underline hover:text-white" href="/#paspoort">{t.howItWorks}</a></li>
            <li><a className="no-underline hover:text-white" href="/#dpp">{t.whatIsDpp}</a></li>
            <li><a className="no-underline hover:text-white" href="https://app.veripasso.com/login">{t.nav.login}</a></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t.resources}</h3>
          <ul className="mt-3 space-y-2 text-white/75">
            <li><Link className="no-underline hover:text-white" href={t.blog}>{t.nav.blog}</Link></li>
            <li><Link className="no-underline hover:text-white" href={t.check}>{t.nav.check}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t.contact}</h3>
          <ul className="mt-3 space-y-2 text-white/75">
            <li><a className="no-underline hover:text-white" href="mailto:rb085@icloud.com">rb085@icloud.com</a></li>
            <li><a className="no-underline hover:text-white" href="tel:+31641227451">+31 6 41227451</a></li>
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-10 text-sm text-white/60 sm:px-6">{t.rights}</p>
    </footer>
  );
}
