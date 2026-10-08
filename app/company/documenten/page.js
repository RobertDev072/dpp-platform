"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { downloadBlob, downloadCsv, dateStamp } from "@/lib/download";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import PageHeader from "@/components/ui/PageHeader";
import ActionButton from "@/components/ui/ActionButton";
import KpiCard from "@/components/ui/KpiCard";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { DownloadIcon, EditIcon, FileIcon, PlusIcon, AlertIcon } from "@/components/ui/icons";
import {
  DOCUMENT_CATEGORY_OPTIONS,
  documentCategoryLabel,
  documentExpiry,
  formatFileSize
} from "@/components/products/documentUtils";

const PAGE_SIZE = 50;

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fileUrl(doc) {
  return `/api/products/${doc.product_id}/documents/${doc.id}/file`;
}

function ExpiryBadge({ validUntil }) {
  const e = documentExpiry(validUntil);
  if (e.status === "none") return <span className="text-slate-400">—</span>;
  const variant = e.status === "expired" ? "danger" : e.status === "expiring" ? "warning" : "neutral";
  return (
    <span title={e.label}>
      <Badge variant={variant}>{e.status === "valid" ? e.date : e.label}</Badge>
    </span>
  );
}

function EditDialog({ doc, onClose, onSaved }) {
  const toast = useToast();
  const [values, setValues] = useState({
    title: doc.title || "",
    version: doc.version || "",
    language: doc.language || "",
    validUntil: doc.valid_until ? String(doc.valid_until).slice(0, 10) : "",
    category: doc.category || "document",
    isPublic: Boolean(doc.is_public)
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.patch(`/api/products/${doc.product_id}/documents/${doc.id}`, {
        title: values.title.trim(),
        version: values.version.trim() || null,
        language: values.language.trim() || null,
        validUntil: values.validUntil || null,
        category: values.category,
        isPublic: values.isPublic
      });
      toast.success("Document bijgewerkt");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="doc-edit-title">
      <form onSubmit={save} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <h2 id="doc-edit-title" className="text-base font-semibold text-slate-900">
          Document bewerken
        </h2>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="block text-sm font-medium text-slate-700">
          Titel
          <input required maxLength={200} value={values.title} onChange={set("title")} className={`mt-1 block w-full ${inputClass}`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700">
            Versie
            <input maxLength={30} value={values.version} onChange={set("version")} placeholder="Bijv. 2.1" className={`mt-1 block w-full ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Taal
            <input maxLength={10} value={values.language} onChange={set("language")} placeholder="nl, en…" className={`mt-1 block w-full ${inputClass}`} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Vervaldatum
            <input type="date" value={values.validUntil} onChange={set("validUntil")} className={`mt-1 block w-full ${inputClass}`} />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Documenttype
          <select value={values.category} onChange={set("category")} className={`mt-1 block w-full ${inputClass}`}>
            {DOCUMENT_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={values.isPublic} onChange={set("isPublic")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
          Openbaar op het productpaspoort
        </label>
        <div className="flex justify-end gap-2">
          <ActionButton onClick={onClose}>Annuleren</ActionButton>
          <ActionButton type="submit" variant="primary" disabled={saving || !values.title.trim()}>
            {saving ? "Opslaan…" : "Opslaan"}
          </ActionButton>
        </div>
      </form>
    </div>
  );
}

function AddDocumentDialog({ onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/api/products?pageSize=8${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((data) => !cancelled && setItems(data.items || []))
        .catch(() => !cancelled && setItems([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="doc-add-title">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 id="doc-add-title" className="text-base font-semibold text-slate-900">
          Document toevoegen
        </h2>
        <p className="text-sm text-slate-500">Een document hoort altijd bij een product. Kies het product; daarna sleep je het bestand erin.</p>
        <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op naam, SKU of GTIN" aria-label="Product zoeken" className={`block w-full ${inputClass}`} />
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {items === null ? (
            <li className="px-3 py-3 text-sm text-slate-500">Laden…</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">Geen producten gevonden.</li>
          ) : (
            items.map((p) => (
              <li key={p.id}>
                <Link href={`/company/products/${p.id}?tab=documents`} className="block px-3 py-2 hover:bg-slate-50">
                  <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                  {p.sku && <span className="block text-xs text-slate-500">SKU {p.sku}</span>}
                </Link>
              </li>
            ))
          )}
        </ul>
        <div className="flex justify-end">
          <ActionButton onClick={onClose}>Sluiten</ActionButton>
        </div>
      </div>
    </div>
  );
}

export default function DocumentenPage() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [documents, setDocuments] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState("");
  const [expiry, setExpiry] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const data = await api.get("/api/company/documents");
    setDocuments(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    // Filter uit de URL (links vanuit meldingen), zonder Suspense-afhankelijkheid.
    const params = new URLSearchParams(window.location.search);
    if (["expired", "expiring"].includes(params.get("expiry"))) setExpiry(params.get("expiry"));
    load().catch((err) => setLoadError(err.message));
  }, [load]);

  const stats = useMemo(() => {
    const active = (documents || []).filter((d) => !d.archived_at);
    return {
      total: active.length,
      public: active.filter((d) => d.is_public).length,
      expired: active.filter((d) => d.expiry_status === "expired").length,
      expiring: active.filter((d) => d.expiry_status === "expiring").length,
      bytes: (documents || []).reduce((sum, d) => sum + Number(d.file_size || 0), 0)
    };
  }, [documents]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (documents || []).filter((doc) => {
      if (!showArchived && doc.archived_at) return false;
      if (showArchived && !doc.archived_at) return false;
      if (category && doc.category !== category) return false;
      if (visibility === "public" && !doc.is_public) return false;
      if (visibility === "private" && doc.is_public) return false;
      if (expiry && doc.expiry_status !== expiry) return false;
      if (!term) return true;
      return [doc.title, doc.product_name, doc.product_sku, doc.version].some((v) => String(v || "").toLowerCase().includes(term));
    });
  }, [documents, search, category, visibility, expiry, showArchived]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search, category, visibility, expiry, showArchived]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((d) => next.delete(d.id));
      else visible.forEach((d) => next.add(d.id));
      return next;
    });
  }

  async function runBulk(action, label) {
    const ids = [...selected];
    if (action === "archive") {
      const ok = await confirm({
        title: `${ids.length} document${ids.length === 1 ? "" : "en"} archiveren?`,
        description: "Gearchiveerde documenten verdwijnen van het productpaspoort en tellen niet meer mee. Je kunt ze later herstellen.",
        confirmLabel: "Archiveren",
        tone: "danger"
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const result = await api.post("/api/company/documents/bulk", { action, ids });
      toast.success(`${label}: ${result.affected} document${result.affected === 1 ? "" : "en"}`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  }

  async function downloadZip() {
    const ids = [...selected].slice(0, 200);
    setBusy("download");
    try {
      const { items } = await api.post("/api/company/documents/download-links", { ids });
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const failed = [];
      const external = [];
      const used = new Set();
      for (const item of items) {
        if (item.external) {
          external.push(`${item.title}: ${item.url}`);
          continue;
        }
        try {
          const response = await fetch(item.url);
          if (!response.ok) throw new Error(String(response.status));
          const ext = (item.fileName || "").split(".").pop() || "bin";
          let base = `${item.productName} - ${item.title}`.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
          let name = `${base}.${ext}`;
          for (let i = 2; used.has(name); i += 1) name = `${base} (${i}).${ext}`;
          used.add(name);
          zip.file(name, await response.blob());
        } catch {
          failed.push(item.title);
        }
      }
      if (external.length) zip.file("externe-links.txt", external.join("\n"));
      if (used.size === 0 && !external.length) throw new Error("Er konden geen bestanden worden opgehaald.");
      downloadBlob(await zip.generateAsync({ type: "blob" }), `documenten-${dateStamp()}.zip`);
      if (failed.length) toast.error(`${failed.length} bestand(en) konden niet worden opgehaald: ${failed.slice(0, 3).join(", ")}`);
      else toast.success(`${used.size} bestand${used.size === 1 ? "" : "en"} gedownload`);
      if (selected.size > 200) toast.error("Maximaal 200 documenten per ZIP; de eerste 200 zijn gedownload.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  }

  function exportCsv() {
    const rows = (documents || []).filter((d) => selected.has(d.id));
    downloadCsv(
      `documenten-${dateStamp()}.csv`,
      ["Titel", "Product", "SKU", "Type", "Versie", "Taal", "Openbaar", "Vervaldatum", "Geüpload", "Door", "Gearchiveerd"],
      rows.map((d) => [
        d.title,
        d.product_name,
        d.product_sku || "",
        documentCategoryLabel(d.category),
        d.version || "",
        d.language || "",
        d.is_public ? "ja" : "nee",
        d.valid_until ? String(d.valid_until).slice(0, 10) : "",
        formatDate(d.created_at),
        d.uploader_name || d.uploader_email || "",
        d.archived_at ? "ja" : "nee"
      ])
    );
  }

  const hasFilters = search || category || visibility || expiry;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documenten"
        description="Alle handleidingen, certificaten en andere documenten van je producten op één plek."
        actions={
          <ActionButton variant="primary" icon={<PlusIcon />} onClick={() => setAdding(true)}>
            Document
          </ActionButton>
        }
      />

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Documenten" value={stats.total.toLocaleString("nl-NL")} loading={!documents} icon={<FileIcon />} />
        <KpiCard label="Openbaar" value={stats.public.toLocaleString("nl-NL")} hint="zichtbaar op paspoort" loading={!documents} />
        <KpiCard
          label="Verlopen"
          value={stats.expired.toLocaleString("nl-NL")}
          tone={stats.expired ? "danger" : "neutral"}
          hint={stats.expired ? "actie nodig" : "geen"}
          loading={!documents}
          icon={stats.expired ? <AlertIcon /> : null}
        />
        <KpiCard
          label="Verloopt binnen 30 dagen"
          value={stats.expiring.toLocaleString("nl-NL")}
          tone={stats.expiring ? "warning" : "neutral"}
          loading={!documents}
        />
        <KpiCard label="Opslag" value={formatFileSize(stats.bytes)} loading={!documents} />
      </div>

      {(stats.expired > 0 || stats.expiring > 0) && expiry === "" && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertIcon size={18} />
          <span className="flex-1">
            {stats.expired > 0 && `${stats.expired} verlopen document${stats.expired === 1 ? "" : "en"}. `}
            {stats.expiring > 0 && `${stats.expiring} verloopt binnenkort.`}
          </span>
          <button type="button" className="font-medium underline" onClick={() => setExpiry(stats.expired ? "expired" : "expiring")}>
            Toon
          </button>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op titel, product, SKU of versie"
            aria-label="Documenten zoeken"
            className={`w-full sm:w-72 ${inputClass}`}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Documenttype" className={inputClass}>
            <option value="">Alle typen</option>
            {DOCUMENT_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Zichtbaarheid" className={inputClass}>
            <option value="">Openbaar en privé</option>
            <option value="public">Openbaar</option>
            <option value="private">Privé</option>
          </select>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Vervaldatum" className={inputClass}>
            <option value="">Elke vervaldatum</option>
            <option value="expired">Verlopen</option>
            <option value="expiring">Verloopt binnen 30 dagen</option>
            <option value="valid">Geldig</option>
            <option value="none">Zonder vervaldatum</option>
          </select>
          <label className="ml-auto inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            Toon archief
          </label>
        </div>

        {!documents ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileIcon />}
            title="Nog geen documenten"
            description="Voeg handleidingen, certificaten of conformiteitsverklaringen toe aan je producten."
            action={
              <ActionButton variant="primary" icon={<PlusIcon />} onClick={() => setAdding(true)}>
                Document toevoegen
              </ActionButton>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={showArchived ? "Geen gearchiveerde documenten" : "Geen documenten gevonden"}
            description={hasFilters ? "Pas de filters aan of wis de zoekterm." : undefined}
            action={
              hasFilters ? (
                <ActionButton
                  onClick={() => {
                    setSearch("");
                    setCategory("");
                    setVisibility("");
                    setExpiry("");
                  }}
                >
                  Filters wissen
                </ActionButton>
              ) : null
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-8 py-2 pr-2">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Alles op deze pagina selecteren" className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                    </th>
                    <th className="py-2 pr-3">Document</th>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Versie / taal</th>
                    <th className="py-2 pr-3">Zichtbaarheid</th>
                    <th className="py-2 pr-3">Vervaldatum</th>
                    <th className="py-2 pr-3">Geüpload</th>
                    <th className="py-2 text-right">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((doc) => (
                    <tr key={doc.id} className={`border-b border-slate-100 ${selected.has(doc.id) ? "bg-emerald-50/50" : ""}`}>
                      <td className="py-2 pr-2">
                        <input type="checkbox" checked={selected.has(doc.id)} onChange={() => toggle(doc.id)} aria-label={`Selecteer ${doc.title}`} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                      </td>
                      <td className="py-2 pr-3">
                        <span className="block font-medium text-slate-900">{doc.title || "—"}</span>
                        <span className="block text-xs text-slate-500">
                          {documentCategoryLabel(doc.category)}
                          {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ""}
                          {!doc.is_upload && doc.storage_url ? " · externe link" : ""}
                          {doc.archived_at ? " · gearchiveerd" : ""}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <Link href={`/company/products/${doc.product_id}?tab=documents`} className="font-medium text-emerald-700 hover:underline">
                          {doc.product_name}
                        </Link>
                        {doc.product_sku && <span className="block text-xs text-slate-500">SKU {doc.product_sku}</span>}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {doc.version ? `v${doc.version}` : "—"}
                        {doc.language ? <span className="ml-1 uppercase text-slate-500">· {doc.language}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={doc.is_public ? "success" : "neutral"}>{doc.is_public ? "Openbaar" : "Privé"}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <ExpiryBadge validUntil={doc.valid_until} />
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {formatDate(doc.created_at)}
                        {(doc.uploader_name || doc.uploader_email) && (
                          <span className="block max-w-40 truncate text-xs text-slate-500">{doc.uploader_name || doc.uploader_email}</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-1">
                          <a
                            href={fileUrl(doc)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Openen / downloaden"
                            aria-label={`${doc.title} openen`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <DownloadIcon size={16} />
                          </a>
                          <button
                            type="button"
                            title="Bewerken"
                            aria-label={`${doc.title} bewerken`}
                            onClick={() => setEditing(doc)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <EditIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                <span>
                  {((page - 1) * PAGE_SIZE + 1).toLocaleString("nl-NL")}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString("nl-NL")} van{" "}
                  {filtered.length.toLocaleString("nl-NL")}
                </span>
                <div className="flex gap-2">
                  <ActionButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Vorige
                  </ActionButton>
                  <ActionButton size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                    Volgende
                  </ActionButton>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <BulkActionBar count={selected.size} total={filtered.length} onClear={() => setSelected(new Set())}>
        <BulkButton disabled={Boolean(busy)} onClick={downloadZip}>
          {busy === "download" ? "Downloaden…" : "Downloaden (ZIP)"}
        </BulkButton>
        {!showArchived && (
          <>
            <BulkButton disabled={Boolean(busy)} onClick={() => runBulk("publish", "Openbaar gemaakt")}>
              Openbaar maken
            </BulkButton>
            <BulkButton disabled={Boolean(busy)} onClick={() => runBulk("unpublish", "Privé gemaakt")}>
              Privé maken
            </BulkButton>
          </>
        )}
        <BulkButton disabled={Boolean(busy)} onClick={exportCsv}>
          Exporteren (CSV)
        </BulkButton>
        {showArchived ? (
          <BulkButton tone="primary" disabled={Boolean(busy)} onClick={() => runBulk("restore", "Hersteld")}>
            Herstellen
          </BulkButton>
        ) : (
          <BulkButton tone="danger" disabled={Boolean(busy)} onClick={() => runBulk("archive", "Gearchiveerd")}>
            Archiveren
          </BulkButton>
        )}
      </BulkActionBar>

      {editing && (
        <EditDialog
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {adding && <AddDocumentDialog onClose={() => setAdding(false)} />}
      {confirmDialog}
    </div>
  );
}
