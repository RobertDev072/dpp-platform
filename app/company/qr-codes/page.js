"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Select from "@/components/ui/Select";
import Field from "@/components/ui/Field";
import { QrStatusBadge } from "@/components/ui/StatusBadge";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PrintExportDialog from "@/components/print/PrintExportDialog";
import { CheckCircleIcon, CopyIcon, DownloadIcon, EyeIcon, PrinterIcon, QrIcon, ScanIcon, SearchIcon } from "@/components/ui/icons";

const PAGE_SIZE = 24;

const QR_OPTIONS = [
  { value: "any", label: "Met QR-code" },
  { value: "active", label: "Actief" },
  { value: "reserved", label: "Gereserveerd (niet actief)" },
  { value: "none", label: "Nog geen QR-code" }
];

const SORT_OPTIONS = [
  { value: "updated_at:desc", label: "Laatst gewijzigd" },
  { value: "name:asc", label: "Naam A-Z" },
  { value: "created_at:desc", label: "Laatst toegevoegd" }
];

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

function QrCodesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = useState(() => ({
    q: searchParams.get("q") || "",
    qr: searchParams.get("qr") || "any",
    category: searchParams.get("category") || "",
    sort: searchParams.get("sort") || "updated_at:desc",
    page: 1
  }));
  const [search, setSearch] = useState(filters.q);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [exportFormat, setExportFormat] = useState(null);
  const [reload, setReload] = useState(0);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const t = setTimeout(() => setFilters((prev) => (prev.q === search ? prev : { ...prev, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.qr !== "any") params.set("qr", filters.qr);
    if (filters.category) params.set("category", filters.category);
    if (filters.sort !== "updated_at:desc") params.set("sort", filters.sort);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setSelected(new Set());
    setAllMatching(false);
  }, [filters.q, filters.qr, filters.category, filters.sort, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    const [sort, order] = filters.sort.split(":");
    const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE), sort, order, withScans: "1", qr: filters.qr });
    if (filters.q) params.set("q", filters.q);
    if (filters.category) params.set("category", filters.category);
    api
      .get(`/api/products?${params}`)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, reload]);

  useEffect(() => {
    api.get("/api/products/qr-stats").then(setStats).catch(() => setStats(null));
    api.get("/api/products/categories").then((d) => setCategories(Array.isArray(d) ? d : [])).catch(() => {});
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = items.map((p) => p.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allMatching ? total : selected.size;
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c, label: c })), [categories]);

  function selection() {
    if (allMatching) {
      const filter = { qr: filters.qr };
      if (filters.q) filter.q = filters.q;
      if (filters.category) filter.category = filters.category;
      return { filter };
    }
    return { ids: [...selected] };
  }

  function toggle(id) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generateQr(selectionOverride, count) {
    const ok = await confirm({
      title: `QR-codes aanmaken voor ${nl(count)} producten?`,
      message: "Producten zonder QR-code krijgen een permanente QR-code. Die is direct te printen en wordt actief zodra het product gepubliceerd is.",
      confirmLabel: "QR-codes aanmaken"
    });
    if (!ok) return;
    try {
      const result = await api.post("/api/products/bulk/actions", { action: "generate_qr", selection: selectionOverride });
      toast.success(`${nl(result.affected)} QR-codes aangemaakt`);
      setSelected(new Set());
      setAllMatching(false);
      setReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function copyUrl(product) {
    const url = `${origin}/p/${String(product.public_id).toUpperCase()}`;
    navigator.clipboard?.writeText(url).then(() => toast.success("Link gekopieerd"), () => toast.error("Kopiëren lukte niet"));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="QR-codes"
        description="Beheer, genereer, download en print QR-codes voor je producten. Een QR-code wordt actief zodra het product gepubliceerd is en blijft daarna altijd werken."
        actions={
          <>
            <Button
              variant="outline"
              icon={QrIcon}
              disabled={!stats?.withoutQr}
              onClick={() => generateQr({ filter: { qr: "none" } }, stats?.withoutQr || 0)}
              title={stats?.withoutQr ? undefined : "Alle producten hebben al een QR-code"}
            >
              Bulk genereren{stats?.withoutQr ? ` (${nl(stats.withoutQr)})` : ""}
            </Button>
            <Button variant="accent" icon={PrinterIcon} disabled={!stats?.total} onClick={() => {
              setAllMatching(true);
              setExportFormat("pdf");
            }}>
              Labels printen
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard loading={!stats} label="QR-codes" value={stats && formatNumber(stats.total)} icon={QrIcon} />
        <KpiCard loading={!stats} label="Actief" value={stats && formatNumber(stats.active)} icon={CheckCircleIcon} tone="success" />
        <KpiCard loading={!stats} label="Niet actief" value={stats && formatNumber(stats.reserved)} description="gereserveerd, nog niet gepubliceerd" tone="info" icon={QrIcon} />
        <KpiCard loading={!stats} label="Totale scans" value={stats && formatNumber(stats.scans.total)} icon={ScanIcon} />
        <KpiCard loading={!stats} label="Scans vandaag" value={stats && formatNumber(stats.scans.today)} icon={ScanIcon} />
        <KpiCard loading={!stats} label="Scans deze maand" value={stats && formatNumber(stats.scans.thisMonth)} icon={ScanIcon} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <Field label="Zoeken" name="qr-search" type="search" placeholder="Naam, SKU of GTIN..." value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
              <Select label="Status" name="qr-status" options={QR_OPTIONS} value={filters.qr} onChange={(e) => setFilters((p) => ({ ...p, qr: e.target.value, page: 1 }))} className="w-full md:w-56" />
              <Select label="Categorie" name="qr-category" placeholder="Alle categorieën" options={categoryOptions} value={filters.category} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value, page: 1 }))} className="w-full md:w-48" />
              <Select label="Sorteren" name="qr-sort" options={SORT_OPTIONS} value={filters.sort} onChange={(e) => setFilters((p) => ({ ...p, sort: e.target.value, page: 1 }))} className="w-full md:w-44" />
            </div>
            {items.length > 0 && (
              <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={() => {
                    setAllMatching(false);
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allOnPage) pageIds.forEach((id) => next.delete(id));
                      else pageIds.forEach((id) => next.add(id));
                      return next;
                    });
                  }}
                  className="h-4 w-4"
                />
                Alles op deze pagina selecteren
                {allOnPage && total > items.length && !allMatching && (
                  <button type="button" onClick={() => setAllMatching(true)} className="font-medium text-emerald-700 underline">
                    of alle {nl(total)} resultaten
                  </button>
                )}
              </label>
            )}
          </Card>

          {loadError && <Card className="border-red-200 bg-red-50 text-sm text-red-700">We konden de QR-codes niet laden: {loadError}</Card>}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card>
              {filters.qr === "none" || filters.q || filters.category ? (
                <EmptyState icon={SearchIcon} title="Geen producten gevonden" description="Pas je zoekopdracht of filters aan." />
              ) : (
                <EmptyState
                  icon={QrIcon}
                  title="Nog geen QR-codes"
                  description="Maak QR-codes aan voor je producten (ook vóór publicatie, om alvast labels te printen) of publiceer een product."
                  action={
                    <Link href="/company/products" className="text-sm font-medium text-emerald-700 hover:underline">
                      Naar producten
                    </Link>
                  }
                />
              )}
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {items.map((product) => {
                const isSelected = allMatching || selected.has(product.id);
                return (
                  <Card key={product.id} className={`flex flex-col gap-3 ${isSelected ? "border-emerald-400 ring-1 ring-emerald-400" : ""}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" aria-label={`${product.name} selecteren`} checked={isSelected} onChange={() => toggle(product.id)} className="mt-1 h-4 w-4 shrink-0" />
                      {product.public_id ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/products/${product.id}/qr.png`} alt={`QR-code voor ${product.name}`} loading="lazy" className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                          <QrIcon size={28} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/company/products/${product.id}?tab=qr`} className="block truncate text-sm font-medium text-slate-900 hover:text-emerald-700" title={product.name}>
                          {product.name}
                        </Link>
                        <p className="truncate text-xs text-slate-500">{product.sku ? `SKU ${product.sku}` : "Geen SKU"}</p>
                        <div className="mt-1.5">
                          <QrStatusBadge status={product.qr_status} />
                        </div>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Scans</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">{nl(product.scan_count)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Laatste scan</dt>
                        <dd className="truncate text-slate-900">{product.last_scan_at ? formatDateTime(product.last_scan_at) : "—"}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex items-center gap-1.5">
                      {product.public_id ? (
                        <>
                          <a href={`/api/products/${product.id}/qr.png?size=1200&download=1`} title="PNG downloaden (300 DPI)" aria-label={`PNG van ${product.name} downloaden`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
                            <DownloadIcon size={14} /> PNG
                          </a>
                          <a href={`/api/products/${product.id}/qr.svg?download=1`} title="SVG downloaden (vector)" aria-label={`SVG van ${product.name} downloaden`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
                            SVG
                          </a>
                          <button type="button" onClick={() => copyUrl(product)} title="Publieke link kopiëren" aria-label={`Link van ${product.name} kopiëren`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                            <CopyIcon size={14} />
                          </button>
                          {product.qr_status === "active" && (
                            <a href={`/p/${product.public_id}`} target="_blank" rel="noopener noreferrer" title="Paspoort bekijken" aria-label={`Paspoort van ${product.name} bekijken`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                              <EyeIcon size={14} />
                            </a>
                          )}
                        </>
                      ) : (
                        <Button variant="outline" size="sm" icon={QrIcon} onClick={() => generateQr({ ids: [product.id] }, 1)}>
                          QR-code aanmaken
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {!loading && total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Pagina {filters.page} van {totalPages} ({nl(total)})
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))}>
                  Vorige
                </Button>
                <Button variant="outline" size="sm" disabled={filters.page >= totalPages} onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}>
                  Volgende
                </Button>
              </span>
            </div>
          )}
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Meest gescand (30 dagen)</h2>
          {!stats ? (
            <Skeleton className="h-32 w-full" />
          ) : stats.top.length === 0 ? (
            <p className="text-sm text-slate-500">Nog geen scans in de afgelopen 30 dagen.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {stats.top.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="w-4 text-xs tabular-nums text-slate-400">{i + 1}</span>
                  <Link href={`/company/products/${p.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-emerald-700">
                    {p.name}
                  </Link>
                  <span className="tabular-nums font-medium text-slate-900">{nl(p.scans)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <BulkActionBar
        selectedCount={exportFormat ? 0 : selectedCount}
        onClear={() => {
          setSelected(new Set());
          setAllMatching(false);
        }}
        actions={
          <>
            <BulkButton icon={QrIcon} onClick={() => generateQr(selection(), selectedCount)}>
              QR genereren
            </BulkButton>
            <BulkButton icon={DownloadIcon} onClick={() => setExportFormat("png")}>
              Downloaden (ZIP)
            </BulkButton>
            <BulkButton icon={PrinterIcon} tone="accent" onClick={() => setExportFormat("pdf")}>
              PDF-labels
            </BulkButton>
          </>
        }
      />

      {exportFormat && (
        <PrintExportDialog
          open
          initialFormat={exportFormat}
          selection={selection()}
          count={selectedCount}
          onClose={() => {
            setExportFormat(null);
            setSelected(new Set());
            setAllMatching(false);
            setReload((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

export default function QrCodesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <QrCodesInner />
    </Suspense>
  );
}
