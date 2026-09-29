"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

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

const SORTABLE_COLUMNS = [
  { field: "name", label: "Naam" },
  { field: "category", label: "Categorie" },
  { field: "status", label: "Status" },
  { field: "created_at", label: "Aangemaakt" }
];

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

function PhotoThumb({ product }) {
  if (product.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.photo_url}
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

function QrCell({ product }) {
  if (product.status !== "published" || !product.public_id) {
    return <span className="text-xs text-slate-400">na publicatie</span>;
  }
  const base = `/api/products/${product.id}`;
  const links = [
    { label: "PNG", href: `${base}/qr.png` },
    { label: "SVG", href: `${base}/qr.svg` },
    { label: "PDF", href: `${base}/qr-label.pdf` }
  ];
  return (
    <span className="whitespace-nowrap text-xs">
      {links.map((link, index) => (
        <span key={link.label}>
          {index > 0 && <span className="text-slate-300"> · </span>}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            {link.label}
          </a>
        </span>
      ))}
    </span>
  );
}

function ProductsTableInner({ readOnly = false, showCompanyFilter = false, reloadToken = 0 }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initiële filterstand komt uit de URL, zodat een gedeelde link dezelfde weergave opent.
  const [filters, setFilters] = useState(() => ({
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    category: searchParams.get("category") || "",
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleRowClick(product) {
    if (readOnly) {
      return;
    }
    router.push(`/company/products/${product.id}`);
  }

  return (
    <div className="space-y-4">
      <Card className="sticky top-0 z-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Field
            label="Zoeken"
            name="products-search"
            type="search"
            placeholder="Zoek op naam, SKU, GTIN of merk..."
            autoComplete="off"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Select
            label="Status"
            name="products-status"
            placeholder="Alle statussen"
            options={STATUS_FILTER_OPTIONS}
            value={filters.status}
            onChange={(e) => handleFilterChange("status", e.target.value)}
            className="w-full lg:w-48"
          />
          <Select
            label="Categorie"
            name="products-category"
            placeholder="Alle categorieën"
            options={categoryOptions}
            value={filters.category}
            onChange={(e) => handleFilterChange("category", e.target.value)}
            className="w-full lg:w-56"
          />
          {showCompanyFilter && (
            <Select
              label="Bedrijf"
              name="products-company"
              placeholder="Alle bedrijven"
              options={companyOptions}
              value={filters.companyId}
              onChange={(e) => handleFilterChange("companyId", e.target.value)}
              className="w-full lg:w-56"
            />
          )}
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
                  {SORTABLE_COLUMNS.map((column) => (
                    <SortableHeader
                      key={column.field}
                      column={column}
                      sort={filters.sort}
                      order={filters.order}
                      onSort={handleSort}
                    />
                  ))}
                  <th className="py-2 pr-3 font-medium">QR</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-slate-100">
                        <td className="py-2.5 pr-3">
                          <Skeleton className="h-10 w-10" />
                        </td>
                        {Array.from({ length: 5 }).map((__, cell) => (
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
                          <Badge variant={PRODUCT_STATUS_BADGE_VARIANTS[product.status] || "neutral"}>
                            {PRODUCT_STATUS_LABELS[product.status] || product.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          <p className="whitespace-nowrap text-slate-600">{formatDate(product.created_at)}</p>
                          {product.created_by_email && (
                            <p className="text-xs text-slate-500">door {product.created_by_email}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <QrCell product={product} />
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
