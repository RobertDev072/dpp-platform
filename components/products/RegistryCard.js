"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

const STATUS = {
  none: ["neutral", "Niet aangemeld"],
  queued: ["info", "Klaargezet"],
  registered: ["success", "Geregistreerd"],
  failed: ["warning", "Nieuwe poging gepland"]
};

// EU DPP-register. Het register is open (sinds juli 2026), maar indienen doet de klant zelf
// (EU Login + gekwalificeerd elektronisch zegel). VeriPasso verstuurt alleen iets als er een
// koppeling is ingesteld (registryConfigured); anders wordt het paspoort alleen klaargezet.
export default function RegistryCard({ product }) {
  const toast = useToast();
  const [reg, setReg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/products/${product.id}/registration`).then(setReg).catch(() => setReg(null));
  }, [product.id]);

  async function register() {
    setBusy(true);
    try {
      setReg(await api.post(`/api/products/${product.id}/register`));
      toast.success("Klaargezet voor het EU-register");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const [variant, label] = STATUS[reg?.status || "none"] || STATUS.none;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">EU DPP-register</h2>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <p className="text-sm text-slate-600">
        {reg?.registryConfigured
          ? "Aanmeldingen worden via de ingestelde koppeling naar het Europese register gestuurd."
          : "VeriPasso meldt paspoorten nog niet zelf aan bij het Europese register. Je bedrijf dient de registratie zelf in, in het EU-register, nadat het daar geverifieerd is (EU Login en een gekwalificeerd elektronisch zegel). Hier zet je het paspoort alvast klaar; een exportbestand voor het register volgt."}
      </p>
      {reg?.registered_at && <p className="text-xs text-slate-500">Geregistreerd op {new Date(reg.registered_at).toLocaleString("nl-NL")}</p>}
      {reg?.status !== "registered" && (
        <Button type="button" variant="outline" loading={busy} disabled={!product.published_at} onClick={register}>
          {reg?.status && reg.status !== "none" ? "Opnieuw klaarzetten" : "Klaarzetten voor EU-register"}
        </Button>
      )}
      {!product.published_at && <p className="text-xs text-slate-400">Publiceer het paspoort eerst.</p>}
    </Card>
  );
}
