"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import ProductStats from "@/components/products/ProductStats";
import IncompleteDocsBanner from "@/components/products/IncompleteDocsBanner";
import CompletenessBar from "@/components/products/CompletenessBar";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ProgressBar from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import { downloadCsv, dateStamp } from "@/lib/download";

const PAGE_SIZE = 25;
const DEFAULT_SORT = "created_at";
const DEFAULT_ORDER = "desc";

const PRODUCT_STATUS_LABELS = {
  draft: "Concept",
  published: "Gepubliceerd",
  archived: "Gearchiveerd"
};

const PRODUCT_STATUS_BADGE_VARIANTS = {
  draft: "neutral",
  published: "success",
  archived: "danger"
};

const STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Concept" },
  { value: "published", label: "Gepubliceerd" },
  { value: "archived", label: "Gearchiveerd" }
];

const DOC_FILTER_OPTIONS = [
  { value: "compleet", label: "Compleet" },
  { value: "incompleet", label: "Incompleet" }
];

// Sorteerkeuzes in de werkbalk; spiegelen de sorteerbare kolomkoppen.
const SORT_SELECT_OPTIONS = [
  { value: "name:asc", label: "Naam A-Z" },
  { value: "name:desc", label: "Naam Z-A" },
  { value: "created_at:desc", label: "Laatst toegevoegd" },
  { value: "status:asc", label: "Status" }
];

const NAME_COLUMNS = [
  { field: "name", label: "Naam" },
  { field: "category", label: "Categorie" },
  { field: "status", label: "Status" }
];

