"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { USER_STATUS_BADGE_VARIANTS, statusLabel } from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import AdminStatTile from "@/components/admin/AdminStatTile";
import ListPagination from "@/components/admin/ListPagination";
import { downloadCsv, formatRelativeTime, initialsOf } from "@/components/admin/listUtils";

const PAGE_SIZE = 25;

// Lifecycle-acties per bedrijf; "Archiveren" vraagt eerst om bevestiging.
const LIFECYCLE_ACTIONS = [
  { status: "blocked", label: "Blokkeren" },
  { status: "suspended", label: "Opschorten" },
  { status: "archived", label: "Archiveren", confirm: true }
];

const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Actief" },
  { value: "blocked", label: "Geblokkeerd" },
  { value: "suspended", label: "Opgeschort" },
  { value: "archived", label: "Gearchiveerd" }
];

const SORT_OPTIONS = [
  { value: "name", label: "Naam" },
  { value: "last_activity", label: "Laatst actief" },
  { value: "product_count", label: "Meeste producten" }
];

function compareCompanies(a, b, sortBy) {
  if (sortBy === "last_activity") {
    // Recentst actieve bedrijven eerst; bedrijven zonder activiteit onderaan.
    const timeA = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const timeB = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return timeB - timeA;
  }
  if (sortBy === "product_count") {
    return (b.product_count ?? 0) - (a.product_count ?? 0);
  }
  return (a.name || "").localeCompare(b.name || "", "nl");
}

function CompanyLogo({ company }) {
  if (company.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={company.logo}
        alt=""
        loading="lazy"
        className="h-10 w-10 rounded-lg border border-slate-200 bg-slate-50 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-sm font-semibold text-blue-700"
    >
      {initialsOf(company.name)}
    </div>
  );
}

