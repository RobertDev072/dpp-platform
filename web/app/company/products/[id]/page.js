"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Tabs from "@/components/ui/Tabs";

const TABS = [
  { key: "overview", label: "Overzicht" },
  { key: "sustainability", label: "Duurzaamheid" },
  { key: "compliance", label: "Compliance" },
  { key: "documents", label: "Documenten" },
  { key: "qr", label: "QR-code" }
];

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
  const [fields, setFields] = useState({
    name: product.name || "",
    brand: product.brand || "",
    model: product.model || "",
    sku: product.sku || "",
    gtin: product.gtin || "",
    manufacturer: product.manufacturer || "",
    countryOfOrigin: product.country_of_origin || "",
    description: product.description || ""
  });
  const [error, setError] = useState("");

  function set(field, value) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    try {
      await api.patch(`/api/products/${product.id}`, fields);
      await onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card className="space-y-4">
      {error && <div className="text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Naam" value={fields.name} onChange={(v) => set("name", v)} />
        <Field label="Merk" value={fields.brand} onChange={(v) => set("brand", v)} />
        <Field label="Model" value={fields.model} onChange={(v) => set("model", v)} />
        <Field label="SKU" value={fields.sku} onChange={(v) => set("sku", v)} />
        <Field label="GTIN" value={fields.gtin} onChange={(v) => set("gtin", v)} />
        <Field
          label="Fabrikant"
          value={fields.manufacturer}
          onChange={(v) => set("manufacturer", v)}
        />
        <Field
          label="Land van herkomst"
          value={fields.countryOfOrigin}
          onChange={(v) => set("countryOfOrigin", v)}
        />
        <label className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-2">
          Omschrijving
          <textarea
            value={fields.description}
            onChange={(e) => set("description", e.target.value)}
            rows={4}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit">Opslaan</Button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

function SustainabilityTab({ productId }) {
  const [fields, setFields] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/products/${productId}/sustainability`)
      .then((data) => {
        if (!cancelled) {
          setFields({
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
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function handleSave(event) {
    event.preventDefault();
    try {
      const body = {};
      if (fields.co2FootprintKg !== "") body.co2FootprintKg = Number(fields.co2FootprintKg);
      if (fields.co2ReductionPct !== "") body.co2ReductionPct = Number(fields.co2ReductionPct);
      if (fields.recycledMaterialPct !== "")
        body.recycledMaterialPct = Number(fields.recycledMaterialPct);
      if (fields.epdUrl !== "") body.epdUrl = fields.epdUrl;
      if (fields.expectedLifespanYears !== "")
        body.expectedLifespanYears = Number(fields.expectedLifespanYears);
      body.recyclable = fields.recyclable;
      body.reachConform = fields.reachConform;
      body.rohsConform = fields.rohsConform;

      await api.put(`/api/products/${productId}/sustainability`, body);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!fields) {
    return <Card>Laden...</Card>;
  }

  return (
    <Card className="space-y-4">
      {error && <div className="text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="CO2-voetafdruk (kg)"
          value={fields.co2FootprintKg}
          onChange={(v) => setFields((c) => ({ ...c, co2FootprintKg: v }))}
        />
        <Field
          label="CO2-reductie (%)"
          value={fields.co2ReductionPct}
          onChange={(v) => setFields((c) => ({ ...c, co2ReductionPct: v }))}
        />
        <Field
          label="Gerecycled materiaal (%)"
          value={fields.recycledMaterialPct}
          onChange={(v) => setFields((c) => ({ ...c, recycledMaterialPct: v }))}
        />
        <Field
          label="Verwachte levensduur (jaren)"
          value={fields.expectedLifespanYears}
          onChange={(v) => setFields((c) => ({ ...c, expectedLifespanYears: v }))}
        />
        <Field
          label="EPD URL"
          value={fields.epdUrl}
          onChange={(v) => setFields((c) => ({ ...c, epdUrl: v }))}
        />
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox
            label="Recyclebaar"
            checked={fields.recyclable}
            onChange={(v) => setFields((c) => ({ ...c, recyclable: v }))}
          />
          <Checkbox
            label="REACH-conform"
            checked={fields.reachConform}
            onChange={(v) => setFields((c) => ({ ...c, reachConform: v }))}
          />
          <Checkbox
            label="RoHS-conform"
            checked={fields.rohsConform}
            onChange={(v) => setFields((c) => ({ ...c, rohsConform: v }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit">Opslaan</Button>
        </div>
      </form>
    </Card>
  );
}

function ComplianceTab({ productId }) {
  const [ceMarked, setCeMarked] = useState(false);
  const [regulations, setRegulations] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/products/${productId}/compliance`)
      .then((data) => {
        if (!cancelled) {
          setCeMarked(Boolean(data?.ce_marked));
          setRegulations((data?.applicable_regulations || []).join(", "));
          setLoaded(true);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function handleSave(event) {
    event.preventDefault();
    try {
      await api.put(`/api/products/${productId}/compliance`, {
        ceMarked,
        applicableRegulations: regulations
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      });
    } catch (err) {
      setError(err.message);
    }
  }

  if (!loaded) {
    return <Card>Laden...</Card>;
  }

  return (
    <Card className="space-y-4">
      {error && <div className="text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSave} className="space-y-4">
        <Checkbox label="CE-gemarkeerd" checked={ceMarked} onChange={setCeMarked} />
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Toepasselijke regelgeving (komma-gescheiden)
          <input
            value={regulations}
            onChange={(e) => setRegulations(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <Button type="submit">Opslaan</Button>
      </form>
    </Card>
  );
}

function DocumentsTab({ productId }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  async function loadDocuments() {
    const data = await api.get(`/api/products/${productId}/documents`);
    setDocuments(data);
  }

  useEffect(() => {
    loadDocuments().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.post(`/api/products/${productId}/documents`, {
        type,
        title,
        storageUrl,
        isPublic
      });
      setType("");
      setTitle("");
      setStorageUrl("");
      setIsPublic(false);
      await loadDocuments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(documentId) {
    try {
      await api.delete(`/api/products/${productId}/documents/${documentId}`);
      await loadDocuments();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Document toevoegen (URL)
        </h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <Field label="Type" value={type} onChange={setType} />
          <Field label="Titel" value={title} onChange={setTitle} />
          <Field label="URL" value={storageUrl} onChange={setStorageUrl} />
          <Checkbox label="Publiek zichtbaar" checked={isPublic} onChange={setIsPublic} />
          <Button type="submit">Toevoegen</Button>
        </form>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3">Titel</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Publiek</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    <a href={doc.storage_url} target="_blank" rel="noreferrer" className="text-blue-600">
                      {doc.title}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{doc.type}</td>
                  <td className="py-2 pr-3">{doc.is_public ? "ja" : "nee"}</td>
                  <td className="py-2 pr-3">
                    <Button variant="outline" onClick={() => handleDelete(doc.id)}>
                      Verwijderen
                    </Button>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-500">
                    Nog geen documenten.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
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
