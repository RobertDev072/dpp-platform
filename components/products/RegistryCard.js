"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

const STATUS = {
  none: ["neutral", "Niet aangemeld"],
  queued: ["info", "In de wachtrij"],
  registered: ["success", "Geregistreerd"],
  failed: ["warning", "Nieuwe poging gepland"]
};

// Aanmelden bij het EU DPP-register (RegisterProductDPP). Het register is nog niet
// operationeel: aanmeldingen wachten en worden automatisch verstuurd zodra het er is.
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
      toast.success("Aanmelding voor het EU-register opgeslagen");
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
          ? "Aanmeldingen worden automatisch naar het Europese register gestuurd."
          : "Het Europese register is nog niet in gebruik. Meld het paspoort nu aan; VeriPasso verstuurt de aanmelding automatisch zodra het register beschikbaar is."}
      </p>
      {reg?.registered_at && <p className="text-xs text-slate-500">Geregistreerd op {new Date(reg.registered_at).toLocaleString("nl-NL")}</p>}
      {reg?.status !== "registered" && (
        <Button type="button" variant="outline" loading={busy} disabled={!product.published_at} onClick={register}>
          {reg?.status && reg.status !== "none" ? "Opnieuw aanmelden" : "Aanmelden bij EU-register"}
        </Button>
      )}
      {!product.published_at && <p className="text-xs text-slate-400">Publiceer het paspoort eerst.</p>}
    </Card>
  );
}
