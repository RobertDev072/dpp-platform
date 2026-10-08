"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { downloadPost } from "@/lib/download";
import { MISSING_FILTER_LABELS } from "@/lib/completeness";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import StatusBadge, { QrStatusBadge } from "@/components/ui/StatusBadge";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ProductStats from "@/components/products/ProductStats";
import IncompleteDocsBanner from "@/components/products/IncompleteDocsBanner";
import CompletenessBar from "@/components/products/CompletenessBar";
import PrintExportDialog from "@/components/print/PrintExportDialog";
import { COMPLETENESS_ITEMS } from "@/lib/completeness";
import {
  ArchiveIcon,
  BoxIcon,
  CheckIcon,
  DownloadIcon,
  EditIcon,
  LayersIcon,
  PrinterIcon,
  QrIcon,
  SearchIcon
} from "@/components/ui/icons";

const PAGE_SIZE = 25;
const DEFAULT_SORT = "created_at";
const DEFAULT_ORDER = "desc";

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Concept" },
  { value: "published", label: "Gepubliceerd" },
  { value: "archived", label: "Gearchiveerd" }
];

const DOC_FILTER_OPTIONS = [
  { value: "compleet", label: "Compleet" },
  { value: "incompleet", label: "Incompleet" }
];

const QR_FILTER_OPTIONS = [
  { value: "active", label: "Actief" },
  { value: "reserved", label: "Gereserveerd" },
  { value: "none", label: "Geen QR" }
];

const MISSING_FILTER_OPTIONS = Object.entries(MISSING_FILTER_LABELS).map(([value, label]) => ({ value, label: `Producten ${label}` }));

// Sorteerkeuzes in de werkbalk; spiegelen de sorteerbare kolomkoppen.
const SORT_SELECT_OPTIONS = [
  { value: "name:asc", label: "Naam A-Z" },
  { value: "name:desc", label: "Naam Z-A" },
  { value: "created_at:desc", label: "Laatst toegevoegd" },
  { value: "updated_at:desc", label: "Laatst gewijzigd" },
  { value: "status:asc", label: "Status" }
];

const NAME_COLUMNS = [
  { field: "name", label: "Naam" },
  { field: "category", label: "Categorie" },
  { field: "status", label: "Status" }
];

const CREATED_COLUMN = { field: "created_at", label: "Aangemaakt" };
const FILTER_KEYS = ["q", "status", "category", "doc", "missing", "qr"];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

