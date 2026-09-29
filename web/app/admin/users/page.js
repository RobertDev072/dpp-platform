"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  USER_STATUS_BADGE_VARIANTS,
  USER_STATUS_OPTIONS,
  fullName,
  roleLabel,
  statusLabel
} from "@/lib/labels";
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

const ROLE_FILTER_OPTIONS = [
  { value: "platform_owner", label: "Platform Owner" },
  { value: "company_admin", label: "Company Admin" },
  { value: "company_user", label: "Productmedewerker" }
];

// "Verwijderd" hoort wel in het filter, maar niet in de wijzig-dropdown.
const STATUS_FILTER_OPTIONS = [...USER_STATUS_OPTIONS, { value: "deleted", label: "Verwijderd" }];

// auth_provider van de backend: 'entra' of 'local'. Bewust "Verificatie" genoemd, niet "MFA".
const PROVIDER_FILTER_OPTIONS = [
  { value: "entra", label: "Entra" },
  { value: "local", label: "Lokaal" }
];

function providerOf(user) {
  return user.auth_provider === "entra" ? "entra" : "local";
}

function RoleBadge({ role }) {
  if (role === "platform_owner") {
    // Paars valt buiten de standaard Badge-varianten: de eigenaar is uniek op het platform.
    return (
      <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
        Platform Owner
      </span>
    );
  }
  return <Badge variant={role === "company_admin" ? "info" : "neutral"}>{roleLabel(role)}</Badge>;
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="8.5" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function UsersPage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [page, setPage] = useState(1);

  // Rij die het beheerpaneel (rol/status/verwijderen) uitgeklapt heeft.
  const [expandedId, setExpandedId] = useState(null);
  // Tijdelijk wachtwoord na reset: éénmalig getoond in een rij-uitklap onder de gebruiker.
  const [resetInfo, setResetInfo] = useState(null);

  const companiesById = useMemo(
    () => Object.fromEntries(companies.map((company) => [company.id, company])),
    [companies]
  );

  useEffect(() => {
    Promise.all([api.get("/api/admin/companies"), api.get("/api/users")])
      .then(([companyData, userData]) => {
        setCompanies(companyData);
        setUsers(userData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Elke filterwijziging springt terug naar pagina 1.
  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter, companyFilter, providerFilter]);

  function companyName(user) {
    if (user.company_name) {
      return user.company_name;
    }
    if (user.company_id == null) {
      return "";
    }
    return companiesById[user.company_id]?.name || `#${user.company_id}`;
  }

  const stats = useMemo(
    () => ({
      // Verwijderde accounts blijven bewust in de lijst zichtbaar (audit-historie),
      // maar tellen niet mee als "gebruikers".
      total: users.filter((u) => u.status !== "deleted").length,
      admins: users.filter((u) => u.role === "company_admin" && u.status !== "deleted").length,
      members: users.filter((u) => u.role === "company_user" && u.status !== "deleted").length,
      blocked: users.filter((u) => u.status === "blocked").length
    }),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (term) {
        const haystack = [user.email, fullName(user), companyName(user)].join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (roleFilter && user.role !== roleFilter) return false;
      if (statusFilter && user.status !== statusFilter) return false;
      if (companyFilter && String(user.company_id ?? "") !== companyFilter) return false;
      if (providerFilter && providerOf(user) !== providerFilter) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, search, roleFilter, statusFilter, companyFilter, providerFilter, companiesById]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(
    search.trim() || roleFilter || statusFilter || companyFilter || providerFilter
  );

  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: String(company.id), label: company.name })),
    [companies]
  );

  async function patchUser(user, body) {
    const previous = users;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...body } : u)));
    try {
      const updated = await api.patch(`/api/users/${user.id}`, body);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
    } catch (err) {
      setUsers(previous);
      // O.a. 409 LAST_COMPANY_ADMIN: de server legt in het Nederlands uit waarom het niet mag.
      toast.error(err.message);
    }
  }

  async function handleDelete(user) {
    const sure = window.confirm(
      `Weet je zeker dat je ${user.email} wilt verwijderen? Dit verwijdert ook het account in ` +
        "Microsoft Entra en kan niet ongedaan gemaakt worden."
    );
    if (!sure) return;
    await patchUser(user, { status: "deleted" });
  }

  async function handleResetPassword(user) {
    try {
      const result = await api.post(`/api/users/${user.id}/reset-password`);
      if (result?.selfService) {
        // Entra-accounts: geen tijdelijk wachtwoord, de gebruiker reset zelf via
        // "Wachtwoord vergeten". Toon de uitleg van de server als info-melding.
        setResetInfo({
          userId: user.id,
          email: user.email,
          message:
            result.message ||
            `${user.email} moet het wachtwoord zelf opnieuw instellen via "Wachtwoord vergeten" op de inlogpagina.`
        });
      } else if (result?.tempPassword) {
        setResetInfo({ userId: user.id, email: user.email, tempPassword: result.tempPassword });
      } else {
        toast.error("Onverwacht antwoord van de server bij het resetten van het wachtwoord");
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleCopyPassword() {
    try {
      await navigator.clipboard.writeText(resetInfo.tempPassword);
      toast.success("Wachtwoord gekopieerd naar het klembord");
    } catch {
      toast.error("Kopiëren mislukt — selecteer het wachtwoord en kopieer handmatig");
    }
  }

  async function handleImpersonate(user) {
    const sure = window.confirm(
      `Je logt in als ${user.email}. Alle acties worden vastgelegd in het auditlog.`
    );
    if (!sure) return;
    try {
      await api.post(`/api/admin/impersonate/${user.id}`);
      window.location.href = "/company";
    } catch (err) {
      toast.error(err.message);
    }
  }

  // CSV van de huidige (gefilterde) lijst.
  function handleExport() {
    downloadCsv(
      "veripasso-gebruikers.csv",
      ["Naam", "E-mail", "Bedrijf", "Rol", "Verificatie", "Status", "Laatst actief"],
      filteredUsers.map((user) => [
        fullName(user),
        user.email,
        companyName(user),
        roleLabel(user.role),
        providerOf(user) === "entra" ? "Entra" : "Lokaal",
        statusLabel(user.status),
        user.last_activity ? new Date(user.last_activity).toLocaleString("nl-NL") : ""
      ])
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Gebruikers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Beheer platformtoegang, rollen en accountbeveiliging.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleExport}
          disabled={loading || filteredUsers.length === 0}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        >
          Exporteren
        </Button>
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
          <AdminStatTile label="Totaal gebruikers" value={stats.total} />
          <AdminStatTile label="Company admins" value={stats.admins} />
          <AdminStatTile label="Productmedewerkers" value={stats.members} />
          <AdminStatTile label="Geblokkeerd" value={stats.blocked} tone="danger" />
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50 text-blue-800">
        <p className="text-sm">
          Nieuwe gebruikers worden hier niet aangemaakt. Company Admins nodig je uit via de{" "}
          <Link href="/admin/companies" className="font-medium underline hover:no-underline">
            bedrijvenpagina
          </Link>
          ; medewerkers worden aangemaakt door hun eigen Company Admin.
        </p>
      </Card>

      <Card className="sticky top-0 z-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Field
            label="Zoeken"
            name="users-search"
            type="search"
            placeholder="Zoek op naam, e-mail of bedrijf..."
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Select
            label="Rol"
            name="users-role"
            placeholder="Alle rollen"
            options={ROLE_FILTER_OPTIONS}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full lg:w-44"
          />
          <Select
            label="Status"
            name="users-status"
            placeholder="Alle statussen"
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full lg:w-44"
          />
          <Select
            label="Bedrijf"
            name="users-company"
            placeholder="Alle bedrijven"
            options={companyOptions}
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="w-full lg:w-48"
          />
          <Select
            label="Verificatie"
            name="users-provider"
            placeholder="Alle"
            options={PROVIDER_FILTER_OPTIONS}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="w-full lg:w-36"
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
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            title={hasFilters ? "Geen gebruikers gevonden" : "Nog geen gebruikers"}
            description={
              hasFilters
                ? "Pas je zoekopdracht of filters aan."
                : "Zodra bedrijven gebruikers hebben, verschijnen ze hier."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Gebruiker</th>
                    <th className="py-2 pr-3 font-medium">Bedrijf</th>
                    <th className="py-2 pr-3 font-medium">Rol</th>
                    <th className="py-2 pr-3 font-medium">Verificatie</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Laatst actief</th>
                    <th className="py-2 pr-3 font-medium">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((user) => {
                    const isPlatformOwner = user.role === "platform_owner";
                    const isDeleted = user.status === "deleted";
                    const name = fullName(user);
                    const canImpersonate =
                      !isPlatformOwner &&
                      user.status === "active" &&
                      (user.role === "company_admin" || user.role === "company_user");
                    const isExpanded = expandedId === user.id && !isPlatformOwner && !isDeleted;
                    const showReset = resetInfo && resetInfo.userId === user.id;

                    return (
                      <UserRows
                        key={user.id}
                        user={user}
                        name={name}
                        companyLabel={companyName(user)}
                        isPlatformOwner={isPlatformOwner}
                        isDeleted={isDeleted}
                        canImpersonate={canImpersonate}
                        isExpanded={isExpanded}
                        showReset={showReset}
                        resetInfo={resetInfo}
                        onToggleExpand={() =>
                          setExpandedId((prev) => (prev === user.id ? null : user.id))
                        }
                        onImpersonate={() => handleImpersonate(user)}
                        onResetPassword={() => handleResetPassword(user)}
                        onCloseReset={() => setResetInfo(null)}
                        onCopyPassword={handleCopyPassword}
                        onRoleChange={(role) => patchUser(user, { role })}
                        onStatusChange={(status) => patchUser(user, { status })}
                        onDelete={() => handleDelete(user)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={filteredUsers.length}
              singular="gebruiker"
              plural="gebruikers"
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}

// Eén gebruiker = maximaal drie rijen: de datarij, een optionele beheer-uitklap
// (rol/status/verwijderen) en een optionele eenmalige wachtwoord-uitklap.
function UserRows({
  user,
  name,
  companyLabel,
  isPlatformOwner,
  isDeleted,
  canImpersonate,
  isExpanded,
  showReset,
  resetInfo,
  onToggleExpand,
  onImpersonate,
  onResetPassword,
  onCloseReset,
  onCopyPassword,
  onRoleChange,
  onStatusChange,
  onDelete
}) {
  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
            >
              {initialsOf(name || user.email)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{name || user.email}</p>
              {name && <p className="text-xs text-slate-500">{user.email}</p>}
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-slate-600">{companyLabel || "—"}</td>
        <td className="py-2.5 pr-3">
          <RoleBadge role={user.role} />
        </td>
        <td className="py-2.5 pr-3">
          {user.auth_provider === "entra" ? (
            <Badge variant="info">Entra</Badge>
          ) : (
            <Badge variant="neutral">Lokaal</Badge>
          )}
        </td>
        <td className="py-2.5 pr-3">
          <Badge variant={USER_STATUS_BADGE_VARIANTS[user.status] || "neutral"}>
            {statusLabel(user.status)}
          </Badge>
        </td>
        <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
          {formatRelativeTime(user.last_activity, "Nog nooit")}
        </td>
        <td className="py-2.5 pr-3">
          {isPlatformOwner ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <LockIcon />
              Beschermd
            </span>
          ) : isDeleted ? (
            <span className="text-xs text-slate-400">—</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {canImpersonate && (
                <button
                  type="button"
                  onClick={onImpersonate}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Inloggen als
                </button>
              )}
              <button
                type="button"
                onClick={onResetPassword}
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                Reset wachtwoord
              </button>
              <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
                className="font-medium text-slate-600 hover:text-slate-800"
              >
                {isExpanded ? "Sluiten" : "Beheren"}
              </button>
            </div>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Rol"
                name={`user-role-${user.id}`}
                options={ASSIGNABLE_ROLE_OPTIONS}
                value={user.role}
                onChange={(e) => onRoleChange(e.target.value)}
                className="w-full sm:w-56"
              />
              <Select
                label="Status"
                name={`user-status-${user.id}`}
                options={USER_STATUS_OPTIONS}
                value={user.status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full sm:w-56"
              />
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Verwijderen
              </button>
            </div>
          </td>
        </tr>
      )}

      {showReset && resetInfo.tempPassword && (
        <tr className="border-b border-amber-100 bg-amber-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-amber-800">
                Nieuw tijdelijk wachtwoord voor {resetInfo.email} — dit wordt maar één keer
                getoond, deel het zelf veilig met de gebruiker.
              </p>
              <button
                type="button"
                onClick={onCloseReset}
                className="text-xs font-medium text-amber-700 hover:text-amber-900"
              >
                Verbergen
              </button>
            </div>
            <div className="mt-2 flex max-w-md gap-2">
              <input
                readOnly
                aria-label="Tijdelijk wachtwoord"
                value={resetInfo.tempPassword}
                onClick={(e) => e.target.select()}
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900"
              />
              <Button type="button" variant="outline" onClick={onCopyPassword} className="shrink-0 bg-white">
                Kopiëren
              </Button>
            </div>
          </td>
        </tr>
      )}

      {showReset && !resetInfo.tempPassword && (
        <tr className="border-b border-blue-100 bg-blue-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-blue-800">{resetInfo.message}</p>
              <button
                type="button"
                onClick={onCloseReset}
                className="text-xs font-medium text-blue-700 hover:text-blue-900"
              >
                Verbergen
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
