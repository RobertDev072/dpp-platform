"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { formatDateTime } from "@/lib/format";
import Card from "@/components/ui/Card";
import Button, { ButtonLink } from "@/components/ui/Button";
import Tabs from "@/components/ui/Tabs";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import Skeleton from "@/components/ui/Skeleton";
import FileDropzone from "@/components/ui/FileDropzone";
import StatusBadge, { QrStatusBadge, QR_STATUS_HELP } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import NumberField from "@/components/products/NumberField";
import DocumentsTab from "@/components/products/DocumentsTab";
import ProductCompleteness from "@/components/products/ProductCompleteness";
import PrintExportDialog from "@/components/print/PrintExportDialog";
import { missingItems } from "@/lib/completeness";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  DownloadIcon,
  ExternalIcon,
  LinkIcon,
  PrinterIcon,
  QrIcon,
  XIcon
} from "@/components/ui/icons";

const TABS = [
  { key: "basis", label: "Basisinformatie" },
  { key: "sustainability", label: "Duurzaamheid" },
  { key: "compliance", label: "Compliance" },
  { key: "documents", label: "Documenten" },
  { key: "qr", label: "QR & print" }
];
const TAB_KEYS = TABS.map((t) => t.key);
// Oude links (?tab=overview) blijven werken.
const TAB_ALIASES = { overview: "basis" };

function percentageValidator(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) return "Vul een percentage tussen 0 en 100 in";
  return null;
}

function nonNegativeValidator(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) return "Vul een waarde van 0 of hoger in";
  return null;
}

function gtinValidator(value) {
  const digits = String(value || "").replace(/[\s-]/g, "");
  if (!digits) return null;
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return "Een GTIN/EAN heeft 8, 12, 13 of 14 cijfers";
  return null;
}

