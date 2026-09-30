"use client";

import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Eenmalige weergave van het tijdelijke wachtwoord na een reset door de
// Partner Admin. Het wachtwoord zit alleen in het reset-antwoord en is daarna
// nooit meer opvraagbaar — zelfde opzet en stijl als ActivationUrlBox.
export default function TempPasswordBox({ tempPassword, email, onClose }) {
  const toast = useToast();

  if (!tempPassword) {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      toast.success("Wachtwoord gekopieerd naar het klembord");
    } catch {
      toast.error("Kopiëren mislukt — selecteer het wachtwoord en kopieer handmatig");
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="mb-2 text-sm font-medium text-amber-800">
          Tijdelijk wachtwoord{email ? ` voor ${email}` : ""} — dit wordt maar één keer getoond
          en is daarna niet meer opvraagbaar. Kopieer het nu en deel het zelf veilig met de
          Company Admin; bij de eerstvolgende login moet die verplicht een nieuw wachtwoord
          instellen.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            Verbergen
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label="Tijdelijk wachtwoord"
          value={tempPassword}
          onClick={(e) => e.target.select()}
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900"
        />
        <Button type="button" variant="outline" onClick={handleCopy} className="shrink-0 bg-white">
          Kopiëren
        </Button>
      </div>
    </div>
  );
}
