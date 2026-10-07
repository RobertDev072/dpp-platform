"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Tabs from "@/components/ui/Tabs";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import NumberField from "@/components/products/NumberField";
import DocumentsTab from "@/components/products/DocumentsTab";

const TABS = [
  { key: "overview", label: "Overzicht" },
  { key: "sustainability", label: "Duurzaamheid" },
  { key: "compliance", label: "Compliance" },
  { key: "documents", label: "Documenten" },
  { key: "qr", label: "QR-code" }
];

// Client-side validators die de Zod-regels van de backend spiegelen, zodat de
// gebruiker de fout al ziet vóór de request.
function percentageValidator(value) {
  if (value === "" || value == null) {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
    return "Vul een percentage tussen 0 en 100 in";
  }
  return null;
}

function nonNegativeValidator(value) {
  if (value === "" || value == null) {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return "Vul een waarde van 0 of hoger in";
  }
  return null;
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  async function loadProduct() {
    const data = await api.get(`/api/products/${id}`);
    setProduct(data);
  }

  useEffect(() => {
    loadProduct().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handlePublish() {
    try {
      await api.post(`/api/products/${id}/publish`);
      await loadProduct();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleArchive() {
    try {
      await api.delete(`/api/products/${id}`);
      await loadProduct();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) {
    return <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>;
  }

  if (!product) {
    return <div className="text-sm text-slate-500">Laden...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{product.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={product.status === "published" ? "success" : "neutral"}>
              {product.status}
            </Badge>
            {product.public_id && (
              <span className="text-xs text-slate-500">public id: {product.public_id}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {product.status !== "published" && (
            <Button onClick={handlePublish}>Publiceren</Button>
          )}
          {product.status !== "archived" && (
            <Button variant="outline" onClick={handleArchive}>
              Archiveren
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "overview" && <OverviewTab product={product} onSaved={loadProduct} />}
      {tab === "sustainability" && <SustainabilityTab productId={id} />}
      {tab === "compliance" && <ComplianceTab productId={id} />}
      {tab === "documents" && <DocumentsTab productId={id} />}
      {tab === "qr" && <QrTab productId={id} published={product.status === "published"} />}
    </div>
  );
}

function OverviewTab({ product, onSaved }) {
  const toast = useToast();
  const form = useForm({
    initial: {
      name: product.name || "",
      brand: product.brand || "",
      model: product.model || "",
      sku: product.sku || "",
      gtin: product.gtin || "",
      manufacturer: product.manufacturer || "",
      countryOfOrigin: product.country_of_origin || "",
      description: product.description || "",
      photoUrl: product.photo_url || ""
    },
    validators: {
      name: (value) => (String(value || "").trim() ? null : "Vul een naam in")
    }
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/products/${product.id}`, form.values);
      toast.success("Gegevens opgeslagen");
      await onSaved();
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <FormError error={formError} />
      <form onSubmit={handleSave} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ProductPhotoField
            productId={product.id}
            hasPhoto={Boolean(product.photo_blob_name || product.photo_url)}
            urlValue={form.values.photoUrl}
            onChangeUrl={(v) => form.setValue("photoUrl", v)}
            onUploaded={async () => {
              // Een upload vervangt server-side altijd een eerder geplakte URL - leeg het
              // lokale veld mee zodat "Opslaan" die oude URL niet per ongeluk terugzet.
              form.setValue("photoUrl", "");
              await onSaved();
            }}
          />
        </div>
        <Field
          label="Naam"
          name="name"
          required
          value={form.values.name}
          onChange={(e) => form.setValue("name", e.target.value)}
          onBlur={() => form.onBlur("name")}
          error={form.errors.name}
        />
        <Field
          label="Merk"
          name="brand"
          value={form.values.brand}
          onChange={(e) => form.setValue("brand", e.target.value)}
          error={form.errors.brand}
        />
        <Field
          label="Model"
          name="model"
          value={form.values.model}
          onChange={(e) => form.setValue("model", e.target.value)}
          error={form.errors.model}
        />
        <Field
          label="SKU"
          name="sku"
          value={form.values.sku}
          onChange={(e) => form.setValue("sku", e.target.value)}
          error={form.errors.sku}
        />
        <Field
          label="GTIN"
          name="gtin"
          value={form.values.gtin}
          onChange={(e) => form.setValue("gtin", e.target.value)}
          error={form.errors.gtin}
        />
        <Field
          label="Fabrikant"
          name="manufacturer"
          value={form.values.manufacturer}
          onChange={(e) => form.setValue("manufacturer", e.target.value)}
          error={form.errors.manufacturer}
        />
        <Field
          label="Land van herkomst"
          name="countryOfOrigin"
          value={form.values.countryOfOrigin}
          onChange={(e) => form.setValue("countryOfOrigin", e.target.value)}
          error={form.errors.countryOfOrigin}
        />
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
            aria-invalid={form.errors.description ? true : undefined}
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 ${
              form.errors.description ? "border-red-500" : "border-slate-300"
            }`}
          />
          {form.errors.description && (
            <p className="mt-1 text-sm text-red-600">{form.errors.description}</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <SubmitButton loading={saving}>Opslaan</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function ProductPhotoField({ productId, hasPhoto, urlValue, onChangeUrl, onUploaded }) {
  const [mode, setMode] = useState("url");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError("");
    try {
      await api.directUpload({
        requestUrl: `/api/products/${productId}/photo/upload-url`,
        completeUrl: `/api/products/${productId}/photo`,
        file
      });
      await onUploaded();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-start">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/products/${productId}/photo`} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400">Geen foto</span>
        )}
      </div>

      <div className="flex-1 space-y-2">
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`rounded-md px-2 py-1 font-medium ${
              mode === "url" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            URL
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`rounded-md px-2 py-1 font-medium ${
              mode === "upload" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            Upload afbeelding
          </button>
        </div>

        {mode === "url" ? (
          <input
            value={urlValue}
            onChange={(e) => onChangeUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        ) : (
          <div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              disabled={uploading}
              className="text-sm"
            />
            {uploading && <p className="mt-1 text-xs text-slate-500">Uploaden...</p>}
            {uploadError && <p className="mt-1 text-xs text-red-700">{uploadError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function SustainabilityTab({ productId }) {
  const [initial, setInitial] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/products/${productId}/sustainability`)
      .then((data) => {
        if (!cancelled) {
          setInitial({
            co2FootprintKg: data?.co2_footprint_kg ?? "",
            co2ReductionPct: data?.co2_reduction_pct ?? "",
            recycledMaterialPct: data?.recycled_material_pct ?? "",
            epdUrl: data?.epd_url ?? "",
            recyclable: Boolean(data?.recyclable),
            reachConform: Boolean(data?.reach_conform),
            rohsConform: Boolean(data?.rohs_conform),
            expectedLifespanYears: data?.expected_lifespan_years ?? ""
          });
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loadError) {
    return <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>;
  }

  if (!initial) {
    return <Skeleton className="h-64 w-full" />;
  }

  return <SustainabilityForm productId={productId} initial={initial} />;
}

function SustainabilityForm({ productId, initial }) {
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

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }

    setSaving(true);
    try {
      const values = form.values;
      const body = {};
      if (values.co2FootprintKg !== "") body.co2FootprintKg = Number(values.co2FootprintKg);
      if (values.co2ReductionPct !== "") body.co2ReductionPct = Number(values.co2ReductionPct);
      if (values.recycledMaterialPct !== "")
        body.recycledMaterialPct = Number(values.recycledMaterialPct);
      if (values.epdUrl !== "") body.epdUrl = values.epdUrl;
      if (values.expectedLifespanYears !== "")
        body.expectedLifespanYears = Number(values.expectedLifespanYears);
      body.recyclable = values.recyclable;
      body.reachConform = values.reachConform;
      body.rohsConform = values.rohsConform;

      await api.put(`/api/products/${productId}/sustainability`, body);
      toast.success("Gegevens opgeslagen");
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <FormError error={formError} />
      <form onSubmit={handleSave} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          label="CO2-voetafdruk (kg)"
          name="co2FootprintKg"
          min="0"
          value={form.values.co2FootprintKg}
          onChange={(e) => form.setValue("co2FootprintKg", e.target.value)}
          onBlur={() => form.onBlur("co2FootprintKg")}
          error={form.errors.co2FootprintKg}
        />
        <NumberField
          label="CO2-reductie (%)"
          name="co2ReductionPct"
          min="0"
          max="100"
          value={form.values.co2ReductionPct}
          onChange={(e) => form.setValue("co2ReductionPct", e.target.value)}
          onBlur={() => form.onBlur("co2ReductionPct")}
          error={form.errors.co2ReductionPct}
        />
        <NumberField
          label="Gerecycled materiaal (%)"
          name="recycledMaterialPct"
          min="0"
          max="100"
          value={form.values.recycledMaterialPct}
          onChange={(e) => form.setValue("recycledMaterialPct", e.target.value)}
          onBlur={() => form.onBlur("recycledMaterialPct")}
          error={form.errors.recycledMaterialPct}
        />
        <NumberField
          label="Verwachte levensduur (jaren)"
          name="expectedLifespanYears"
          min="0"
          value={form.values.expectedLifespanYears}
          onChange={(e) => form.setValue("expectedLifespanYears", e.target.value)}
          onBlur={() => form.onBlur("expectedLifespanYears")}
          error={form.errors.expectedLifespanYears}
        />
        <Field
          label="EPD URL"
          name="epdUrl"
          placeholder="https://..."
          value={form.values.epdUrl}
          onChange={(e) => form.setValue("epdUrl", e.target.value)}
          error={form.errors.epdUrl}
        />
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox
            label="Recyclebaar"
            checked={form.values.recyclable}
            onChange={(v) => form.setValue("recyclable", v)}
          />
          <Checkbox
            label="REACH-conform"
            checked={form.values.reachConform}
            onChange={(v) => form.setValue("reachConform", v)}
          />
          <Checkbox
            label="RoHS-conform"
            checked={form.values.rohsConform}
            onChange={(v) => form.setValue("rohsConform", v)}
          />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton loading={saving}>Opslaan</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function ComplianceTab({ productId }) {
  const [initial, setInitial] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/products/${productId}/compliance`)
      .then((data) => {
        if (!cancelled) {
          setInitial({
            ceMarked: Boolean(data?.ce_marked),
            applicableRegulations: (data?.applicable_regulations || []).join(", ")
          });
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loadError) {
    return <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>;
  }

  if (!initial) {
    return <Skeleton className="h-40 w-full" />;
  }

  return <ComplianceForm productId={productId} initial={initial} />;
}

function ComplianceForm({ productId, initial }) {
  const toast = useToast();
  const form = useForm({ initial });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSave(event) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await api.put(`/api/products/${productId}/compliance`, {
        ceMarked: form.values.ceMarked,
        applicableRegulations: form.values.applicableRegulations
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      });
      toast.success("Gegevens opgeslagen");
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <FormError error={formError} />
      <form onSubmit={handleSave} noValidate className="space-y-4">
        <Checkbox
          label="CE-gemarkeerd"
          checked={form.values.ceMarked}
          onChange={(v) => form.setValue("ceMarked", v)}
        />
        <Field
          label="Toepasselijke regelgeving (komma-gescheiden)"
          name="applicableRegulations"
          placeholder="Bijv. ESPR, REACH"
          value={form.values.applicableRegulations}
          onChange={(e) => form.setValue("applicableRegulations", e.target.value)}
          error={form.errors.applicableRegulations}
        />
        <SubmitButton loading={saving}>Opslaan</SubmitButton>
      </form>
    </Card>
  );
}

function QrTab({ productId, published }) {
  if (!published) {
    return (
      <Card>
        <p className="text-sm text-slate-600">
          Publiceer het product eerst om een QR-code te genereren.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <img
        src={`/api/products/${productId}/qr.png`}
        alt="QR-code"
        className="h-48 w-48 rounded-lg border border-slate-200"
      />
      <div className="flex flex-wrap gap-2">
        <a href={`/api/products/${productId}/qr.svg`} target="_blank" rel="noreferrer">
          <Button variant="outline">SVG downloaden</Button>
        </a>
        <a href={`/api/products/${productId}/qr-label.pdf`} target="_blank" rel="noreferrer">
          <Button variant="outline">Label PDF downloaden</Button>
        </a>
      </div>
    </Card>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
