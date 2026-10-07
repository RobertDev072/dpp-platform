import Card from "@/components/ui/Card";

// Statische hulppagina voor het company-gebied: wat kan een Bedrijfsbeheerder,
// wat kan een Medewerker. Bewust zonder e-mailadressen of telefoonnummers.
export default function CompanyHelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Help &amp; support</h1>
        <p className="mt-1 text-sm text-slate-500">
          Wat je in VeriPasso kunt doen, per rol in je organisatie.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Als Bedrijfsbeheerder</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <span className="font-medium text-slate-900">Medewerkers beheren</span> — maak
            accounts aan, wijzig rollen en statussen en reset wachtwoorden via{" "}
            <span className="font-medium">Medewerkers</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Abonnement inzien</span> — bekijk je
            plan, de geldigheid en het verbruik via{" "}
            <span className="font-medium">Abonnement</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Bedrijfsprofiel bijhouden</span> — pas
            de bedrijfsnaam en het logo aan via{" "}
            <span className="font-medium">Bedrijfsinstellingen</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Alles van een Medewerker</span> — ook
            producten, documenten en QR-codes beheer je gewoon zelf.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Als Medewerker</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <span className="font-medium text-slate-900">Producten beheren</span> — maak
            productpaspoorten aan, vul ze aan en publiceer ze via{" "}
            <span className="font-medium">Producten</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Documenten toevoegen</span> — upload
            documenten bij een product; het volledige overzicht vind je onder{" "}
            <span className="font-medium">Documenten</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">QR-codes downloaden</span> — haal per
            gepubliceerd product de QR-code op (PNG, SVG of PDF-label) via{" "}
            <span className="font-medium">QR-codes</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Eigen profiel</span> — wijzig je naam
            via <span className="font-medium">Mijn profiel</span>; je wachtwoord herstel je met
            Wachtwoord vergeten op de loginpagina.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Vragen?</h2>
        <p className="text-sm text-slate-600">
          Neem contact op met VeriPasso. Vragen over je abonnement of extra medewerkers kan je
          Bedrijfsbeheerder ook via jullie partner laten lopen.
        </p>
      </Card>
    </div>
  );
}
