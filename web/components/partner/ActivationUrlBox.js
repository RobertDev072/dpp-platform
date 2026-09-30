"use client";

import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Eenmalige weergave van de activatielink van een Company Admin-uitnodiging.
// Het token zit alleen in het aanmaak-antwoord en is daarna nooit meer
// opvraagbaar — vandaar de nadrukkelijke waarschuwing en de kopieerknop.
export default function ActivationUrlBox({ activationUrl, email }) {
  const toast = useToast();

  if (!activationUrl) {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(activationUrl);
      toast.success("Activatielink gekopieerd naar het klembord");
    } catch {
      toast.error("Kopiëren mislukt — selecteer de link en kopieer handmatig");
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 text-sm font-medium text-amber-800">
        Activatielink{email ? ` voor ${email}` : ""} — deze wordt maar één keer getoond en is
        daarna niet meer opvraagbaar. Kopieer de link nu en deel deze zelf veilig met de
        Company Admin.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label="Activatielink"
          value={activationUrl}
          onClick={(e) => e.target.select()}
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
        />
        <Button type="button" variant="outline" onClick={handleCopy} className="shrink-0 bg-white">
          Kopiëren
        </Button>
      </div>
    </div>
  );
}