const CREATED_COLUMN = { field: "created_at", label: "Aangemaakt" };

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function SortableHeader({ column, sort, order, onSort }) {
  const active = sort === column.field;
  return (
    <th className="py-2 pr-3">
      <button
        type="button"
        onClick={() => onSort(column.field)}
        aria-label={`Sorteer op ${column.label}`}
        className={`inline-flex items-center gap-1 font-medium hover:text-slate-800 ${
          active ? "text-slate-800" : "text-slate-500"
        }`}
      >
        {column.label}
        <span aria-hidden="true" className="text-xs">
          {active ? (order === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}

const CHECK_LABELS = {
  photo: "Productfoto",
  description: "Omschrijving",
  category: "Categorie",
  sustainability: "Duurzaamheidsgegevens",
  compliance: "Compliancegegevens",
  documents: "Minimaal één document"
};

// Klikbare compleetheid: toont per criterium wat al ingevuld is en wat nog ontbreekt.
function CompletenessPopover({ product }) {
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
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className="absolute left-0 top-full z-20 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Paspoort-compleetheid
            </p>
            <ul className="space-y-1.5 text-sm">
              {Object.entries(CHECK_LABELS).map(([key, label]) => (
                <li key={key} className="flex items-center gap-2">
                  {checks[key] ? (
                    <span className="text-emerald-600" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10.5L8 14.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : (
                    <span className="text-amber-500" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="10" cy="13.5" r="0.9" fill="currentColor" />
                      </svg>
                    </span>
                  )}
                  <span className={checks[key] ? "text-slate-600" : "font-medium text-slate-900"}>{label}</span>
                  {!checks[key] && <span className="ml-auto text-xs text-amber-600">ontbreekt</span>}
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
  // Geüploade foto's staan in blob-opslag en zijn alleen via ons eigen (ingelogde)
  // endpoint bereikbaar; dat endpoint redirect zelf naar photo_url als die is gezet.
  if (product.photo_blob_name || product.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/products/${product.id}/photo`}
        alt=""
        loading="lazy"
        className="h-10 w-10 rounded-lg border border-slate-200 bg-slate-50 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7.5" cy="8" r="1.5" fill="currentColor" />
        <path d="m4 14 4-4 3 3 2.5-2.5L17 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// Klein amber driehoekje naast de statusbadge wanneer documentatie ontbreekt.
function ActionRequiredIcon() {
  return (
    <span title="Documentatie onvolledig" className="text-amber-500">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M10.3 4.3 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M12 9v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.75" r="1.1" fill="currentColor" />
      </svg>
      <span className="sr-only">Documentatie onvolledig</span>
    </span>
  );
}

const ACTION_LINK_CLASSES =
  "rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50";

// Snelacties per rij. In readOnly-modus (admin-overzicht) alleen de QR-link:
// er is geen detailroute over bedrijfsgrenzen heen.
function RowActions({ product, readOnly }) {
  const qrButton = product.public_id ? (
    <a
      href={`/api/products/${product.id}/qr.png`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={ACTION_LINK_CLASSES}
    >
      QR-code
    </a>
  ) : (
    <button
      type="button"
      disabled
      title="na publicatie"
      onClick={(e) => e.stopPropagation()}
      className="cursor-not-allowed rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400"
    >
      QR-code
    </button>
  );

  if (readOnly) {
    return qrButton;
  }

  const detailHref = `/company/products/${product.id}`;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Link href={detailHref} onClick={(e) => e.stopPropagation()} className={ACTION_LINK_CLASSES}>
        Bekijken
      </Link>
      {qrButton}
      <Link
        href={detailHref}
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
      >
        Bewerken
      </Link>
    </span>
  );
}

function ProductsTableInner({
  readOnly = false,
  showCompanyFilter = false,
  showStats = false,
  reloadToken = 0
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initiële filterstand komt uit de URL, zodat een gedeelde link dezelfde weergave opent.
  const [filters, setFilters] = useState(() => ({
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    category: searchParams.get("category") || "",
    doc: searchParams.get("doc") || "",
    companyId: searchParams.get("companyId") || "",
    sort: searchParams.get("sort") || DEFAULT_SORT,
    order: searchParams.get("order") || DEFAULT_ORDER,
    page: Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  }));

  const [searchInput, setSearchInput] = useState(filters.q);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [stats, setStats] = useState(null);

  // Selectie voor bulkacties: losse ids, of "alle resultaten van dit filter".
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [internalReload, setInternalReload] = useState(0);
  const [categoryDialog, setCategoryDialog] = useState(null);
  const selectable = !readOnly;

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
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.doc) params.set("doc", filters.doc);
    if (showCompanyFilter && filters.companyId) params.set("companyId", filters.companyId);
    if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
    if (filters.order !== DEFAULT_ORDER) params.set("order", filters.order);
    if (filters.page > 1) params.set("page", String(filters.page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router, showCompanyFilter]);

  // Productpagina ophalen — altijd maximaal één pagina, ook bij 10k+ producten.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(PAGE_SIZE),
      sort: filters.sort,
      order: filters.order
    });
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.doc) params.set("doc", filters.doc);
    if (showCompanyFilter && filters.companyId) params.set("companyId", filters.companyId);

    api
      .get(`/api/products?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, showCompanyFilter, reloadToken, internalReload]);

  // Ander filter = andere resultaten: selectie wissen (anders zou een bulkactie
  // producten raken die niet meer zichtbaar zijn).
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [filters.q, filters.status, filters.category, filters.doc]);

  // Categorieën voor het filter; bij een bedrijfsfilter de categorieën van dat bedrijf.
  useEffect(() => {
    const url =
      showCompanyFilter && filters.companyId
        ? `/api/products/categories?companyId=${encodeURIComponent(filters.companyId)}`
        : "/api/products/categories";
    api
      .get(url)
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, [showCompanyFilter, filters.companyId]);

  useEffect(() => {
    if (!showCompanyFilter) {
      return;
    }
    api
      .get("/api/admin/companies")
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => setCompanies([]));
  }, [showCompanyFilter]);

  // Statistieken voor de KPI-tegels en de waarschuwingsbanner. Op de adminpagina
  // volgen ze het gekozen bedrijfsfilter; na een nieuw product (reloadToken) verversen ze mee.
  useEffect(() => {
    if (!showStats) {
      return undefined;
    }
    let cancelled = false;
    const url =
      showCompanyFilter && filters.companyId
        ? `/api/products/stats?companyId=${encodeURIComponent(filters.companyId)}`
        : "/api/products/stats";
    api
      .get(url)
      .then((data) => {
        if (!cancelled) {
          setStats(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStats(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showStats, showCompanyFilter, filters.companyId, reloadToken, internalReload]);

  const categoryOptions = useMemo(() => {
    const list = [...categories];
    // Een categorie uit een gedeelde URL blijft zichtbaar, ook als de lijst hem (nog) niet kent.
    if (filters.category && !list.includes(filters.category)) {
      list.unshift(filters.category);
    }
    return list.map((label) => ({ value: label, label }));
  }, [categories, filters.category]);

  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: String(company.id), label: company.name })),
    [companies]
  );

  function handleSort(field) {
    setFilters((prev) => ({
      ...prev,
      sort: field,
      order: prev.sort === field ? (prev.order === "asc" ? "desc" : "asc") : "asc",
      page: 1
    }));
  }

  function handleFilterChange(name, value) {
    setFilters((prev) => {
      const next = { ...prev, [name]: value, page: 1 };
      if (name === "companyId") {
        // Ander bedrijf = andere categorieën, dus dat filter resetten.
        next.category = "";
      }
      return next;
    });
  }

  // Welke KPI-tegel "actief" is, afgeleid van de huidige filterstand.
  const activeStat =
    filters.doc === "incompleet" && !filters.status
      ? "actionRequired"
      : filters.status === "published" && !filters.doc
        ? "published"
        : filters.status === "draft" && !filters.doc
          ? "drafts"
          : !filters.status && !filters.doc && !filters.q && !filters.category
            ? "total"
            : null;

  function handleStatSelect(key) {
    if (key === "total") {
      setSearchInput("");
      setFilters((prev) => ({ ...prev, q: "", status: "", category: "", doc: "", page: 1 }));
    } else if (key === "published") {
      setFilters((prev) => ({ ...prev, status: "published", doc: "", page: 1 }));
    } else if (key === "drafts") {
      setFilters((prev) => ({ ...prev, status: "draft", doc: "", page: 1 }));
    } else if (key === "actionRequired") {
      setFilters((prev) => ({ ...prev, status: "", doc: "incompleet", page: 1 }));
    }
  }

  // Werkbalk-sortering spiegelt de kolomkoppen; alleen bekende combinaties tonen een waarde.
  const sortValue = `${filters.sort}:${filters.order}`;
  const sortMatch = SORT_SELECT_OPTIONS.some((option) => option.value === sortValue);

  function handleSortSelect(value) {
    if (!value) {
      return;
    }
    const [sort, order] = value.split(":");
    setFilters((prev) => ({ ...prev, sort, order, page: 1 }));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageIds = items.map((p) => p.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleOne(id) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  function selectionPayload() {
    if (allMatching) {
      const filter = {};
      for (const key of ["q", "status", "category", "doc"]) if (filters[key]) filter[key] = filters[key];
      return { filter };
    }
    return { ids: [...selected] };
  }

  const selectionCount = allMatching ? total : selected.size;

  async function runBulk(action, extra = {}, labels) {
    setBulkBusy(true);
    try {
      const result = await api.post("/api/products/bulk", { action, ...selectionPayload(), ...extra });
      const skipped = result.skipped ? ` (${result.skipped} overgeslagen${labels.skippedReason ? `: ${labels.skippedReason}` : ""})` : "";
      toast.success(`${result.affected} ${result.affected === 1 ? "product" : "producten"} ${labels.done}${skipped}`);
      clearSelection();
      setInternalReload((n) => n + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function handlePublish() {
    const ok = await confirm({
      title: `${selectionCount} ${selectionCount === 1 ? "product" : "producten"} publiceren?`,
      description:
        "Alleen producten die 100% compleet zijn worden gepubliceerd; de rest wordt overgeslagen. Gepubliceerde producten zijn via hun QR-code openbaar zichtbaar.",
      confirmLabel: "Publiceren"
    });
    if (ok) await runBulk("publish", {}, { done: "gepubliceerd", skippedReason: "incompleet of gearchiveerd" });
  }

  async function handleArchive() {
    const ok = await confirm({
      title: `${selectionCount} ${selectionCount === 1 ? "product" : "producten"} archiveren?`,
      description: "Gearchiveerde producten tellen niet meer mee voor je limiet. Bestaande QR-codes blijven werken en tonen 'gearchiveerd'.",
      confirmLabel: "Archiveren",
      tone: "danger"
    });
    if (ok) await runBulk("archive", {}, { done: "gearchiveerd" });
  }

  async function handleReserveQr() {
    const ok = await confirm({
      title: "QR-codes genereren?",
      description:
        "Producten zonder QR-code krijgen er een, zonder te publiceren. Je kunt de labels dan al printen; wie scant ziet 'nog niet gepubliceerd' tot je publiceert.",
      confirmLabel: "QR-codes genereren"
    });
    if (ok) await runBulk("reserve_qr", {}, { done: "kregen een QR-code" });
  }

  async function handleExport() {
    setBulkBusy(true);
    try {
      const rows = [];
      if (allMatching) {
        const pages = Math.max(1, Math.ceil(total / 100));
        setExportProgress({ value: 0, max: total });
        for (let page = 1; page <= pages; page += 1) {
          const params = new URLSearchParams({ page: String(page), pageSize: "100", sort: filters.sort, order: filters.order });
          for (const key of ["q", "status", "category", "doc"]) if (filters[key]) params.set(key, filters[key]);
          const data = await api.get(`/api/products?${params.toString()}`);
          rows.push(...data.items);
          setExportProgress({ value: rows.length, max: total });
        }
      } else {
        const ids = [...selected];
        for (let i = 0; i < ids.length; i += 500) {
          const data = await api.post("/api/qr/items", { ids: ids.slice(i, i + 500) });
          rows.push(...data.items.map((p) => ({ ...p, completeness: null })));
        }
      }
      downloadCsv(
        `producten-${dateStamp()}.csv`,
        ["id", "product_name", "sku", "gtin", "brand", "manufacturer", "category", "country_of_origin", "status", "completeness_pct", "public_id"],
        rows.map((p) => [p.id, p.name, p.sku, p.gtin, p.brand, p.manufacturer, p.category_label, p.country_of_origin, p.status, p.completeness, p.public_id])
      );
      toast.success(`${rows.length} producten geëxporteerd`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExportProgress(null);
      setBulkBusy(false);
    }
  }

  function handleRowClick(product) {
    if (readOnly) {
      return;
    }
    router.push(`/company/products/${product.id}`);
  }

  return (
    <div className="space-y-4">
      {showStats && <ProductStats stats={stats} active={activeStat} onSelect={handleStatSelect} />}

      {showStats && stats?.actionRequired > 0 && (
        <IncompleteDocsBanner
          key={filters.companyId || "all"}
          count={stats.actionRequired}
          onView={() => handleStatSelect("actionRequired")}
        />
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
          <Select
            label="Status"
            name="products-status"
            placeholder="Alle statussen"
            options={STATUS_FILTER_OPTIONS}
            value={filters.status}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            className="w-full lg:w-44"
          />
          <Select
            label="Categorie"
            name="products-category"
            placeholder="Alle categorieën"
            options={categoryOptions}
            value={filters.category}
            onChange={(e) => handleFilterChange("category", e.target.value)}
            className="w-full lg:w-52"
          />
          <Select
            label="Documentatie"
            name="products-doc"
            placeholder="Alle"
            options={DOC_FILTER_OPTIONS}
            value={filters.doc}
            onChange={(e) => handleFilterChange("doc", e.target.value)}
            className="w-full lg:w-44"
          />
          {showCompanyFilter && (
            <Select
              label="Bedrijf"
              name="products-company"
              placeholder="Alle bedrijven"
              options={companyOptions}
              value={filters.companyId}
              onChange={(e) => handleFilterChange("companyId", e.target.value)}
              className="w-full lg:w-52"
            />
          )}
          <Select
            label="Sorteren"
            name="products-sort"
            {...(sortMatch ? {} : { placeholder: "Aangepast" })}
            options={SORT_SELECT_OPTIONS}
            value={sortMatch ? sortValue : ""}
            onChange={(e) => handleSortSelect(e.target.value)}
            className="w-full lg:w-48"
          />
        </div>
      </Card>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <Card>
        {!loading && items.length === 0 ? (
          filters.q || filters.status || filters.category || filters.doc || readOnly ? (
            <EmptyState
              title="Geen producten gevonden"
              description="Pas je zoekopdracht of filters aan om producten te vinden."
            />
          ) : (
            <EmptyState
              title="Nog geen producten"
              description="Voeg je eerste product toe, of importeer in één keer honderden producten vanuit Excel of CSV."
              action={
                <a href="/company/products?new=1" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                  + Product
                </a>
              }
              secondaryAction={
                <a href="/company/import" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Importeren vanuit Excel
                </a>
              }
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {selectable && (
                    <th className="w-8 py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Alle producten op deze pagina selecteren"
                        title="Alles op deze pagina selecteren"
                        checked={allOnPageSelected || allMatching}
                        onChange={togglePage}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                    </th>
                  )}
                  <th className="w-14 py-2 pr-3">
                    <span className="sr-only">Foto</span>
                  </th>
                  {NAME_COLUMNS.map((column) => (
                    <SortableHeader
                      key={column.field}
                      column={column}
                      sort={filters.sort}
                      order={filters.order}
                      onSort={handleSort}
                    />
                  ))}
                  <th className="py-2 pr-3 font-medium">Compleetheid</th>
                  <SortableHeader
                    column={CREATED_COLUMN}
                    sort={filters.sort}
                    order={filters.order}
                    onSort={handleSort}
                  />
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-slate-100">
                        {selectable && <td />}
                        <td className="py-2.5 pr-3">
                          <Skeleton className="h-10 w-10" />
                        </td>
                        {Array.from({ length: 6 }).map((__, cell) => (
                          <td key={cell} className="py-2.5 pr-3">
                            <Skeleton className="h-5 w-full max-w-40" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : items.map((product) => (
                      <tr
                        key={product.id}
                        onClick={() => handleRowClick(product)}
                        className={`border-b border-slate-100 ${
                          readOnly ? "" : "cursor-pointer transition-colors hover:bg-slate-50"
                        }`}
                      >
                        {selectable && (
                          <td className="py-2.5 pr-2" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`${product.name} selecteren`}
                              checked={allMatching || selected.has(product.id)}
                              onChange={() => toggleOne(product.id)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                          </td>
                        )}
                        <td className="py-2.5 pr-3">
                          <PhotoThumb product={product} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <p className="font-medium text-slate-900">{product.name}</p>
                          {(product.brand || product.sku) && (
                            <p className="text-xs text-slate-500">
                              {[product.brand, product.sku].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600">{product.category_label || "—"}</td>
                        <td className="py-2.5 pr-3">
                          <span className="inline-flex items-center gap-1.5">
                            <Badge variant={PRODUCT_STATUS_BADGE_VARIANTS[product.status] || "neutral"}>
                              {PRODUCT_STATUS_LABELS[product.status] || product.status}
                            </Badge>
                            {product.action_required && product.status !== "archived" && (
                              <ActionRequiredIcon />
                            )}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <CompletenessPopover product={product} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <p className="whitespace-nowrap text-slate-600">{formatDate(product.created_at)}</p>
                          {product.created_by_email && (
                            <p className="text-xs text-slate-500">door {product.created_by_email}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <RowActions product={product} readOnly={readOnly} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}

        {exportProgress && (
          <div className="mt-3">
            <ProgressBar label="Export voorbereiden" value={exportProgress.value} max={exportProgress.max} />
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-500">
              Pagina {filters.page} van {totalPages} ({total} {total === 1 ? "product" : "producten"})
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={filters.page <= 1}
                onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                Vorige
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={filters.page >= totalPages}
                onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                Volgende
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selectable && (
        <BulkActionBar
          count={selected.size}
          total={total}
          allMatching={allMatching}
          onSelectAllMatching={allOnPageSelected ? () => setAllMatching(true) : null}
          onClear={clearSelection}
        >
          <BulkButton tone="primary" disabled={bulkBusy} onClick={handlePublish}>
            Publiceren
          </BulkButton>
          <BulkButton disabled={bulkBusy} onClick={handleReserveQr}>
            QR genereren
          </BulkButton>
          <BulkButton disabled={bulkBusy} onClick={() => setCategoryDialog({ value: "" })}>
            Categorie wijzigen
          </BulkButton>
          <BulkButton disabled={bulkBusy} onClick={handleExport}>
            Exporteren
          </BulkButton>
          <BulkButton tone="danger" disabled={bulkBusy} onClick={handleArchive}>
            Archiveren
          </BulkButton>
        </BulkActionBar>
      )}

      {categoryDialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={() => setCategoryDialog(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={async (event) => {
              event.preventDefault();
              const value = categoryDialog.value.trim();
              setCategoryDialog(null);
              await runBulk("set_category", { category: value || null }, { done: "bijgewerkt" });
            }}
          >
            <h2 id="category-dialog-title" className="text-base font-semibold text-slate-900">
              Categorie wijzigen voor {selectionCount} {selectionCount === 1 ? "product" : "producten"}
            </h2>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Nieuwe categorie
              <input
                autoFocus
                list="bulk-category-options"
                value={categoryDialog.value}
                onChange={(event) => setCategoryDialog({ value: event.target.value })}
                placeholder="Leeg laten = categorie verwijderen"
                maxLength={100}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
              <datalist id="bulk-category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCategoryDialog(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Annuleren
              </button>
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Toepassen
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDialog}
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