export default function CompaniesPage() {
  const toast = useToast();

  const [companies, setCompanies] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [page, setPage] = useState(1);
  // Id van het bedrijf waarvan het abonnement inline bewerkt wordt (badge → select).
  const [planEditId, setPlanEditId] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/api/admin/plans"), api.get("/api/admin/companies")])
      .then(([planData, companyData]) => {
        setPlans(planData);
        setCompanies(companyData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Elke filter- of sorteerwijziging springt terug naar pagina 1.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sortBy]);

  const plansById = useMemo(() => Object.fromEntries(plans.map((plan) => [plan.id, plan])), [plans]);

  function planNameOf(company) {
    if (company.plan_id == null) {
      return "";
    }
    return plansById[company.plan_id]?.name || company.plan_name || `Plan #${company.plan_id}`;
  }

  const stats = useMemo(() => {
    const total = companies.length;
    const active = companies.filter((c) => c.status === "active").length;
    const paused = companies.filter((c) => c.status === "blocked" || c.status === "suspended").length;
    const archived = companies.filter((c) => c.status === "archived").length;
    return {
      total,
      active,
      paused,
      archived,
      activePct: total ? Math.round((active / total) * 100) : 0
    };
  }, [companies]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = companies;
    if (term) {
      list = list.filter((company) =>
        [company.name, company.slug, company.admin_email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }
    if (statusFilter) {
      list = list.filter((company) => company.status === statusFilter);
    }
    return [...list].sort((a, b) => compareCompanies(a, b, sortBy));
  }, [companies, search, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(search.trim() || statusFilter);

  async function handlePlanChange(company, value) {
    const planIdValue = value ? Number(value) : null;
    const previous = companies;
    // Optimistisch bijwerken: de select reageert meteen, de PATCH volgt op de achtergrond.
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, plan_id: planIdValue } : c)));
    try {
      await api.patch(`/api/admin/companies/${company.id}`, { planId: planIdValue });
    } catch (err) {
      setCompanies(previous);
      toast.error(err.message);
    }
  }

  async function handleLifecycle(company, status) {
    if (status === "archived") {
      const sure = window.confirm(
        `Weet je zeker dat je ${company.name} wilt archiveren? Gebruikers kunnen dan niet meer ` +
          "inloggen; bestaande QR-codes blijven een nette statuspagina tonen."
      );
      if (!sure) return;
    }
    try {
      const updated = await api.patch(`/api/admin/companies/${company.id}`, { status });
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, ...(updated || {}), status } : c))
      );
      toast.success(`${company.name} is nu ${statusLabel(status).toLowerCase()}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  // CSV van de huidige (gefilterde en gesorteerde) lijst.
  function handleExport() {
    downloadCsv(
      "veripasso-bedrijven.csv",
      ["Naam", "Slug", "Beheerder", "Plan", "Producten", "Gebruikers", "Status", "Laatst actief"],
      filtered.map((company) => [
        company.name,
        company.slug,
        company.admin_email || "",
        planNameOf(company),
        company.product_count ?? 0,
        company.active_user_count ?? 0,
        statusLabel(company.status),
        company.last_activity ? new Date(company.last_activity).toLocaleString("nl-NL") : ""
      ])
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bedrijven</h1>
          <p className="mt-1 text-sm text-slate-500">
            Beheer organisaties, abonnementen en platformgebruik.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            disabled={loading || filtered.length === 0}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            Exporteren
          </Button>
          <Link
            href="/admin/companies/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Nieuw bedrijf
          </Link>
        </div>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <Skeleton className="h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <AdminStatTile label="Totaal bedrijven" value={stats.total} />
          <AdminStatTile
            label="Actief"
            value={stats.active}
            sub={`${stats.activePct}% van totaal`}
            tone="success"
          />
          <AdminStatTile label="Geblokkeerd/Opgeschort" value={stats.paused} tone="warning" />
          <AdminStatTile label="Gearchiveerd" value={stats.archived} tone="neutral" />
        </div>
      )}

      <Card className="sticky top-0 z-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Field
            label="Zoeken"
            name="companies-search"
            type="search"
            placeholder="Zoek op naam, slug of beheerder..."
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Select
            label="Status"
            name="companies-status"
            placeholder="Alle statussen"
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full lg:w-48"
          />
          <Select
            label="Sorteren op"
            name="companies-sort"
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full lg:w-52"
          />
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilters ? "Geen bedrijven gevonden" : "Nog geen bedrijven"}
            description={
              hasFilters
                ? "Pas je zoekopdracht of filters aan."
                : "Maak het eerste bedrijf aan via de knop Nieuw bedrijf."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Bedrijf</th>
                    <th className="py-2 pr-3 font-medium">Beheerder</th>
                    <th className="py-2 pr-3 font-medium">Abonnement</th>
                    <th className="py-2 pr-3 font-medium">Producten</th>
                    <th className="py-2 pr-3 font-medium">Gebruikers</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Laatst actief</th>
                    <th className="py-2 pr-3 font-medium">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((company) => (
                    <tr key={company.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-3">
                          <CompanyLogo company={company} />
                          <div>
                            <p className="font-medium text-slate-900">{company.name}</p>
                            <p className="text-xs text-slate-500">{company.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {company.admin_email ? (
                          <span className="text-slate-600">{company.admin_email}</span>
                        ) : (
                          <span className="text-xs text-slate-400">Geen beheerder</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {planEditId === company.id ? (
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`Plan van ${company.name}`}
                              value={company.plan_id ?? ""}
                              onChange={(e) => {
                                handlePlanChange(company, e.target.value);
                                setPlanEditId(null);
                              }}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                            >
                              <option value="">— geen plan —</option>
                              {plans.map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setPlanEditId(null)}
                              className="text-xs font-medium text-slate-500 hover:text-slate-700"
                            >
                              Annuleren
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {company.plan_id != null ? (
                              <Badge variant="info">{planNameOf(company)}</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">Geen plan</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setPlanEditId(company.id)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              Wijzig
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{company.product_count ?? 0}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{company.active_user_count ?? 0}</td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={USER_STATUS_BADGE_VARIANTS[company.status] || "neutral"}>
                          {statusLabel(company.status)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
                        {formatRelativeTime(company.last_activity)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Link
                            href={`/admin/companies/${company.id}/uitnodigen`}
                            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            Admin uitnodigen
                          </Link>
                          {company.status !== "active" && (
                            <button
                              type="button"
                              onClick={() => handleLifecycle(company, "active")}
                              className="font-medium text-emerald-600 hover:text-emerald-700"
                            >
                              Herstellen
                            </button>
                          )}
                          {LIFECYCLE_ACTIONS.filter((action) => action.status !== company.status).map(
                            (action) => (
                              <button
                                key={action.status}
                                type="button"
                                onClick={() => handleLifecycle(company, action.status)}
                                className={`font-medium ${
                                  action.status === "archived"
                                    ? "text-red-600 hover:text-red-700"
                                    : "text-slate-600 hover:text-slate-800"
                                }`}
                              >
                                {action.label}
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={filtered.length}
              singular="bedrijf"
              plural="bedrijven"
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
