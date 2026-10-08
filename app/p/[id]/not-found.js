import { VeriPassoWordmark } from "@/components/landing/VeriPassoLogo";

// Getoond voor een onbekende QR-code én voor een gereserveerde code van een nog
// niet gepubliceerd product. Bewust dezelfde tekst in beide gevallen: zo verraadt
// de pagina niet of er achter een code een (nog geheim) product schuilgaat.
export default function PassportNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="5" height="5" rx="1" />
            <rect x="12" y="3" width="5" height="5" rx="1" />
            <rect x="3" y="12" width="5" height="5" rx="1" />
            <path d="M12 12h2.5v2.5H12zM17 12v2.5M14.5 17H12" />
          </svg>
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Productpaspoort nog niet beschikbaar</h1>
        <p className="mt-2 text-sm text-slate-600">
          Bij deze QR-code is (nog) geen openbaar productpaspoort gepubliceerd. Probeer het later opnieuw of neem contact op met de fabrikant.
        </p>
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <span>Digitaal productpaspoort via</span>
          <VeriPassoWordmark className="h-4 w-auto" />
        </div>
      </div>
    </div>
  );
}