function SortableHeader({ column, sort, order, onSort }) {
  const active = sort === column.field;
  return (
    <th className="py-2 pr-3" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(column.field)}
        aria-label={`Sorteer op ${column.label}`}
        className={`inline-flex items-center gap-1 font-medium hover:text-slate-800 ${active ? "text-slate-800" : "text-slate-500"}`}
      >
        {column.label}
        <span aria-hidden="true" className="text-xs">
          {active ? (order === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}

// Klikbare compleetheid: toont per criterium wat al ingevuld is en wat nog ontbreekt.
function CompletenessPopover({ product, readOnly }) {
  const [open, setOpen] = useState(false);
  const checks = product.checks || {};
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Klik om te zien wat er nog ontbreekt"
        aria-expanded={open}
        className="block w-full cursor-pointer rounded-lg p-1 text-left transition-colors hover:bg-slate-100"
      >
        <CompletenessBar value={product.completeness} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Paspoort-compleetheid</p>
            <ul className="space-y-1.5 text-sm">
              {COMPLETENESS_ITEMS.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span className={checks[item.key] ? "text-emerald-600" : "text-amber-500"} aria-hidden="true">
                    {checks[item.key] ? "✓" : "!"}
                  </span>
                  {readOnly || checks[item.key] ? (
                    <span className={checks[item.key] ? "text-slate-600" : "font-medium text-slate-900"}>{item.label}</span>
                  ) : (
                    <Link href={`/company/products/${product.id}?tab=${item.tab}`} className="font-medium text-slate-900 hover:text-emerald-700">
                      {item.label}
                    </Link>
                  )}
                  {!checks[item.key] && <span className="ml-auto text-xs text-amber-600">ontbreekt</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function PhotoThumb({ product }) {
  // Geüploade foto's staan in privé-opslag en zijn alleen via ons eigen (ingelogde)
  // endpoint bereikbaar; dat endpoint redirect zelf naar photo_url als die is gezet.
  if (product.photo_blob_name || product.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/products/${product.id}/photo`} alt="" loading="lazy" className="h-10 w-10 rounded-lg border border-slate-200 bg-slate-50 object-cover" />
    );
  }
  return (
    <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300">
      <BoxIcon size={16} />
    </div>
  );
}

const ICON_LINK = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

// Snelacties per rij (icoonknoppen met tooltip en aria-label). In readOnly-modus
// (admin-overzicht) alleen de QR-link: er is geen detailroute over bedrijfsgrenzen heen.
function RowActions({ product, readOnly }) {
  const qr = product.public_id ? (
    <a href={`/api/products/${product.id}/qr.png`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="QR-code bekijken" aria-label={`QR-code van ${product.name} bekijken`} className={ICON_LINK}>
      <QrIcon size={16} />
    </a>
  ) : (
    <span title="Nog geen QR-code" aria-label="Nog geen QR-code" className={`${ICON_LINK} cursor-not-allowed opacity-40`}>
      <QrIcon size={16} />
    </span>
  );
  if (readOnly) return qr;
  return (
    <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
      {qr}
      <Link href={`/company/products/${product.id}`} onClick={(e) => e.stopPropagation()} title="Bewerken" aria-label={`${product.name} bewerken`} className={ICON_LINK}>
        <EditIcon size={16} />
      </Link>
    </span>
  );
}

function initialFilters(searchParams) {
  return {
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    category: searchParams.get("category") || "",
    doc: searchParams.get("doc") || "",
    missing: searchParams.get("missing") || "",
    qr: searchParams.get("qr") || "",
    companyId: searchParams.get("companyId") || "",
    sort: searchParams.get("sort") || DEFAULT_SORT,
    order: searchParams.get("order") || DEFAULT_ORDER,
    page: Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  };
}

function ProductsTableInner({ readOnly = false, showCompanyFilter = false, showStats = false, reloadToken = 0 }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const selectable = !readOnly;

  // Initiële filterstand komt uit de URL, zodat een gedeelde link dezelfde weergave opent.
  const [filters, setFilters] = useState(() => initialFilters(searchParams));
  const [searchInput, setSearchInput] = useState(filters.q);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [stats, setStats] = useState(null);
  const [localReload, setLocalReload] = useState(0);
  // Selectie: losse id's, of "alle resultaten van dit filter".
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkBusy, setBulkBusy] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [categoryValue, setCategoryValue] = useState("");
  const [exportFormat, setExportFormat] = useState(null);

  // Zoekveld met 300ms debounce; elke nieuwe zoekterm springt terug naar pagina 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput ? prev : { ...prev, q: searchInput, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Filterstand spiegelen in de URL (replace, geen push: geen history-vervuiling).
  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
    if (showCompanyFilter && filters.companyId) params.set("companyId", filters.companyId);
    if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
    if (filters.order !== DEFAULT_ORDER) params.set("order", filters.order);
    if (filters.page > 1) params.set("page", String(filters.page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router, showCompanyFilter]);

  // Een andere filterstand = een andere set resultaten: selectie wissen.
  const filterKey = FILTER_KEYS.map((k) => filters[k]).join("|") + `|${filters.companyId}`;
  useEffect(() => {
    setSelectedIds(new Set());
    setAllMatching(false);
  }, [filterKey]);

  // Productpagina ophalen — altijd maximaal één pagina, ook bij 10k+ producten.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE), sort: filters.sort, order: filters.order });
    for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
    if (showCompanyFilter && filters.companyId) params.set("companyId", filters.companyId);

    api
      .get(`/api/products?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [filters, showCompanyFilter, reloadToken, localReload]);

  // Categorieën voor het filter; bij een bedrijfsfilter de categorieën van dat bedrijf.
  useEffect(() => {
    const url = showCompanyFilter && filters.companyId ? `/api/products/categories?companyId=${encodeURIComponent(filters.companyId)}` : "/api/products/categories";
    api
      .get(url)
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, [showCompanyFilter, filters.companyId, localReload]);

  useEffect(() => {
    if (!showCompanyFilter) return;
    api
      .get("/api/admin/companies")
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => setCompanies([]));
  }, [showCompanyFilter]);

  // Statistieken voor de KPI-tegels en de waarschuwingsbanner.
  useEffect(() => {
    if (!showStats) return undefined;
    let cancelled = false;
    const url = showCompanyFilter && filters.companyId ? `/api/products/stats?companyId=${encodeURIComponent(filters.companyId)}` : "/api/products/stats";
    api
      .get(url)
      .then((data) => !cancelled && setStats(data))
      .catch(() => !cancelled && setStats(null));
    return () => {
      cancelled = true;
    };
  }, [showStats, showCompanyFilter, filters.companyId, reloadToken, localReload]);

  const categoryOptions = useMemo(() => {
    const list = [...categories];
    if (filters.category && !list.includes(filters.category)) list.unshift(filters.category);
    return list.map((label) => ({ value: label, label }));
  }, [categories, filters.category]);

  const companyOptions = useMemo(() => companies.map((company) => ({ value: String(company.id), label: company.name })), [companies]);

  function handleSort(field) {
    setFilters((prev) => ({ ...prev, sort: field, order: prev.sort === field ? (prev.order === "asc" ? "desc" : "asc") : "asc", page: 1 }));
  }

  function handleFilterChange(name, value) {
    setFilters((prev) => {
      const next = { ...prev, [name]: value, page: 1 };
      if (name === "companyId") next.category = "";
      return next;
    });
  }

  function clearFilters() {
    setSearchInput("");
    setFilters((prev) => ({ ...prev, q: "", status: "", category: "", doc: "", missing: "", qr: "", page: 1 }));
  }

  const activeStat =
    filters.doc === "incompleet" && !filters.status
      ? "actionRequired"
      : filters.status === "published" && !filters.doc
        ? "published"
        : filters.status === "draft" && !filters.doc
          ? "drafts"
          : FILTER_KEYS.every((k) => !filters[k])
            ? "total"
            : null;

  function handleStatSelect(key) {
    const base = { q: "", status: "", category: "", doc: "", missing: "", qr: "", page: 1 };
    if (key === "total") setSearchInput("");
    if (key === "total") setFilters((prev) => ({ ...prev, ...base }));
    else if (key === "published") setFilters((prev) => ({ ...prev, status: "published", doc: "", page: 1 }));
    else if (key === "drafts") setFilters((prev) => ({ ...prev, status: "draft", doc: "", page: 1 }));
    else if (key === "actionRequired") setFilters((prev) => ({ ...prev, status: "", doc: "incompleet", page: 1 }));
  }

  const sortValue = `${filters.sort}:${filters.order}`;
  const sortMatch = SORT_SELECT_OPTIONS.some((option) => option.value === sortValue);

  function handleSortSelect(value) {
    if (!value) return;
    const [sort, order] = value.split(":");
    setFilters((prev) => ({ ...prev, sort, order, page: 1 }));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = items.map((p) => p.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedCount = allMatching ? total : selectedIds.size;
  const activeFilterCount = FILTER_KEYS.filter((k) => filters[k]).length;

  function selection() {
    if (allMatching) {
      const filter = {};
      for (const key of FILTER_KEYS) if (filters[key]) filter[key] = filters[key];
      return { filter };
    }
    return { ids: [...selectedIds] };
  }

  function toggleRow(id) {
    setAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setAllMatching(false);
  }

  async function runBulk(action, extra = {}, { title, message, confirmLabel, tone, success }) {
    const ok = await confirm({ title, message, confirmLabel, tone });
    if (!ok) return;
    setBulkBusy(action);
    try {
      const result = await api.post("/api/products/bulk/actions", { action, selection: selection(), ...extra });
      toast.success(success(result));
      clearSelection();
      setLocalReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkBusy("");
    }
  }

  async function bulkPublish() {
    const ok = await confirm({
      title: `${nl(selectedCount)} producten publiceren?`,
      message: "Alleen complete producten (100%) worden gepubliceerd; incomplete producten worden overgeslagen. Gepubliceerde paspoorten zijn openbaar via hun QR-code.",
      confirmLabel: "Publiceren"
    });
    if (!ok) return;
    setBulkBusy("publish");
    try {
      const result = await api.post("/api/products/bulk/actions", { action: "publish", selection: selection() });
      toast.success(
        result.skipped > 0
          ? `${nl(result.affected)} gepubliceerd, ${nl(result.skipped)} overgeslagen (incompleet of al gepubliceerd)`
          : `${nl(result.affected)} producten gepubliceerd`
      );
      clearSelection();
      setLocalReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkBusy("");
    }
  }

  async function bulkExport() {
    setBulkBusy("export");
    try {
      await downloadPost("/api/products/bulk/export", { selection: selection() }, "producten.xlsx");
      toast.success("Export gedownload");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkBusy("");
    }
  }

  function handleRowClick(product) {
    if (readOnly) return;
    router.push(`/company/products/${product.id}`);
  }

  const columnCount = 7 + (selectable ? 1 : 0) + 1;

  return (
    <div className="space-y-4">
      {showStats && <ProductStats stats={stats} active={activeStat} onSelect={handleStatSelect} />}

      {showStats && stats?.actionRequired > 0 && (
        <IncompleteDocsBanner key={filters.companyId || "all"} count={stats.actionRequired} onView={() => handleStatSelect("actionRequired")} />
      )}

      <Card className="sticky top-0 z-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <Field
            label="Zoeken"
            name="products-search"
            type="search"
            placeholder="Zoek op naam, SKU, GTIN of merk..."
            autoComplete="off"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="min-w-0 flex-1 lg:min-w-56"
          />
          <Select label="Status" name="products-status" placeholder="Alle statussen" options={STATUS_FILTER_OPTIONS} value={filters.status} onChange={(e) => handleFilterChange("status", e.target.value)} className="w-full lg:w-40" />
          <Select label="Categorie" name="products-category" placeholder="Alle categorieën" options={categoryOptions} value={filters.category} onChange={(e) => handleFilterChange("category", e.target.value)} className="w-full lg:w-44" />
          <Select label="Compleetheid" name="products-doc" placeholder="Alle" options={DOC_FILTER_OPTIONS} value={filters.doc} onChange={(e) => handleFilterChange("doc", e.target.value)} className="w-full lg:w-36" />
          <Select label="QR-code" name="products-qr" placeholder="Alle" options={QR_FILTER_OPTIONS} value={filters.qr} onChange={(e) => handleFilterChange("qr", e.target.value)} className="w-full lg:w-36" />
          {showCompanyFilter && (
            <Select label="Bedrijf" name="products-company" placeholder="Alle bedrijven" options={companyOptions} value={filters.companyId} onChange={(e) => handleFilterChange("companyId", e.target.value)} className="w-full lg:w-52" />
          )}
          <Select
            label="Sorteren"
            name="products-sort"
            {...(sortMatch ? {} : { placeholder: "Aangepast" })}
            options={SORT_SELECT_OPTIONS}
            value={sortMatch ? sortValue : ""}
            onChange={(e) => handleSortSelect(e.target.value)}
            className="w-full lg:w-44"
          />
        </div>
        {(filters.missing || activeFilterCount > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {filters.missing && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                {MISSING_FILTER_OPTIONS.find((o) => o.value === filters.missing)?.label || filters.missing}
                <button type="button" onClick={() => handleFilterChange("missing", "")} aria-label="Filter verwijderen" className="ml-0.5 rounded-full px-1 hover:bg-amber-100">
                  ×
                </button>
              </span>
            )}
            <span className="text-slate-500">{loading ? "…" : `${nl(total)} ${total === 1 ? "resultaat" : "resultaten"}`}</span>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="font-medium text-emerald-700 hover:underline">
                Filters wissen
              </button>
            )}
          </div>
        )}
      </Card>

      {loadError && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-red-200 bg-red-50 text-sm text-red-700">
          <span>We konden de producten niet laden: {loadError}</span>
          <Button variant="outline" size="sm" onClick={() => setLocalReload((v) => v + 1)}>
            Opnieuw proberen
          </Button>
        </Card>
      )}

      {selectable && allOnPageSelected && !allMatching && total > items.length && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900">
          Alle {nl(items.length)} producten op deze pagina zijn geselecteerd.{" "}
          <button type="button" onClick={() => setAllMatching(true)} className="font-semibold underline">
            Selecteer alle {nl(total)} resultaten
          </button>
        </div>
      )}
      {selectable && allMatching && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900">
          Alle {nl(total)} resultaten zijn geselecteerd.{" "}
          <button type="button" onClick={clearSelection} className="font-semibold underline">
            Selectie wissen
          </button>
        </div>
      )}

      <Card>
        {!loading && items.length === 0 ? (
          activeFilterCount > 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="Geen producten gevonden"
              description="Pas je zoekopdracht of filters aan om producten te vinden."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Filters wissen
                </Button>
              }
            />
          ) : (
            <EmptyState icon={BoxIcon} title="Nog geen producten" description={readOnly ? "Er zijn nog geen producten." : "Maak je eerste product aan of importeer je catalogus vanuit Excel."} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {selectable && (
                    <th className="w-8 py-2 pr-2">
                      <input type="checkbox" aria-label="Alle producten op deze pagina selecteren" checked={allOnPageSelected} onChange={togglePage} disabled={!items.length} className="h-4 w-4 rounded border-slate-300" />
                    </th>
                  )}
                  <th className="w-14 py-2 pr-3">
                    <span className="sr-only">Foto</span>
                  </th>
                  {NAME_COLUMNS.map((column) => (
                    <SortableHeader key={column.field} column={column} sort={filters.sort} order={filters.order} onSort={handleSort} />
                  ))}
                  <th className="py-2 pr-3 font-medium">QR</th>
                  <th className="py-2 pr-3 font-medium">Compleetheid</th>
                  <SortableHeader column={CREATED_COLUMN} sort={filters.sort} order={filters.order} onSort={handleSort} />
                  <th className="py-2 font-medium">
                    <span className="sr-only">Acties</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-slate-100">
                        {Array.from({ length: columnCount }).map((__, cell) => (
                          <td key={cell} className="py-2.5 pr-3">
                            <Skeleton className={cell === (selectable ? 1 : 0) ? "h-10 w-10" : "h-5 w-full max-w-40"} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : items.map((product) => {
                      const selected = allMatching || selectedIds.has(product.id);
                      return (
                        <tr
                          key={product.id}
                          onClick={() => handleRowClick(product)}
                          className={`border-b border-slate-100 ${selected ? "bg-emerald-50/50" : ""} ${readOnly ? "" : "cursor-pointer transition-colors hover:bg-slate-50"}`}
                        >
                          {selectable && (
                            <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`${product.name} selecteren`} checked={selected} onChange={() => toggleRow(product.id)} className="h-4 w-4 rounded border-slate-300" />
                            </td>
                          )}
                          <td className="py-2.5 pr-3">
                            <PhotoThumb product={product} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <p className="font-medium text-slate-900">{product.name}</p>
                            {(product.brand || product.sku) && <p className="text-xs text-slate-500">{[product.brand, product.sku].filter(Boolean).join(" · ")}</p>}
                          </td>
                          <td className="py-2.5 pr-3 text-slate-600">{product.category_label || <span className="text-slate-400">—</span>}</td>
                          <td className="py-2.5 pr-3">
                            <StatusBadge status={product.status} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <QrStatusBadge status={product.qr_status} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <CompletenessPopover product={product} readOnly={readOnly} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <p className="whitespace-nowrap text-slate-600">{formatDate(product.created_at)}</p>
                            {product.created_by_email && <p className="text-xs text-slate-500">door {product.created_by_email}</p>}
                          </td>
                          <td className="py-2.5">
                            <RowActions product={product} readOnly={readOnly} />
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-500">
              Pagina {filters.page} van {totalPages} ({nl(total)} {total === 1 ? "product" : "producten"})
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}>
                Vorige
              </Button>
              <Button variant="outline" disabled={filters.page >= totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}>
                Volgende
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selectable && (
        <BulkActionBar
          selectedCount={selectedCount}
          onClear={clearSelection}
          actions={
            <>
              <BulkButton icon={CheckIcon} tone="accent" onClick={bulkPublish} disabled={Boolean(bulkBusy)}>
                Publiceren
              </BulkButton>
              <BulkButton
                icon={QrIcon}
                disabled={Boolean(bulkBusy)}
                onClick={() =>
                  runBulk("generate_qr", {}, {
                    title: `QR-codes aanmaken voor ${nl(selectedCount)} producten?`,
                    message: "Producten zonder QR-code krijgen een permanente QR-code. Die wordt pas actief na publiceren; bestaande codes blijven ongewijzigd.",
                    confirmLabel: "QR-codes aanmaken",
                    success: (r) => `${nl(r.affected)} QR-codes aangemaakt${r.skipped ? `, ${nl(r.skipped)} hadden er al een` : ""}`
                  })
                }
              >
                QR genereren
              </BulkButton>
              <BulkButton icon={PrinterIcon} disabled={Boolean(bulkBusy)} onClick={() => setExportFormat("pdf")}>
                Labels
              </BulkButton>
              <BulkButton icon={DownloadIcon} disabled={Boolean(bulkBusy)} onClick={() => setExportFormat("png")}>
                QR downloaden
              </BulkButton>
              <BulkButton icon={LayersIcon} disabled={Boolean(bulkBusy)} onClick={() => setCategoryDialog(true)}>
                Categorie
              </BulkButton>
              <BulkButton icon={DownloadIcon} disabled={Boolean(bulkBusy)} onClick={bulkExport}>
                {bulkBusy === "export" ? "Exporteren…" : "Exporteren"}
              </BulkButton>
              <BulkButton
                icon={ArchiveIcon}
                tone="danger"
                disabled={Boolean(bulkBusy)}
                onClick={() =>
                  runBulk("archive", {}, {
                    title: `${nl(selectedCount)} producten archiveren?`,
                    message: "Gearchiveerde producten verdwijnen uit je actieve lijst en tellen niet meer mee voor je limiet. Gedrukte QR-codes blijven werken. Productdata wordt niet verwijderd.",
                    confirmLabel: "Archiveren",
                    tone: "danger",
                    success: (r) => `${nl(r.affected)} producten gearchiveerd`
                  })
                }
              >
                Archiveren
              </BulkButton>
            </>
          }
        />
      )}

      <Modal
        open={categoryDialog}
        onClose={() => setCategoryDialog(false)}
        title="Categorie wijzigen"
        description={`Voor ${nl(selectedCount)} geselecteerde producten`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCategoryDialog(false)}>
              Annuleren
            </Button>
            <Button
              variant="accent"
              loading={bulkBusy === "set_category"}
              onClick={async () => {
                setBulkBusy("set_category");
                try {
                  const result = await api.post("/api/products/bulk/actions", { action: "set_category", selection: selection(), category: categoryValue.trim() });
                  toast.success(`Categorie aangepast voor ${nl(result.affected)} producten`);
                  setCategoryDialog(false);
                  setCategoryValue("");
                  clearSelection();
                  setLocalReload((v) => v + 1);
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setBulkBusy("");
                }
              }}
            >
              Toepassen
            </Button>
          </>
        }
      >
        <Field label="Categorie" name="bulk-category" list="bulk-category-options" placeholder="Leeg laten om de categorie te wissen" value={categoryValue} maxLength={100} onChange={(e) => setCategoryValue(e.target.value)} />
        <datalist id="bulk-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Modal>

      {exportFormat && (
        <PrintExportDialog
          open
          initialFormat={exportFormat}
          onClose={() => setExportFormat(null)}
          selection={selection()}
          count={selectedCount}
          onDone={() => setLocalReload((v) => v + 1)}
        />
      )}
    </div>
  );
}

// useSearchParams vereist een Suspense-grens; de fallback spiegelt de tabelopbouw.
export default function ProductsTable(props) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Card>
            <Skeleton className="h-16 w-full" />
          </Card>
          <Card>
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </Card>
        </div>
      }
    >
      <ProductsTableInner {...props} />
    </Suspense>
  );
}
