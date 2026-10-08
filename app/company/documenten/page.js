"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DOCUMENT_CATEGORY_OPTIONS, documentCategoryLabel, documentValidity, formatFileSize } from "@/components/products/documentUtils";
import { AlertIcon, ExternalIcon, EyeIcon, FileIcon, SearchIcon } from "@/components/ui/icons";

const PAGE_SIZE = 50;

const VALIDITY_OPTIONS = [
  { value: "expired", label: "Verlopen" },
  { value: "expiring", label: "Verloopt binnen 30 dagen" },
  { value: "valid", label: "Geldig" },
  { value: "none", label: "Zonder vervaldatum" }
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function DocumentsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = useState(() => ({
    q: searchParams.get("q") || "",
    category: searchParams.get("category") || "",
    visibility: searchParams.get("visibility") || "",
    validity: searchParams.get("validity") || "",
    page: 1
  }));
  const [search, setSearch] = useState(filters.q);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFilters((p) => (p.q === search ? p : { ...p, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ["q", "category", "visibility", "validity"]) if (filters[key]) params.set(key, filters[key]);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters.q, filters.category, filters.visibility, filters.validity, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) });
    for (const key of ["q", "category", "visibility", "validity"]) if (filters[key]) params.set(key, filters[key]);
    api
      .get(`/api/company/documents?${params}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setSelected(new Set());
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, reload]);

  const items = data?.items || [];
  const stats = data?.stats;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const allSelected = items.length > 0 && items.every((d) => selected.has(d.id));
  const filtered = Boolean(filters.q || filters.category || filters.visibility || filters.validity);

  async function setPublic(isPublic) {
    const ids = [...selected];
    const ok = await confirm({
      title: isPublic ? `${ids.length} documenten publiek maken?` : `${ids.length} documenten privé maken?`,
      message: isPublic ? "Ze worden zichtbaar op het openbare paspoort van gepubliceerde producten." : "Ze verdwijnen van het openbare paspoort.",
      confirmLabel: isPublic ? "Publiek maken" : "Privé maken"
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.post("/api/company/documents/bulk", { ids, isPublic });
      toast.success(`${result.affected} documenten bijgewerkt`);
      setReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openUrl(doc) {
    return doc.blob_name ? `/api/products/${doc.product_id}/documents/${doc.id}/file` : doc.storage_url;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documenten"
        description="Alle handleidingen, certificaten en verklaringen van je producten. Documenten voeg je toe op de productpagina; hier houd je overzicht en geldigheid in de gaten."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard loading={!stats} label="Documenten" value={stats && formatNumber(stats.total)} icon={FileIcon} trend={stats && { text: `${formatNumber(stats.public)} openbaar`, tone: "neutral" }} />
        <KpiCard loading={!stats} label="Verlopen" value={stats && formatNumber(stats.expired)} icon={AlertIcon} tone={stats?.expired ? "danger" : "neutral"} />
        <KpiCard loading={!stats} label="Verloopt binnenkort" value={stats && formatNumber(stats.expiring)} icon={AlertIcon} tone={stats?.expiring ? "warning" : "neutral"} />
        <KpiCard loading={!stats} label="Opslag" value={stats && formatFileSize(stats.storageBytes)} icon={FileIcon} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Field label="Zoeken" name="doc-search" type="search" placeholder="Titel, product of SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
          <Select label="Type" name="doc-category" placeholder="Alle types" options={DOCUMENT_CATEGORY_OPTIONS} value={filters.category} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value, page: 1 }))} className="w-full md:w-44" />
          <Select label="Zichtbaarheid" name="doc-visibility" placeholder="Alle" options={[{ value: "public", label: "Openbaar" }, { value: "private", label: "Privé" }]} value={filters.visibility} onChange={(e) => setFilters((p) => ({ ...p, visibility: e.target.value, page: 1 }))} className="w-full md:w-40" />
          <Select label="Geldigheid" name="doc-validity" placeholder="Alle" options={VALIDITY_OPTIONS} value={filters.validity} onChange={(e) => setFilters((p) => ({ ...p, validity: e.target.value, page: 1 }))} className="w-full md:w-52" />
        </div>
      </Card>

      {loadError && <Card className="border-red-200 bg-red-50 text-sm text-red-700">We konden de documenten niet laden: {loadError}</Card>}

      <Card>
        {loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchIcon} title="Geen documenten gevonden" description="Pas je zoekopdracht of filters aan." />
          ) : (
            <EmptyState
              icon={FileIcon}
              title="Nog geen documenten"
              description="Open een product en voeg op het tabblad Documenten een handleiding, certificaat of verklaring toe."
              action={
                <Link href="/company/products" className="text-sm font-medium text-emerald-700 hover:underline">
                  Naar producten
                </Link>
              }
            />
          )
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="w-8 py-2 pr-2">
                      <input type="checkbox" aria-label="Alle documenten op deze pagina selecteren" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)))} className="h-4 w-4" />
                    </th>
                    <th className="py-2 pr-3 font-medium">Titel</th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Taal</th>
                    <th className="py-2 pr-3 font-medium">Geldigheid</th>
                    <th className="py-2 pr-3 font-medium">Zichtbaarheid</th>
                    <th className="py-2 pr-3 font-medium">Toegevoegd</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Acties</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((doc) => {
                    const validity = documentValidity(doc.valid_until);
                    const url = openUrl(doc);
                    return (
                      <tr key={doc.id} className={`border-b border-slate-100 ${selected.has(doc.id) ? "bg-emerald-50/50" : ""}`}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`${doc.title} selecteren`}
                            checked={selected.has(doc.id)}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(doc.id)) next.delete(doc.id);
                                else next.add(doc.id);
                                return next;
                              })
                            }
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <p className="font-medium text-slate-900">{doc.title}</p>
                          <p className="text-xs text-slate-500">{[doc.version && `v${doc.version}`, doc.file_size ? formatFileSize(doc.file_size) : doc.blob_name ? "" : "externe link", doc.uploaded_by_email].filter(Boolean).join(" · ")}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <Link href={`/company/products/${doc.product_id}?tab=documents`} className="font-medium text-emerald-700 hover:underline">
                            {doc.product_name}
                          </Link>
                          {doc.product_sku && <p className="text-xs text-slate-500">{doc.product_sku}</p>}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{documentCategoryLabel(doc.category) || "—"}</td>
                        <td className="py-2 pr-3 uppercase text-slate-600">{doc.language || "—"}</td>
                        <td className="py-2 pr-3">{validity ? <span title={`Geldig tot ${formatDate(doc.valid_until)}`}><Badge variant={validity.variant}>{validity.label}</Badge></span> : <span className="text-slate-400">—</span>}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={doc.is_public ? "success" : "neutral"}>{doc.is_public ? "Openbaar" : "Privé"}</Badge>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{formatDate(doc.created_at)}</td>
                        <td className="py-2 text-right">
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer" title="Openen" aria-label={`${doc.title} openen`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                              {doc.blob_name ? <EyeIcon size={15} /> : <ExternalIcon size={15} />}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
                <span>
                  Pagina {filters.page} van {totalPages} ({formatNumber(data.total)} documenten)
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
          </>
        )}
      </Card>

      <BulkActionBar
        selectedCount={selected.size}
        onClear={() => setSelected(new Set())}
        actions={
          <>
            <BulkButton tone="accent" disabled={busy} onClick={() => setPublic(true)}>
              Publiek maken
            </BulkButton>
            <BulkButton disabled={busy} onClick={() => setPublic(false)}>
              Privé maken
            </BulkButton>
          </>
        }
      />
    </div>
  );
}

export default function DocumentenPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <DocumentsInner />
    </Suspense>
  );
}
