"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";
import ProductsTable from "@/components/ProductsTable";

export default function ProductsPage() {
  const toast = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  // Wisselt van waarde na elk aangemaakt product, zodat de tabel opnieuw laadt.
  const [reloadToken, setReloadToken] = useState(0);

  async function handleCreate(event) {
    event.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      await api.post("/api/products", {
        name,
        brand: brand || undefined,
        sku: sku || undefined
      });
      toast.success(`Product ${name} aangemaakt`);
      setName("");
      setBrand("");
      setSku("");
      setShowCreate(false);
      setReloadToken((prev) => prev + 1);
    } catch (err) {
      setFormError(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Producten</h1>
        <Button type="button" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Sluiten" : "Nieuw product"}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuw product</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <FormError error={formError} />

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Naam"
                name="name"
                required
                autoComplete="off"
                placeholder="Bijv. Hoekbank Oslo"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Field
                label="Merk"
                name="brand"
                autoComplete="off"
                placeholder="Bijv. VeriPasso Home"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
              <Field
                label="SKU"
                name="sku"
                autoComplete="off"
                placeholder="Bijv. HB-OSLO-01"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>

            <p className="text-xs text-slate-400">
              Foto, categorie en overige gegevens voeg je na het aanmaken toe op de productpagina.
            </p>

            <SubmitButton loading={creating}>Aanmaken</SubmitButton>
          </form>
        </Card>
      )}

      <ProductsTable reloadToken={reloadToken} />
    </div>
  );
}
