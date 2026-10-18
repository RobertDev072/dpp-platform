"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("nl-NL") : "—";
}

// Batch- en itempaspoorten. Elke batch en elk exemplaar krijgt een eigen, permanente
// QR-code; de productgegevens komen van dit (model)paspoort. Openbaar zodra het product
// gepubliceerd is.
export default function InstancesTab({ product }) {
  const toast = useToast();
  const [batches, setBatches] = useState(null);
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(1);
  const [batchForm, setBatchForm] = useState({ batchNumber: "", productionDate: "", quantity: "" });
  const [gen, setGen] = useState({ mode: "generate", count: "10", prefix: "", start: "1", list: "", batchId: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const loadBatches = useCallback(() => api.get(`/api/products/${product.id}/batches`).then(setBatches).catch((e) => setError(e.message)), [product.id]);
  const loadItems = useCallback(
    () => api.get(`/api/products/${product.id}/items?page=${page}&pageSize=25`).then(setItems).catch((e) => setError(e.message)),
    [product.id, page]
  );

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function addBatch() {
    setError("");
    if (!batchForm.batchNumber.trim()) return setError("Vul een batch- of lotnummer in");
    setBusy("batch");
    try {
      await api.post(`/api/products/${product.id}/batches`, {
        batchNumber: batchForm.batchNumber.trim(),
        productionDate: batchForm.productionDate || undefined,
        quantity: batchForm.quantity ? Number(batchForm.quantity) : undefined
      });
      setBatchForm({ batchNumber: "", productionDate: "", quantity: "" });
      toast.success("Batch toegevoegd");
      await loadBatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function addItems() {
    setError("");
    setBusy("items");
    try {
      const body =
        gen.mode === "generate"
          ? { generate: { count: Number(gen.count), prefix: gen.prefix.trim(), start: Number(gen.start) || 1, digits: 5 } }
          : { serials: gen.list.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) };
      if (gen.batchId) body.batchId = Number(gen.batchId);
      const result = await api.post(`/api/products/${product.id}/items`, body);
      toast.success(
        `${result.created} exemplaren aangemaakt${result.skipped.length ? `; ${result.skipped.length} serienummers bestonden al` : ""}`
      );
      setPage(1);
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleItem(item) {
    try {
      await api.patch(`/api/products/${product.id}/items/${item.id}`, { status: item.status === "active" ? "archived" : "active" });
      await loadItems();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const notPublished = !product.published_at;

  return (
    <div className="space-y-4">
      {notPublished && (
        <Card className="border-amber-200 bg-amber-50 text-sm text-amber-800">
          De QR-codes van batches en exemplaren werken pas als dit product gepubliceerd is.
        </Card>
      )}
      {!product.gtin && (
        <Card className="border-blue-200 bg-blue-50 text-sm text-blue-800">
          Tip: met een GTIN krijgt elk exemplaar ook een GS1 Digital Link (GTIN + lot + serienummer).
        </Card>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Batches</h2>
          <p className="text-xs text-slate-500">Een paspoort per productiebatch (lot). Lotnummers van max. 20 tekens komen ook in de GS1 Digital Link.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Batch- / lotnummer" name="batch-number" maxLength={100} value={batchForm.batchNumber} onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })} />
          <Field label="Productiedatum" name="batch-date" type="date" value={batchForm.productionDate} onChange={(e) => setBatchForm({ ...batchForm, productionDate: e.target.value })} />
          <Field label="Aantal" name="batch-qty" type="number" min="1" value={batchForm.quantity} onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })} />
          <Button type="button" variant="accent" loading={busy === "batch"} onClick={addBatch}>
            Batch toevoegen
          </Button>
        </div>
        {batches?.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{b.batch_number}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(b.production_date)}
                    {b.quantity ? ` · ${b.quantity} stuks` : ""} · <span className="font-mono">{b.passportUrl}</span>
                  </span>
                </span>
                <a className="text-xs font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/batches/${b.id}/qr`} target="_blank" rel="noreferrer">
                  QR-code
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Exemplaren (serienummers)</h2>
            <p className="text-xs text-slate-500">Een eigen paspoort en QR-code per exemplaar. Tot 1000 per keer.</p>
          </div>
          {items?.total > 0 && (
            <a className="text-sm font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/items/export.csv`}>
              Exporteren (CSV voor drukwerk)
            </a>
          )}
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="gen-mode" checked={gen.mode === "generate"} onChange={() => setGen({ ...gen, mode: "generate" })} /> Nummeren
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="gen-mode" checked={gen.mode === "list"} onChange={() => setGen({ ...gen, mode: "list" })} /> Eigen lijst plakken
          </label>
        </div>
        {gen.mode === "generate" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Aantal" name="gen-count" type="number" min="1" max="1000" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
            <Field label="Voorvoegsel" name="gen-prefix" maxLength={10} placeholder="Bijv. SN-" value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} />
            <Field label="Beginnen bij" name="gen-start" type="number" min="0" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} />
          </div>
        ) : (
          <div>
            <label htmlFor="gen-list" className="block text-sm font-medium text-slate-700">
              Serienummers (één per regel)
            </label>
            <textarea
              id="gen-list"
              rows={4}
              value={gen.list}
              onChange={(e) => setGen({ ...gen, list: e.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          {batches?.length > 0 && (
            <Select
              label="Koppelen aan batch"
              name="gen-batch"
              placeholder="Geen batch"
              options={batches.map((b) => ({ value: String(b.id), label: b.batch_number }))}
              value={gen.batchId}
              onChange={(e) => setGen({ ...gen, batchId: e.target.value })}
              className="w-56"
            />
          )}
          <Button type="button" variant="accent" loading={busy === "items"} onClick={addItems}>
            Exemplaren aanmaken
          </Button>
        </div>

        {items?.items?.length > 0 && (
          <>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {items.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-mono font-medium text-slate-800">{item.serial_number}</span>
                    {item.batch_number && <span className="ml-2 text-xs text-slate-500">batch {item.batch_number}</span>}
                    <span className="block truncate font-mono text-xs text-slate-400">{item.passportUrl}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {item.status === "archived" && <Badge variant="neutral">Gearchiveerd</Badge>}
                    <a className="text-xs font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/items/${item.id}/qr`} target="_blank" rel="noreferrer">
                      QR-code
                    </a>
                    <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => toggleItem(item)}>
                      {item.status === "active" ? "Archiveren" : "Heractiveren"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {items.total} exemplaren · pagina {items.page} van {items.pages}
              </span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Vorige
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={page >= items.pages} onClick={() => setPage(page + 1)}>
                  Volgende
                </Button>
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
