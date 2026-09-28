import Link from "next/link";
import Logo from "@/components/ui/Logo";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <Link
            href="/login"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Inloggen
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Het Digital Product Passport voor Europese regelgeving, van dag één in orde
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            DPP Platform helpt merken en fabrikanten om duurzaamheid, herkomst en
            naleving inzichtelijk te maken. Eén centrale plek voor productdata,
            documenten en certificaten, direct beschikbaar voor klanten, toezichthouders
            en partners in de keten.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Inloggen
            </Link>
            <a
              href="#features"
              className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Ontdek de mogelijkheden
            </a>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="flex flex-col gap-3">
              <Badge variant="warning">Compliance</Badge>
              <h2 className="text-lg font-semibold text-slate-900">
                Voorbereid op EU-regelgeving
              </h2>
              <p className="text-sm text-slate-600">
                Voldoe aantoonbaar aan de Ecodesign for Sustainable Products Regulation
                (ESPR) en de aankomende EU-verordening voor het Digital Product
                Passport. Leg verplichte productinformatie, conformiteitsverklaringen
                en certificaten vast in een auditklare structuur, zodat u niet wordt
                verrast door nieuwe rapportageverplichtingen.
              </p>
            </Card>

            <Card className="flex flex-col gap-3">
              <Badge variant="success">Duurzaamheid</Badge>
              <h2 className="text-lg font-semibold text-slate-900">
                Inzicht in duurzaamheid
              </h2>
              <p className="text-sm text-slate-600">
                Breng CO2-voetafdruk, gebruikte materialen en recyclebaarheid per
                product in kaart. Deel deze gegevens met inkopers, consumenten en
                ketenpartners, en onderbouw duurzaamheidsclaims met controleerbare
                data in plaats van losse spreadsheets.
              </p>
            </Card>

            <Card className="flex flex-col gap-3">
              <Badge variant="info">QR-paspoort</Badge>
              <h2 className="text-lg font-semibold text-slate-900">
                Eén scan, het volledige paspoort
              </h2>
              <p className="text-sm text-slate-600">
                Genereer per product een unieke QR-code die rechtstreeks naar het
                publieke productpaspoort leidt. Klanten, monteurs en inspecteurs
                scannen de code en zien direct herkomst, documentatie en
                duurzaamheidsinformatie, zonder in te loggen.
              </p>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">
        © 2026 DPP Platform. Alle rechten voorbehouden.
      </footer>
    </div>
  );
}