function ProductEditor() {
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const requestedTab = TAB_ALIASES[searchParams.get("tab")] || searchParams.get("tab");
  const tab = TAB_KEYS.includes(requestedTab) ? requestedTab : "basis";

  const loadProduct = useCallback(async () => {
    const data = await api.get(`/api/products/${id}`);
    setProduct(data);
    return data;
  }, [id]);

  useEffect(() => {
    loadProduct().catch((err) => setError(err.message));
  }, [loadProduct]);

  function goTo(nextTab, field) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    if (field) {
      // Na het wisselen van tab het betreffende veld in beeld en in focus.
      setTimeout(() => {
        const el = document.getElementById(field === "photo" ? "product-photo" : field);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus?.({ preventScroll: true });
      }, 60);
    }
  }

  async function handlePublish() {
    const missing = missingItems(product.checks);
    const ok = await confirm({
      title: "Product publiceren?",
      message:
        missing.length > 0
          ? `Het paspoort is ${product.completeness}% compleet (ontbreekt: ${missing.map((m) => m.label.toLowerCase()).join(", ")}). Na publiceren is het openbaar via de QR-code, ook als het nog niet compleet is.`
          : "Het paspoort wordt openbaar via de QR-code. Een gepubliceerde QR-code blijft altijd werken, ook na archiveren.",
      confirmLabel: missing.length > 0 ? "Toch publiceren" : "Publiceren"
    });
    if (!ok) return;
    setBusy("publish");
    try {
      await api.post(`/api/products/${id}/publish`);
      await loadProduct();
      toast.success("Product gepubliceerd — de QR-code is nu actief");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  }

  async function handleArchive() {
    const ok = await confirm({
      title: "Product archiveren?",
      message:
        product.qr_status === "active"
          ? "Het product verdwijnt uit je actieve lijst en telt niet meer mee voor je limiet. De gedrukte QR-code blijft werken en toont het paspoort als gearchiveerd."
          : "Het product verdwijnt uit je actieve lijst en telt niet meer mee voor je limiet.",
      confirmLabel: "Archiveren",
      tone: "danger"
    });
    if (!ok) return;
    setBusy("archive");
    try {
      await api.delete(`/api/products/${id}`);
      await loadProduct();
      toast.success("Product gearchiveerd");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  }

  async function handleRestore() {
    setBusy("restore");
    try {
      // Een product met een (ooit) actieve QR-code komt terug als gepubliceerd, zodat
      // de gedrukte code blijft werken; anders als concept.
      if (product.public_id && product.published_at) {
        await api.post(`/api/products/${id}/publish`);
      } else {
        await api.patch(`/api/products/${id}`, { status: "draft" });
      }
      await loadProduct();
      toast.success("Product hersteld");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  }

  async function handleDuplicate() {
    setBusy("duplicate");
    try {
      const copy = await api.post(`/api/products/${id}/duplicate`);
      toast.success("Kopie aangemaakt");
      router.push(`/company/products/${copy.id}`);
    } catch (err) {
      toast.error(err.message);
      setBusy("");
    }
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 text-sm text-red-700">
        <p>{error === "Niet gevonden" ? "Dit product bestaat niet of je hebt er geen toegang toe." : `We konden het product niet laden: ${error}`}</p>
        <Link href="/company/products" className="mt-2 inline-block font-medium underline">
          Terug naar producten
        </Link>
      </Card>
    );
  }

  if (!product) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 w-full lg:col-span-2" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const complete = product.completeness >= 100;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/company/products" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeftIcon size={14} /> Producten
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold text-slate-900">{product.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <StatusBadge status={product.status} />
              <QrStatusBadge status={product.qr_status} />
              {product.sku && <span>SKU {product.sku}</span>}
              <span>Gewijzigd {formatDateTime(product.updated_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {product.qr_status === "active" && (
              <ButtonLink href={`/p/${product.public_id}`} external target="_blank" rel="noopener noreferrer" icon={ExternalIcon} size="sm">
                Paspoort bekijken
              </ButtonLink>
            )}
            <Button variant="outline" size="sm" icon={CopyIcon} onClick={handleDuplicate} loading={busy === "duplicate"} title="Maak een kopie als nieuw concept">
              Dupliceren
            </Button>
            {product.status === "archived" ? (
              <Button variant="outline" size="sm" onClick={handleRestore} loading={busy === "restore"}>
                Herstellen
              </Button>
            ) : (
              <Button variant="outline" size="sm" icon={ArchiveIcon} onClick={handleArchive} loading={busy === "archive"}>
                Archiveren
              </Button>
            )}
            {product.status === "draft" && (
              <Button variant="accent" size="sm" icon={CheckIcon} onClick={handlePublish} loading={busy === "publish"}>
                Publiceren
              </Button>
            )}
          </div>
        </div>
        <PublicationSteps product={product} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-x-auto">
            <Tabs tabs={TABS} active={tab} onChange={(key) => goTo(key)} />
          </div>
          {tab === "basis" && <BasisTab product={product} onSaved={loadProduct} />}
          {tab === "sustainability" && <SustainabilityTab productId={id} onSaved={loadProduct} />}
          {tab === "compliance" && <ComplianceTab productId={id} onSaved={loadProduct} onOpenDocuments={() => goTo("documents")} />}
          {tab === "documents" && <DocumentsTab productId={id} onChanged={loadProduct} />}
          {tab === "qr" && <QrTab product={product} onChanged={loadProduct} onPrint={() => setPrintOpen(true)} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Paspoort-compleetheid</h2>
            <ProductCompleteness completeness={product.completeness} checks={product.checks} qrStatus={product.qr_status} onNavigate={goTo} />
            {product.status === "draft" && complete && (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Alles is ingevuld. Je kunt het product publiceren.</p>
            )}
          </Card>
        </aside>
      </div>

      <PrintExportDialog open={printOpen} onClose={() => setPrintOpen(false)} selection={{ ids: [product.id] }} count={1} onDone={loadProduct} />
    </div>
  );
}

// Concept → Compleet → Gepubliceerd (→ Gearchiveerd). "Compleet" is afgeleid
// (100% compleetheid), geen opgeslagen status.
function PublicationSteps({ product }) {
  const steps = [
    { key: "draft", label: "Concept", done: true },
    { key: "complete", label: "Compleet", done: product.completeness >= 100 },
    { key: "published", label: "Gepubliceerd", done: product.status === "published" || (product.status === "archived" && Boolean(product.published_at)) }
  ];
  if (product.status === "archived") steps.push({ key: "archived", label: "Gearchiveerd", done: true });
  return (
    <ol aria-label="Publicatiestappen" className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true" className={`h-px w-6 ${step.done ? "bg-emerald-400" : "bg-slate-200"}`} />}
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${step.done ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            {step.done && <CheckIcon size={12} />}
            {step.label}
            <span className="sr-only">{step.done ? "(bereikt)" : "(nog niet)"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function BasisTab({ product, onSaved }) {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const form = useForm({
    initial: {
      name: product.name || "",
      sku: product.sku || "",
      gtin: product.gtin || "",
      model: product.model || "",
      categoryLabel: product.category_label || "",
      brand: product.brand || "",
      manufacturer: product.manufacturer || "",
      countryOfOrigin: product.country_of_origin || "",
      description: product.description || "",
      photoUrl: product.photo_url || ""
    },
    validators: {
      name: (value) => (String(value || "").trim() ? null : "Vul een productnaam in"),
      gtin: gtinValidator
    }
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    api.get("/api/products/categories").then((data) => setCategories(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) return;
    setSaving(true);
    try {
      const { gtin, ...rest } = form.values;
      await api.patch(`/api/products/${product.id}`, { ...rest, gtin: gtin.replace(/[\s-]/g, "") });
      toast.success("Gegevens opgeslagen");
      await onSaved();
    } catch (err) {
      if (!form.applyServerErrors(err)) setFormError(err);
    } finally {
      setSaving(false);
    }
  }

  const field = (name, label, props = {}) => (
    <Field
      label={label}
      name={name}
      value={form.values[name]}
      onChange={(e) => form.setValue(name, e.target.value)}
      onBlur={() => form.onBlur(name)}
      error={form.errors[name]}
      {...props}
    />
  );

  return (
    <form onSubmit={handleSave} noValidate className="space-y-4">
      <FormError error={formError} />
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Product</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("name", "Productnaam", { required: true, className: "sm:col-span-2" })}
          <div>
            {field("categoryLabel", "Categorie", { list: "category-options", placeholder: "Bijv. Banken", maxLength: 100 })}
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          {field("brand", "Merk", { maxLength: 150 })}
          <div className="sm:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-slate-700">
              Omschrijving
            </label>
            <textarea
              id="description"
              name="description"
              value={form.values.description}
              onChange={(e) => form.setValue("description", e.target.value)}
              rows={4}
              placeholder="Wat is het product, waarvoor is het bedoeld? Dit staat op het openbare paspoort."
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Identificatie</h2>
          <p className="text-xs text-slate-500">Met een SKU of GTIN herkent VeriPasso het product bij een Excel-import.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {field("sku", "SKU / artikelnummer", { maxLength: 100 })}
          {field("gtin", "GTIN / EAN", { inputMode: "numeric", maxLength: 50 })}
          {field("model", "Model / productnummer", { maxLength: 150 })}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Herkomst</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("manufacturer", "Fabrikant", { maxLength: 200 })}
          {field("countryOfOrigin", "Land van oorsprong", { maxLength: 100 })}
        </div>
      </Card>

      <Card>
        <ProductPhotoField
          productId={product.id}
          hasPhoto={Boolean(product.photo_blob_name || product.photo_url)}
          version={product.updated_at}
          urlValue={form.values.photoUrl}
          onChangeUrl={(v) => form.setValue("photoUrl", v)}
          onUploaded={async () => {
            // Een upload vervangt server-side altijd een eerder geplakte URL.
            form.setValue("photoUrl", "");
            await onSaved();
          }}
        />
      </Card>

      <div className="sticky bottom-3 z-10 flex justify-end">
        <SubmitButton loading={saving} className="bg-emerald-600 shadow-lg hover:bg-emerald-700">
          Wijzigingen opslaan
        </SubmitButton>
      </div>
    </form>
  );
}

function ProductPhotoField({ productId, hasPhoto, version, urlValue, onChangeUrl, onUploaded }) {
  const [mode, setMode] = useState("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function upload(file) {
    setUploading(true);
    setUploadError("");
    try {
      await api.uploadDirect(`/api/products/${productId}/photo`, file);
      await onUploaded();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div id="product-photo" tabIndex={-1} className="focus:outline-none">
      <h2 className="text-sm font-semibold text-slate-900">Productafbeelding</h2>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/products/${productId}/photo?v=${encodeURIComponent(version || "")}`} alt="Productfoto" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-slate-400">Geen foto</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div role="tablist" aria-label="Fotobron" className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {[
              ["upload", "Uploaden"],
              ["url", "Link (URL)"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`rounded-md px-2.5 py-1 font-medium ${mode === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "upload" ? (
            <FileDropzone
              compact
              accept="image/jpeg,image/png,image/webp,image/gif"
              extensions={["jpg", "jpeg", "png", "webp", "gif"]}
              maxSizeMb={5}
              onFile={upload}
              disabled={uploading}
              error={uploadError}
              label={uploading ? "Uploaden…" : "Sleep een foto hierheen"}
              hint="JPG, PNG, WEBP of GIF — max 5 MB"
            />
          ) : (
            <div>
              <input
                id="photoUrl"
                aria-label="Foto-URL"
                value={urlValue}
                onChange={(e) => onChangeUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <p className="mt-1 text-xs text-slate-500">Wordt bewaard met &quot;Wijzigingen opslaan&quot;.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Switch({ label, description, checked, onChange, id }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span aria-hidden="true" className="h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-1" />
        <span aria-hidden="true" className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function useLoaded(url) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .get(url)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { data, error };
}

function SustainabilityTab({ productId, onSaved }) {
  const { data, error } = useLoaded(`/api/products/${productId}/sustainability`);
  if (error) return <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>;
  if (data === undefined) return <Skeleton className="h-80 w-full" />;
  return (
    <SustainabilityForm
      productId={productId}
      onSaved={onSaved}
      initial={{
        co2FootprintKg: data?.co2_footprint_kg ?? "",
        co2ReductionPct: data?.co2_reduction_pct ?? "",
        recycledMaterialPct: data?.recycled_material_pct ?? "",
        epdUrl: data?.epd_url ?? "",
        recyclable: Boolean(data?.recyclable),
        reachConform: Boolean(data?.reach_conform),
        rohsConform: Boolean(data?.rohs_conform),
        expectedLifespanYears: data?.expected_lifespan_years ?? "",
        materials: Array.isArray(data?.materials) ? data.materials.map((m) => ({ material: m.material, pct: m.pct ?? "" })) : []
      }}
    />
  );
}

function SustainabilityForm({ productId, initial, onSaved }) {
  const toast = useToast();
  const form = useForm({
    initial,
    validators: {
      co2FootprintKg: nonNegativeValidator,
      co2ReductionPct: percentageValidator,
      recycledMaterialPct: percentageValidator,
      expectedLifespanYears: nonNegativeValidator
    }
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const materials = form.values.materials;
  const materialTotal = materials.reduce((sum, m) => sum + (Number(m.pct) || 0), 0);

  function setMaterial(index, key, value) {
    form.setValue(
      "materials",
      materials.map((m, i) => (i === index ? { ...m, [key]: value } : m))
    );
  }

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) return;
    setSaving(true);
    try {
      const v = form.values;
      const body = { recyclable: v.recyclable, reachConform: v.reachConform, rohsConform: v.rohsConform };
      if (v.co2FootprintKg !== "") body.co2FootprintKg = Number(v.co2FootprintKg);
      if (v.co2ReductionPct !== "") body.co2ReductionPct = Number(v.co2ReductionPct);
      if (v.recycledMaterialPct !== "") body.recycledMaterialPct = Number(v.recycledMaterialPct);
      if (v.epdUrl !== "") body.epdUrl = v.epdUrl;
      if (v.expectedLifespanYears !== "") body.expectedLifespanYears = Number(v.expectedLifespanYears);
      const cleanMaterials = materials.filter((m) => String(m.material).trim()).map((m) => ({ material: String(m.material).trim().slice(0, 100), pct: Number(m.pct) || 0 }));
      body.materials = cleanMaterials;
      await api.put(`/api/products/${productId}/sustainability`, body);
      toast.success("Duurzaamheidsgegevens opgeslagen");
      await onSaved();
    } catch (err) {
      if (!form.applyServerErrors(err)) setFormError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} noValidate className="space-y-4">
      <FormError error={formError} />
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Impact</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField label="CO₂-voetafdruk (kg CO₂-eq)" name="co2FootprintKg" min="0" value={form.values.co2FootprintKg} onChange={(e) => form.setValue("co2FootprintKg", e.target.value)} onBlur={() => form.onBlur("co2FootprintKg")} error={form.errors.co2FootprintKg} />
          <NumberField label="CO₂-reductie (%)" name="co2ReductionPct" min="0" max="100" value={form.values.co2ReductionPct} onChange={(e) => form.setValue("co2ReductionPct", e.target.value)} onBlur={() => form.onBlur("co2ReductionPct")} error={form.errors.co2ReductionPct} />
          <NumberField label="Gerecycled materiaal (%)" name="recycledMaterialPct" min="0" max="100" value={form.values.recycledMaterialPct} onChange={(e) => form.setValue("recycledMaterialPct", e.target.value)} onBlur={() => form.onBlur("recycledMaterialPct")} error={form.errors.recycledMaterialPct} />
          <NumberField label="Verwachte levensduur (jaren)" name="expectedLifespanYears" min="0" value={form.values.expectedLifespanYears} onChange={(e) => form.setValue("expectedLifespanYears", e.target.value)} onBlur={() => form.onBlur("expectedLifespanYears")} error={form.errors.expectedLifespanYears} />
          <Field label="EPD-link (milieuproductverklaring)" name="epdUrl" placeholder="https://..." className="sm:col-span-2" value={form.values.epdUrl} onChange={(e) => form.setValue("epdUrl", e.target.value)} error={form.errors.epdUrl} />
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Materialen</h2>
            <p className="text-xs text-slate-500">Samenstelling van het product in procenten.</p>
          </div>
          {materials.length > 0 && (
            <span className={`text-xs font-medium ${Math.round(materialTotal) === 100 ? "text-emerald-700" : "text-amber-700"}`}>Totaal {Math.round(materialTotal)}%</span>
          )}
        </div>
        {materials.map((m, index) => (
          <div key={index} className="flex items-end gap-2">
            <Field label={index === 0 ? "Materiaal" : ""} aria-label="Materiaal" name={`material-${index}`} className="flex-1" value={m.material} maxLength={100} onChange={(e) => setMaterial(index, "material", e.target.value)} />
            <Field label={index === 0 ? "%" : ""} aria-label="Percentage" name={`material-pct-${index}`} type="number" min="0" max="100" className="w-24" value={m.pct} onChange={(e) => setMaterial(index, "pct", e.target.value)} />
            <button
              type="button"
              onClick={() => form.setValue("materials", materials.filter((_, i) => i !== index))}
              aria-label="Materiaal verwijderen"
              title="Materiaal verwijderen"
              className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
            >
              <XIcon size={16} />
            </button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => form.setValue("materials", [...materials, { material: "", pct: "" }])}>
          + Materiaal
        </Button>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Recycling &amp; stoffen</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Switch id="recyclable" label="Recyclebaar" checked={form.values.recyclable} onChange={(v) => form.setValue("recyclable", v)} />
          <Switch id="reachConform" label="REACH-conform" description="Chemische stoffen (EU 1907/2006)" checked={form.values.reachConform} onChange={(v) => form.setValue("reachConform", v)} />
          <Switch id="rohsConform" label="RoHS-conform" description="Gevaarlijke stoffen in elektronica" checked={form.values.rohsConform} onChange={(v) => form.setValue("rohsConform", v)} />
        </div>
      </Card>

      <div className="sticky bottom-3 z-10 flex justify-end">
        <SubmitButton loading={saving} className="bg-emerald-600 shadow-lg hover:bg-emerald-700">
          Duurzaamheid opslaan
        </SubmitButton>
      </div>
    </form>
  );
}

const REGULATION_SUGGESTIONS = ["ESPR", "REACH", "RoHS", "WEEE", "CE-markering", "EN 71", "Batterijverordening", "Verpakkingsrichtlijn", "EUDR", "GPSR"];

function ComplianceTab({ productId, onSaved, onOpenDocuments }) {
  const { data, error } = useLoaded(`/api/products/${productId}/compliance`);
  const docs = useLoaded(`/api/products/${productId}/documents`);
  if (error) return <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>;
  if (data === undefined) return <Skeleton className="h-60 w-full" />;
  const certificates = (docs.data || []).filter((d) => ["certificate", "declaration"].includes(d.category));
  return (
    <div className="space-y-4">
      <ComplianceForm
        productId={productId}
        onSaved={onSaved}
        initial={{ ceMarked: Boolean(data?.ce_marked), regulations: Array.isArray(data?.applicable_regulations) ? data.applicable_regulations : [] }}
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Certificaten &amp; verklaringen</h2>
            <p className="text-xs text-slate-500">Upload ze als document met categorie Certificaat of Verklaring en een vervaldatum.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenDocuments}>
            + Document
          </Button>
        </div>
        {docs.data === undefined ? (
          <Skeleton className="mt-3 h-10 w-full" />
        ) : certificates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nog geen certificaten of verklaringen.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {certificates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium text-slate-800">{d.title}</span>
                <span className="text-xs text-slate-500">{d.valid_until ? `geldig tot ${new Date(d.valid_until).toLocaleDateString("nl-NL")}` : "geen vervaldatum"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ComplianceForm({ productId, initial, onSaved }) {
  const toast = useToast();
  const [ceMarked, setCeMarked] = useState(initial.ceMarked);
  const [regulations, setRegulations] = useState(initial.regulations);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  function addRegulation(value) {
    const v = value.trim().slice(0, 200);
    if (!v || regulations.some((r) => r.toLowerCase() === v.toLowerCase())) return;
    setRegulations([...regulations, v]);
    setDraft("");
  }

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const pending = draft.trim() ? [...regulations, draft.trim()] : regulations;
      await api.put(`/api/products/${productId}/compliance`, { ceMarked, applicableRegulations: pending });
      setRegulations(pending);
      setDraft("");
      toast.success("Compliancegegevens opgeslagen");
      await onSaved();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} noValidate>
      <Card className="space-y-4">
        <FormError error={formError} />
        <Switch id="ceMarked" label="CE-markering" description="Het product voldoet aan de EU-eisen voor CE-markering" checked={ceMarked} onChange={setCeMarked} />
        <div>
          <label htmlFor="regulation-input" className="block text-sm font-medium text-slate-700">
            Toepasselijke regelgeving en normen
          </label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {regulations.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-slate-700">
                {r}
                <button type="button" onClick={() => setRegulations(regulations.filter((x) => x !== r))} aria-label={`${r} verwijderen`} title="Verwijderen" className="rounded-full p-0.5 hover:bg-slate-200">
                  <XIcon size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              id="regulation-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addRegulation(draft);
                }
              }}
              placeholder="Typ en druk op Enter"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <Button variant="outline" onClick={() => addRegulation(draft)}>
              Toevoegen
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGULATION_SUGGESTIONS.filter((s) => !regulations.includes(s)).map((s) => (
              <button key={s} type="button" onClick={() => addRegulation(s)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-emerald-400 hover:text-emerald-700">
                + {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <SubmitButton loading={saving} className="bg-emerald-600 hover:bg-emerald-700">
            Compliance opslaan
          </SubmitButton>
        </div>
      </Card>
    </form>
  );
}

function QrTab({ product, onChanged, onPrint }) {
  const toast = useToast();
  const [reserving, setReserving] = useState(false);
  const [origin, setOrigin] = useState("");
  const [pngSize, setPngSize] = useState("512");

  useEffect(() => setOrigin(window.location.origin), []);

  async function reserve() {
    setReserving(true);
    try {
      await api.post(`/api/products/${product.id}/qr`);
      await onChanged();
      toast.success("QR-code aangemaakt (wordt actief na publiceren)");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReserving(false);
    }
  }

  if (!product.public_id) {
    return (
      <Card className="text-center">
        <QrIcon size={36} className="mx-auto text-slate-300" />
        <h2 className="mt-3 text-sm font-semibold text-slate-900">Nog geen QR-code</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Maak de QR-code nu al aan om labels te printen. De code wordt pas actief (het paspoort openbaar) zodra je het product publiceert.
        </p>
        <Button variant="accent" icon={QrIcon} className="mt-4" onClick={reserve} loading={reserving}>
          QR-code aanmaken
        </Button>
      </Card>
    );
  }

  const path = `/p/${String(product.public_id).toUpperCase()}`;
  const url = `${origin}${path}`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/products/${product.id}/qr.png`} alt={`QR-code voor ${product.name}`} className="h-44 w-44 shrink-0 self-center rounded-xl border border-slate-200 bg-white p-2 sm:self-start" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">QR-code</h2>
                <QrStatusBadge status={product.qr_status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{QR_STATUS_HELP[product.qr_status]}</p>
              <p className="mt-1 text-xs text-slate-500">Deze link verandert nooit: een geprinte code blijft altijd naar dit paspoort wijzen.</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <LinkIcon size={14} className="text-slate-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={url}>
                {url}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Link gekopieerd"))}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Kopiëren
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-300">
                <a href={`/api/products/${product.id}/qr.png?size=${pngSize}&download=1`} className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <DownloadIcon size={14} /> PNG
                </a>
                <select aria-label="PNG-formaat" value={pngSize} onChange={(e) => setPngSize(e.target.value)} className="border-l border-slate-300 bg-white py-1.5 pl-2 pr-6 text-xs text-slate-600">
                  <option value="512">Scherm (512 px)</option>
                  <option value="1200">Print 300 DPI (1200 px)</option>
                </select>
              </div>
              <ButtonLink href={`/api/products/${product.id}/qr.svg?download=1`} size="sm" icon={DownloadIcon}>
                SVG
              </ButtonLink>
              <ButtonLink href={`/api/products/${product.id}/qr-label.pdf?download=1`} size="sm" icon={DownloadIcon}>
                Los label (PDF)
              </ButtonLink>
              <Button variant="accent" size="sm" icon={PrinterIcon} onClick={onPrint}>
                Printen met profiel
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <Card className="text-sm text-slate-600">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Welk formaat kies ik?</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Gewoon printen op stickervellen of labelprinter → PDF met printprofiel</li>
          <li>Professionele drukker → SVG of PDF (vector, altijd scherp)</li>
          <li>Website, e-mail of digitaal → PNG</li>
        </ul>
        {product.qr_status === "active" && (
          <Link href={path} target="_blank" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
            Openbaar paspoort bekijken <ExternalIcon size={12} />
          </Link>
        )}
      </Card>
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ProductEditor />
    </Suspense>
  );
}
