import Card from "@/components/ui/Card";

// Statische hulppagina voor Partner Admins: wat kun je hier, en waar klop je
// aan met vragen. Bewust zonder e-mailadressen of telefoonnummers.
export default function PartnerHelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Help &amp; support</h1>
        <p className="mt-1 text-sm text-slate-500">
          Wat je als partner in VeriPasso kunt doen, in het kort.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Wat kun je als partner?</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <span className="font-medium text-slate-900">Klanten onboarden</span> — maak via{" "}
            <span className="font-medium">Mijn klanten</span> een nieuw klantbedrijf aan en kies
            direct een plan.
          </li>
          <li>
            <span className="font-medium text-slate-900">Eerste Bedrijfsbeheerder uitnodigen</span>{" "}
            — verstuur vanaf de detailpagina van een klant een activatielink; de status volg je op{" "}
            <span className="font-medium">Uitnodigingen</span>.
          </li>
          <li>
            <span className="font-medium text-slate-900">Licenties inzien</span> — op{" "}
            <span className="font-medium">Licenties</span> zie je per klant het plan, de
            geldigheid en het verbruik. Wijzigingen lopen via VeriPasso.
          </li>
          <li>
            <span className="font-medium text-slate-900">Wachtwoord resetten</span> — reset op de
            detailpagina van een klant het wachtwoord van een Bedrijfsbeheerder; je ontvangt
            eenmalig een tijdelijk wachtwoord om veilig te delen.
          </li>
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Producten, documenten en medewerkers van klantbedrijven blijven bewust buiten je
          bereik: die beheert de klant zelf.
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Vragen?</h2>
        <p className="text-sm text-slate-600">
          Neem contact op met VeriPasso. Je vaste contactpersoon helpt je verder met licenties,
          nieuwe klanten en technische vragen.
        </p>
      </Card>
    </div>
  );
}
