"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import InfoTip from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { HELP, instanceGuide, plannedItemCount, itemsConfirmMessage, BATCH_CONFIRM, itemsCreatedMessage } from "@/lib/instancesGuide";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("nl-NL") : "—";
}

// Vergelijking model / batch / exemplaar. Op een breed scherm een tabel, op mobiel drie
// kaartjes onder elkaar.
const LEVELS = [
  {
    title: "Model",
    what: "Het soort product",
    example: "“Sneaker Blauw”",
    codes: "1 voor alles",
    useful: "Algemene productinformatie",
    required: "Altijd"
  },
  {
    title: "Batch",
    what: "Eén productieronde",
    example: "“Lot 42, gemaakt op 15 oktober”",
    codes: "1 per ronde",
    useful: "Terugroepacties, kwaliteit per ronde",
    required: "Nee"
  },
  {
    title: "Exemplaar",
    what: "Eén los stuk met eigen serienummer",
    example: "“Sneaker SN-00001”",
    codes: "1 per stuk",
    useful: "Garantie, reparatie, onderhoud, tweedehands",
    required: "Nee, behalve bij batterijen (EU, vanaf 18 februari 2027)"
  }
];
const ROWS = [
  ["what", "Wat is het?"],
  ["example", "Voorbeeld"],
  ["codes", "QR-codes"],
  ["useful", "Handig voor"],
  ["required", "Verplicht?"]
];
const CHOICES = [
  ["Meubels, kleding, kleine oplagen", "Alleen het model"],
  ["Verpakt voedsel, cosmetica, verf", "Model + batch"],
  ["Fietsen, machines, elektronica", "Model + exemplaar"],
  ["Batterijen (EV, e-bike, industrieel)", "Exemplaar, verplicht door de EU vanaf 18 februari 2027"]
];

