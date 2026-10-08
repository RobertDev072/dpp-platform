"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Field from "@/components/ui/Field";
import Button, { ButtonLink } from "@/components/ui/Button";
import FormError from "@/components/ui/FormError";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import ProductsTable from "@/components/ProductsTable";
import { PlusIcon, UploadIcon } from "@/components/ui/icons";

function NewProductDialog({ open, onClose }) {
  const toast = useToast();
  const router = useRouter();
  const [values, setValues] = useState({ name: "", sku: "", brand: "", categoryLabel: "" });
  const [errors, setErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (open) {
      setValues({ name: "", sku: "", brand: "", categoryLabel: "" });
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const set = (name) => (e) => setValues((prev) => ({ ...prev, [name]: e.target.value }));

  async function handleCreate(event) {
    event.preventDefault();
    setFormError(null);
    if (!values.name.trim()) {
      setErrors({ name: "Vul een productnaam in" });
      return;
    }
    setCreating(true);
    try {
      const body = { name: values.name.trim() };
      for (const key of ["sku", "brand", "categoryLabel"]) if (values[key].trim()) body[key] = values[key].trim();
      const product = await api.post("/api/products", body);
      toast.success(`Product ${product.name} aangemaakt`);
      router.push(`/company/products/${product.id}`);
    } catch (err) {
      const fieldErrors = err.fieldErrors ? Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])) : null;
      if (fieldErrors && Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else setFormError(err);
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nieuw product"
      description="Begin met de basis; foto, duurzaamheid, compliance en documenten vul je daarna in de editor aan."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button variant="accent" type="submit" form="new-product-form" loading={creating}>
            Aanmaken en verder
          </Button>
        </>
      }
    >
      <form id="new-product-form" onSubmit={handleCreate} noValidate className="space-y-4">
        <FormError error={formError} />
        <Field label="Productnaam" name="name" required autoComplete="off" placeholder="Bijv. Hoekbank Oslo" value={values.name} onChange={set("name")} error={errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU / artikelnummer" name="sku" autoComplete="off" placeholder="Bijv. HB-OSLO-01" value={values.sku} onChange={set("sku")} error={errors.sku} />
          <Field label="Merk" name="brand" autoComplete="off" value={values.brand} onChange={set("brand")} error={errors.brand} />
          <Field label="Categorie" name="categoryLabel" autoComplete="off" placeholder="Bijv. Banken" className="sm:col-span-2" value={values.categoryLabel} onChange={set("categoryLabel")} error={errors.categoryLabel} />
        </div>
        <p className="text-xs text-slate-500">Het product wordt aangemaakt als concept en is pas openbaar na publiceren.</p>
      </form>
    </Modal>
  );
}

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [showCreate, setShowCreate] = useState(searchParams.get("new") === "1");

  function closeCreate() {
    setShowCreate(false);
    if (searchParams.get("new")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Producten"
        description="Beheer digitale productpaspoorten, documentatie en publicatiestatus. Selecteer producten voor bulkacties zoals publiceren, QR-codes en labels."
        actions={
          <>
            <ButtonLink href="/company/products/import" icon={UploadIcon}>
              Importeren
            </ButtonLink>
            <Button variant="accent" icon={PlusIcon} onClick={() => setShowCreate(true)}>
              Product
            </Button>
          </>
        }
      />
      <ProductsTable showStats />
      <NewProductDialog open={showCreate} onClose={closeCreate} />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageInner />
    </Suspense>
  );
}
