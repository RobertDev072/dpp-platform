"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import ActionButton from "@/components/ui/ActionButton";
import KpiCard from "@/components/ui/KpiCard";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import IconButton from "@/components/ui/IconButton";
import ProgressBar from "@/components/ui/ProgressBar";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { QrStatusBadge, QR_STATUS_OPTIONS } from "@/components/products/ProductStatus";
import PrintDialog, { loaderForIds } from "@/components/print/PrintDialog";
import { CopyIcon, DownloadIcon, EyeIcon, PrinterIcon, QrIcon, PlusIcon } from "@/components/ui/icons";
import { formatNumber, formatDate } from "@/lib/format";

const PAGE_SIZE = 24;

function QrCard({ item, selected, onToggle, onPrint, onCopy }) {
  return (
    <div className={`relative flex gap-4 rounded-xl border bg-white p-4 shadow-sm ${selected ? "border-emerald-400 ring-1 ring-emerald-400" : "border-slate-200"}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`${item.name} selecteren`}
        className="absolute left-2 top-2 h-4 w-4 rounded border-slate-300 text-emerald-600"
      />
      {item.public_id ? (
        <img
          src={`/api/products/${item.id}/qr.png`}
          alt={`QR-code voor ${item.name}`}
          loading="lazy"
          className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1"
        />
      ) : (
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-center text-xs text-slate-400">
          Nog geen QR
        </div>
      )}
      <div className="min-w-0 flex-1">
        <a href={`/company/products/${item.id}?tab=qr`} className="block truncate text-sm font-medium text-slate-900 hover:text-emerald-700" title={item.name}>
          {item.name}
        </a>
        <p className="truncate text-xs text-slate-500">{item.sku ? `SKU ${item.sku}` : "Geen SKU"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <QrStatusBadge product={item} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {formatNumber(item.scans_total)} scans{item.last_scan ? ` · laatst ${formatDate(item.last_scan)}` : ""}
        </p>
        {item.public_id && (
        <div className="mt-2 flex flex-wrap gap-1">
          <IconButton title="Publiek paspoort bekijken" onClick={() => window.open(`/p/${item.public_id}`, "_blank", "noopener")}>
            <EyeIcon size={16} />
          </IconButton>
          <IconButton title="QR-URL kopiëren" onClick={() => onCopy(item.qr_url)}>
            <CopyIcon size={16} />
          </IconButton>
          <a
            href={`/api/products/${item.id}/qr.svg`}
            download
            title="SVG downloaden"
            aria-label="SVG downloaden"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <DownloadIcon size={16} />
          </a>
          <IconButton title="Label printen" onClick={() => onPrint(item.id)}>
            <PrinterIcon size={16} />
          </IconButton>
        </div>
        )}
      </div>
    </div>
  );
}

function QrCodesInner() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [filters, setFilters] = useState({
    q: "",
    category: "",
    qrStatus: searchParams.get("qrStatus") || "",
    sort: "name",
    page: 1
  });
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [generating, setGenerating] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [filters.q, filters.category, filters.qrStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE), sort: filters.sort });
    if (filters.q) params.set("q", filters.q);
    if (filters.category) params.set("category", filters.category);
    if (filters.qrStatus) params.set("qrStatus", filters.qrStatus);
    api
      .get(`/api/qr?${params.toString()}`)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, reload]);

  useEffect(() => {
    api.get("/api/qr/stats").then(setStats).catch(() => setStats(null));
    api.get("/api/products/categories").then((list) => setCategories(Array.isArray(list) ? list : [])).catch(() => {});
  }, [reload]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = items.map((i) => i.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? total : selected.size;

  const copy = useCallback(
    async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("QR-URL gekopieerd");
      } catch {
        toast.error("Kopiëren lukte niet");
      }
    },
    [toast]
  );

  // Loader voor "alle resultaten": pagina's van 500 via dezelfde API als de lijst.
  function loaderForFilter() {
    return async (onProgress, limit) => {
      const all = [];
      for (let page = 1; ; page += 1) {
        const params = new URLSearchParams({ page: String(page), pageSize: String(limit || 500), sort: filters.sort });
        if (filters.q) params.set("q", filters.q);
        if (filters.category) params.set("category", filters.category);
        if (filters.qrStatus) params.set("qrStatus", filters.qrStatus);
        const result = await api.get(`/api/qr?${params.toString()}`);
        all.push(...result.items);
        onProgress(all.length);
        if (limit || all.length >= result.total || result.items.length === 0) break;
      }
      return all;
    };
  }

  function openDialog(mode, ids) {
    if (ids) setDialog({ mode, count: ids.length, loadItems: loaderForIds(ids) });
    else if (allMatching) setDialog({ mode, count: total, loadItems: loaderForFilter() });
    else setDialog({ mode, count: selected.size, loadItems: loaderForIds([...selected]) });
  }

  async function generateMissing() {
    const missing = stats?.without_qr || 0;
    if (!missing) {
      toast.success("Alle conceptproducten hebben al een QR-code");
      return;
    }
    const ok = await confirm({
      title: `QR-codes genereren voor ${formatNumber(missing)} ${missing === 1 ? "product" : "producten"}?`,
      description:
        "Producten zonder QR-code krijgen er een, zonder te publiceren. Je kunt de labels dan meteen printen; wie scant ziet 'nog niet gepubliceerd' tot je het product publiceert.",
      confirmLabel: "Genereren"
    });
    if (!ok) return;
    setGenerating({ value: 0, max: missing });
    try {
      let done = 0;
      // Rondes van max. 1000 (servergrens per bulkactie).
      for (;;) {
        const result = await api.post("/api/products/bulk", { action: "reserve_qr", filter: {} });
        done += result.affected;
        setGenerating({ value: Math.min(done, missing), max: missing });
        if (result.affected === 0 || done >= missing) break;
      }
      toast.success(`✓ ${formatNumber(done)} QR-codes gegenereerd`);
      setFilters((f) => ({ ...f, qrStatus: "reserved", page: 1 }));
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(null);
    }
  }

  async function generateForSelection() {
    const ids = [...selected];
    try {
      const result = await api.post("/api/products/bulk", { action: "reserve_qr", ids });
      toast.success(`${result.affected} QR-codes gegenereerd`);
      setSelected(new Set());
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const hasFilters = filters.q || filters.category || filters.qrStatus;

  return (
    <div className="space-y-6">
      <PageHeader
        title="QR-codes"
        description="Beheer, genereer, download en print QR-codes voor je producten. Een QR-code verandert nooit: geprinte labels blijven altijd werken."
        actions={
          <>
            <ActionButton icon={<QrIcon />} onClick={generateMissing} disabled={Boolean(generating)} title="QR-codes maken voor alle concepten zonder QR">
              Bulk genereren
            </ActionButton>
            <ActionButton href="/company/products?status=draft" variant="primary" icon={<PlusIcon />} title="Kies een product om een QR-code voor te maken">
              QR-code
            </ActionButton>
          </>
        }
      />

      {generating && (
        <Card>
          <ProgressBar label="QR-codes genereren" value={generating.value} max={generating.max} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard loading={!stats} label="Totaal QR-codes" value={stats && formatNumber(stats.total)} />
        <KpiCard loading={!stats} label="Actief" value={stats && formatNumber(stats.active)} hint="gepubliceerd" tone="positive" />
        <KpiCard loading={!stats} label="Klaar, niet gepubliceerd" value={stats && formatNumber(stats.reserved)} />
        <KpiCard
          loading={!stats}
          label="Concepten zonder QR"
          value={stats && formatNumber(stats.without_qr)}
          tone="warning"
          hint={stats?.without_qr ? "Bulk genereren" : null}
        />
        <KpiCard loading={!stats} label="Scans vandaag" value={stats && formatNumber(stats.scans_today)} />
        <KpiCard loading={!stats} label="Scans deze maand" value={stats && formatNumber(stats.scans_month)} hint={stats && `${formatNumber(stats.scans_total)} totaal`} />
      </div>

      {stats?.topScanned?.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Meest gescand (30 dagen)</h2>
          <ol className="divide-y divide-slate-100">
            {stats.topScanned.map((p, index) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <a href={`/company/products/${p.id}`} className="min-w-0 truncate text-slate-800 hover:text-emerald-700">
                  <span className="mr-2 text-slate-400">{index + 1}.</span>
                  {p.name}
                </a>
                <span className="shrink-0 tabular-nums text-slate-500">{formatNumber(p.scans)} scans</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            Zoeken
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Naam, SKU of GTIN"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-slate-700 lg:w-48">
            Status
            <select
              value={filters.qrStatus}
              onChange={(e) => setFilters((f) => ({ ...f, qrStatus: e.target.value, page: 1 }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Alle met QR-code</option>
              {QR_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 lg:w-52">
            Categorie
            <select
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value, page: 1 }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Alle categorieën</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 lg:w-44">
            Sorteren
            <select
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value, page: 1 }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="name">Naam</option>
              <option value="scans">Meeste scans</option>
              <option value="recent">Laatst gewijzigd</option>
            </select>
          </label>
        </div>
        {items.length > 0 && (
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allOnPage || allMatching}
              onChange={() => {
                setAllMatching(false);
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allOnPage) pageIds.forEach((id) => next.delete(id));
                  else pageIds.forEach((id) => next.add(id));
                  return next;
                });
              }}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            Alles op deze pagina selecteren
          </label>
        )}
      </Card>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          {hasFilters ? (
            <EmptyState title="Geen QR-codes gevonden" description="Pas je zoekopdracht of filters aan." />
          ) : (
            <EmptyState
              icon={<QrIcon />}
              title="Nog geen QR-codes"
              description="Een QR-code ontstaat zodra je een product publiceert of er alvast een QR voor genereert."
              action={
                <ActionButton variant="primary" icon={<QrIcon />} onClick={generateMissing}>
                  QR-codes genereren
                </ActionButton>
              }
              secondaryAction={<ActionButton href="/company/products">Naar producten</ActionButton>}
            />
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <QrCard
                key={item.id}
                item={item}
                selected={allMatching || selected.has(item.id)}
                onToggle={() => {
                  setAllMatching(false);
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                }}
                onPrint={(id) => openDialog("pdf", [id])}
                onCopy={copy}
              />
            ))}
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Pagina {filters.page} van {totalPages} ({formatNumber(total)} QR-codes)
              </p>
              <div className="flex gap-2">
                <ActionButton disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
                  Vorige
                </ActionButton>
                <ActionButton disabled={filters.page >= totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
                  Volgende
                </ActionButton>
              </div>
            </div>
          )}
        </>
      )}

      <BulkActionBar
        count={selected.size}
        total={total}
        allMatching={allMatching}
        onSelectAllMatching={allOnPage ? () => setAllMatching(true) : null}
        onClear={() => {
          setSelected(new Set());
          setAllMatching(false);
        }}
      >
        <BulkButton tone="primary" onClick={() => openDialog("pdf")}>
          PDF-labels
        </BulkButton>
        <BulkButton onClick={() => openDialog("png")}>ZIP (PNG)</BulkButton>
        <BulkButton onClick={() => openDialog("svg")}>ZIP (SVG)</BulkButton>
        {!allMatching && filters.qrStatus === "none" && <BulkButton onClick={generateForSelection}>QR genereren</BulkButton>}
      </BulkActionBar>

      {dialog && (
        <PrintDialog
          count={dialog.count || selectionCount}
          loadItems={dialog.loadItems}
          initialMode={dialog.mode}
          onClose={() => setDialog(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export default function QrCodesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <QrCodesInner />
    </Suspense>
  );
}
