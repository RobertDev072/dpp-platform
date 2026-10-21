"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import { useToast } from "@/components/ui/Toast";
import { REMINDER_DAYS, verificationExpiry } from "@/lib/euVerification";

const day = (value) => (value ? String(value).slice(0, 10) : "");
const format = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

// Verificatie in het EU DPP-register: verloopt met het zegel, en uiterlijk 3 jaar na de
// eerste verificatie. Beide datums zijn optioneel; met een datum herinnert VeriPasso de
// beheerder via de meldingen (belletje) 60 dagen van tevoren.
export default function EuVerificationCard({ company }) {
  const toast = useToast();
  const [verifiedAt, setVerifiedAt] = useState(day(company.eu_verified_at));
  const [sealExpiresAt, setSealExpiresAt] = useState(day(company.eu_seal_expires_at));
  const [saving, setSaving] = useState(false);
  const expiry = verificationExpiry({ verifiedAt, sealExpiresAt });

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await api.patch("/api/company", { euVerifiedAt: verifiedAt || null, euSealExpiresAt: sealExpiresAt || null });
      setVerifiedAt(day(updated.eu_verified_at));
      setSealExpiresAt(day(updated.eu_seal_expires_at));
      toast.success("Datums opgeslagen");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">EU-register: verificatie van je bedrijf</h2>
          <p className="mt-1 text-xs text-slate-500">
            Optioneel. De verificatie verloopt als je zegel verloopt, en uiterlijk 3 jaar na je eerste verificatie. Vul de datums in;
            VeriPasso geeft dan {REMINDER_DAYS} dagen van tevoren een melding (bij het belletje).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Datum EU-verificatie" name="euVerifiedAt" type="date" value={verifiedAt} onChange={(e) => setVerifiedAt(e.target.value)} />
          <Field label="Vervaldatum zegel" name="euSealExpiresAt" type="date" value={sealExpiresAt} onChange={(e) => setSealExpiresAt(e.target.value)} />
        </div>
        {expiry && (
          <p className={`text-sm ${expiry.expired ? "text-red-700" : expiry.remind ? "text-amber-700" : "text-slate-600"}`}>
            {expiry.expired ? "Verlopen op " : "Verloopt op "}
            <strong>{format(expiry.expiresOn)}</strong> ({expiry.reason}){expiry.expired ? ". Verifieer opnieuw in het EU-register." : "."}
          </p>
        )}
        <SubmitButton loading={saving}>Opslaan</SubmitButton>
      </form>
    </Card>
  );
}
