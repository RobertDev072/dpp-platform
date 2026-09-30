import Link from "next/link";
import Card from "@/components/ui/Card";
import PassportMockup from "@/components/landing/PassportMockup";
import DashboardPreview from "@/components/landing/DashboardPreview";
import FaqMarquee from "@/components/landing/FaqMarquee";
import ContactForm from "@/components/landing/ContactForm";
import { VeriPassoWordmark } from "@/components/landing/VeriPassoLogo";

const NAV_LINKS = [
  { label: "Product", href: "#platform" },
  { label: "Oplossingen", href: "#features" },
  { label: "Tarieven", href: "#" },
  { label: "Resources", href: "#" },
  { label: "Contact", href: "#contact" }
];

const TRUST_BADGES = ["Veilig", "Altijd bereikbaar", "EU-ready"];

const FEATURES = [
  {
    title: "Centraal beheren",
    description:
      "Alle productdata, bedrijven, gebruikers en licenties samen op een centrale plek."
  },
  {
    title: "Dynamische QR-codes",
    description: "Unieke, dynamische QR-codes voor elk product en elke markt."
  },
  {
    title: "Altijd verifieerbaar",
    description:
      "Actuele en betrouwbare productinformatie, overal en voor iedereen toegankelijk."
  }
];

const STEPS = [
  {
    number: "01",
    title: "Data vastleggen",
    description:
      "Leg productdata, materialen, documenten en certificaten vast in een gestructureerd, auditklaar dossier."
  },
  {
    number: "02",
    title: "Paspoort genereren",
    description:
      "VeriPasso zet de gegevens om in een publiek productpaspoort, met per product een unieke, dynamische QR-code."
  },
  {
    number: "03",
    title: "Delen in de keten",
    description:
      "Klanten, monteurs en inspecteurs scannen de code en zien direct herkomst, documentatie en duurzaamheid, zonder in te loggen.",
    highlight: true
  }
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-white/10 bg-[#06162A]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="VeriPasso home">
            <VeriPassoWordmark background="dark" className="h-7 w-auto" />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-slate-300 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-slate-300 hover:text-white">
              Inloggen
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1476FF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0f5fd1]"
            >
              Start met VeriPasso <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#1476FF]">
                DIGITAAL PRODUCTPASPOORT
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                Elk product zijn eigen paspoort. Altijd verifieerbaar.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-slate-600">
                VeriPasso helpt bedrijven om productdata centraal te beheren, te voorzien
                van dynamische QR-codes en altijd verifieerbaar beschikbaar te maken. Klaar
                voor een transparantere, circulaire en toekomstbestendige keten.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/login"
                  className="rounded-lg bg-[#1476FF] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f5fd1]"
                >
                  Start met VeriPasso →
                </Link>
                <a
                  href="#zo-werkt-het"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <span aria-hidden="true">▶</span> Bekijk hoe het werkt
                </a>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-slate-500">
                {TRUST_BADGES.map((badge) => (
                  <span key={badge} className="flex items-center gap-1.5">
                    <span className="text-emerald-600">✓</span> {badge}
                  </span>
                ))}
              </div>
            </div>

            <PassportMockup />
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 pb-20">
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="flex flex-col gap-2">
                <h3 className="text-base font-semibold text-slate-900">{feature.title}</h3>
                <p className="text-sm text-slate-600">{feature.description}</p>
              </Card>
            ))}
          </div>
        </section>

        <FaqMarquee />

        <section id="platform" className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#1476FF]">HET PLATFORM</p>
              <h2 className="mt-3 max-w-lg text-3xl font-bold tracking-tight text-slate-900">
                Overzicht over al uw paspoorten, bedrijven en gebruikers
              </h2>
            </div>
            <Link
              href="/login"
              className="text-sm font-semibold text-[#1476FF] hover:text-[#0f5fd1]"
            >
              Naar het dashboard →
            </Link>
          </div>

          <DashboardPreview />
        </section>

        <section id="zo-werkt-het" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-10 text-center">
              <p className="text-xs font-semibold tracking-wide text-[#1476FF]">ZO WERKT HET</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight text-slate-900">
                Van losse spreadsheets naar een verifieerbaar paspoort
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {STEPS.map((step) => (
                <div
                  key={step.number}
                  className={`rounded-xl p-6 ${
                    step.highlight
                      ? "bg-[#06162A] text-white"
                      : "bg-white border border-slate-200 text-slate-900"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      step.highlight ? "text-[#5ea1ff]" : "text-[#1476FF]"
                    }`}
                  >
                    {step.number}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                  <p
                    className={`mt-2 text-sm ${
                      step.highlight ? "text-slate-300" : "text-slate-600"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="mx-auto max-w-6xl px-6 py-20">
          <div className="relative overflow-hidden rounded-2xl bg-[#06162A] px-8 py-14 text-white sm:px-14">
            <div className="relative max-w-xl">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Klaar voor het Digital Product Passport?
              </h2>
              <p className="mt-4 text-slate-300">
                Bekijk in een korte demo hoe VeriPasso uw productdata omzet in een
                verifieerbaar paspoort.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="mailto:rb085@icloud.com?subject=Demo%20VeriPasso%20aanvragen"
                  className="rounded-lg bg-[#1476FF] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f5fd1]"
                >
                  Demo aanvragen →
                </a>
                <Link
                  href="/login"
                  className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                >
                  Inloggen
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Direct contact</h3>
              <p className="mt-2 text-sm text-slate-600">
                Liever meteen schakelen? VeriPasso is rechtstreeks bereikbaar.
              </p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <dt className="text-slate-500">E-mail</dt>
                  <dd>
                    <a href="mailto:rb085@icloud.com" className="font-medium text-[#1476FF] hover:text-[#0f5fd1]">
                      rb085@icloud.com
                    </a>
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-slate-500">Telefoon</dt>
                  <dd>
                    <a href="tel:+31641227451" className="font-medium text-[#1476FF] hover:text-[#0f5fd1]">
                      +31 6 41227451
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
            <Card className="p-5">
              <ContactForm />
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <VeriPassoWordmark background="light" className="h-6 w-auto" />
              <p className="mt-3 max-w-xs text-sm text-slate-500">
                Eén platform voor productdata, dynamische QR-codes en een verifieerbaar
                digitaal productpaspoort.
              </p>
            </div>
            <div className="flex gap-6 text-sm text-slate-500">
              <a href="#" className="hover:text-slate-700">
                Privacy
              </a>
              <a href="#" className="hover:text-slate-700">
                Voorwaarden
              </a>
              <a href="#contact" className="hover:text-slate-700">
                Contact
              </a>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © 2026 VeriPasso. Alle rechten voorbehouden. VeriPasso is een platform van{" "}
              <a
                href="https://robertdev.nl"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-600 hover:text-slate-900"
              >
                Robertdev.nl
              </a>
              .
            </p>
            <p>Ontwikkeld door Robertdev.nl</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