function Guide() {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Wanneer gebruik ik batches en exemplaren?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Je product heeft al één QR-code die voor álle stuks geldt (het model). Die blijft altijd werken. Hier maak je extra
          QR-codes, als je meer wilt laten zien.
        </p>
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-slate-900">
            <th className="w-32 py-2 pr-3 font-medium" scope="col">
              <span className="sr-only">Kenmerk</span>
            </th>
            {LEVELS.map((level) => (
              <th key={level.title} className="py-2 pr-3 font-semibold" scope="col">
                {level.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-600">
          {ROWS.map(([key, label]) => (
            <tr key={key}>
              <th className="py-2 pr-3 font-medium text-slate-700" scope="row">
                {label}
              </th>
              {LEVELS.map((level) => (
                <td key={level.title} className="py-2 pr-3 align-top">
                  {level[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-3 sm:hidden">
        {LEVELS.map((level) => (
          <div key={level.title} className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-semibold text-slate-900">{level.title}</p>
            <dl className="mt-2 space-y-1">
              {ROWS.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-slate-700">{level[key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium text-slate-900">Wanneer doe ik wat?</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Eenmalig: maak je product aan en publiceer het. Je model-QR staat nu online.</li>
          <li>Bij elke nieuwe productieronde: voeg een batch toe (lotnummer, datum, aantal).</li>
          <li>Als je labels of stickers laat drukken: maak de exemplaren aan en download de QR-codes voor je drukker.</li>
          <li>Plak elke code op het juiste product.</li>
        </ol>
        <p className="mt-3 font-medium text-slate-900">Let op:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Nieuwe codes staan direct online zodra je ze aanmaakt.</li>
          <li>Een QR-code werkt alleen als hij op het product zit. Producten die je al verkocht hebt, krijgen niet vanzelf een eigen code.</li>
          <li>Je kunt altijd batches en exemplaren toevoegen, ook als je model-QR al maanden online staat.</li>
        </ul>
      </details>

      <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium text-slate-900">Welke kies ik voor mijn bedrijf?</summary>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-900">
              <th className="py-2 pr-3 font-medium" scope="col">
                Soort product
              </th>
              <th className="py-2 font-medium" scope="col">
                Wat gebruik je?
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {CHOICES.map(([kind, choice]) => (
              <tr key={kind}>
                <td className="py-2 pr-3 align-top">{kind}</td>
                <td className="py-2 align-top">{choice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

// Batch- en itempaspoorten. Elke batch en elk exemplaar krijgt een eigen, permanente
// QR-code; de productgegevens komen van dit (model)paspoort.
export default function InstancesTab({ product }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [batches, setBatches] = useState(null);
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(1);
  const [batchForm, setBatchForm] = useState({ batchNumber: "", productionDate: "", quantity: "" });
  const [gen, setGen] = useState({ mode: "generate", count: "10", prefix: "", start: "1", list: "", batchId: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const { canCreate, notices } = instanceGuide(product);

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
    const ok = await confirm({ title: "Batch toevoegen?", message: BATCH_CONFIRM, confirmLabel: "Ja, aanmaken", cancelLabel: "Annuleren" });
    if (!ok) return;
    setBusy("batch");
    try {
      await api.post(`/api/products/${product.id}/batches`, {
        batchNumber: batchForm.batchNumber.trim(),
        productionDate: batchForm.productionDate || undefined,
        quantity: batchForm.quantity ? Number(batchForm.quantity) : undefined
      });
      setBatchForm({ batchNumber: "", productionDate: "", quantity: "" });
      toast.success("Batch toegevoegd en online");
      await loadBatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function addItems() {
    setError("");
    const count = plannedItemCount(gen);
    if (count < 1) return setError("Vul een aantal of een lijst met serienummers in");
    const ok = await confirm({ title: "Exemplaren aanmaken?", message: itemsConfirmMessage(count), confirmLabel: "Ja, aanmaken", cancelLabel: "Annuleren" });
    if (!ok) return;
    setBusy("items");
    try {
      const body =
        gen.mode === "generate"
          ? { generate: { count: Number(gen.count), prefix: gen.prefix.trim(), start: Number(gen.start) || 1, digits: 5 } }
          : { serials: gen.list.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) };
      if (gen.batchId) body.batchId = Number(gen.batchId);
      const result = await api.post(`/api/products/${product.id}/items`, body);
      setCreated({ count: result.created, skipped: result.skipped.length, since: result.since });
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

  return (
    <div className="space-y-4">
      <Guide />

      {notices.map((notice) => (
        <div
          key={notice.key}
          role={notice.tone === "warning" ? "alert" : "note"}
          className={`rounded-xl border p-4 text-sm ${notice.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}
        >
          {notice.text}
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Batches</h2>
          <p className="text-xs text-slate-500">Een eigen QR-code per productieronde (lot).</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field
            label={
              <>
                Batch- / lotnummer
                <InfoTip text={HELP.lot} />
              </>
            }
            name="batch-number"
            maxLength={100}
            value={batchForm.batchNumber}
            onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
          />
          <Field label="Productiedatum" name="batch-date" type="date" value={batchForm.productionDate} onChange={(e) => setBatchForm({ ...batchForm, productionDate: e.target.value })} />
          <Field label="Aantal" name="batch-qty" type="number" min="1" value={batchForm.quantity} onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })} />
          <Button type="button" variant="accent" loading={busy === "batch"} disabled={!canCreate} onClick={addBatch}>
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
                <span className="flex items-center gap-3">
                  <a className="text-xs font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/batches/${b.id}/qr`} target="_blank" rel="noreferrer">
                    QR-code
                  </a>
                  <a className="text-xs font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/batches/${b.id}/qr?type=datamatrix`} target="_blank" rel="noreferrer">
                    Data Matrix
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Exemplaren (serienummers)</h2>
            <p className="text-xs text-slate-500">Een eigen QR-code per stuk. Tot 1000 per keer.</p>
          </div>
          {items?.total > 0 && (
            <span className="flex flex-wrap gap-3 text-sm">
              <a className="font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/items/qr.zip`}>
                Alle QR-codes (ZIP)
              </a>
              <a className="font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/items/export.csv`}>
                Overzicht voor drukker (CSV)
              </a>
            </span>
          )}
        </div>

        {created && (
          <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p>
              {itemsCreatedMessage(created.count)}
              {created.skipped ? ` (${created.skipped} serienummers bestonden al en zijn overgeslagen.)` : ""}
            </p>
            {created.count > 0 && (
              <div className="flex flex-wrap gap-2">
                <a
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                  href={`/api/products/${product.id}/items/qr.zip?createdAfter=${encodeURIComponent(created.since)}`}
                >
                  Download alle QR-codes (ZIP)
                </a>
                <a
                  className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
                  href={`/api/products/${product.id}/items/export.csv`}
                >
                  Overzicht voor drukker (CSV)
                </a>
              </div>
            )}
          </div>
        )}

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
            <Field
              label={
                <>
                  Voorvoegsel
                  <InfoTip text={HELP.prefix} />
                </>
              }
              name="gen-prefix"
              maxLength={10}
              placeholder="Bijv. SN-"
              value={gen.prefix}
              onChange={(e) => setGen({ ...gen, prefix: e.target.value })}
            />
            <Field
              label={
                <>
                  Beginnen bij
                  <InfoTip text={HELP.start} />
                </>
              }
              name="gen-start"
              type="number"
              min="0"
              value={gen.start}
              onChange={(e) => setGen({ ...gen, start: e.target.value })}
            />
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
              label={
                <>
                  Koppelen aan batch
                  <InfoTip text={HELP.batchLink} />
                </>
              }
              name="gen-batch"
              placeholder="Geen batch"
              options={batches.map((b) => ({ value: String(b.id), label: b.batch_number }))}
              value={gen.batchId}
              onChange={(e) => setGen({ ...gen, batchId: e.target.value })}
              className="w-56"
            />
          )}
          <Button type="button" variant="accent" loading={busy === "items"} disabled={!canCreate} onClick={addItems}>
            Exemplaren aanmaken
          </Button>
        </div>

        {items?.items?.length > 0 && (
          <>
            <p className="text-xs text-slate-500">
              Data Matrix
              <InfoTip text={HELP.dataMatrix} label="Wat is Data Matrix?" />
            </p>
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
                    <a className="text-xs font-medium text-blue-600 hover:underline" href={`/api/products/${product.id}/items/${item.id}/qr?type=datamatrix`} target="_blank" rel="noreferrer">
                      Data Matrix
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
            <p className="text-xs text-slate-500">
              Een exemplaar archiveren (bijv. gesloopt of teruggenomen) laat het paspoort raadpleegbaar; het krijgt de status
              gearchiveerd. Serienummers zijn uniek per product: hetzelfde nummer twee keer aanmaken wordt overgeslagen.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
