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
  }, [filters, showCompanyFilter, reloadToken]);

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
  }, [showStats, showCompanyFilter, filters.companyId, reloadToken]);

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
          <EmptyState
            title="Geen producten gevonden"
            description="Pas je zoekopdracht of filters aan om producten te vinden."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
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
