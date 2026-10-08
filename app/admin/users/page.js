"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { homeHrefForRole } from "@/lib/nav";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  PARTNER_ROLE_OPTIONS,
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
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import EmptyState from "@/components/ui/EmptyState";
import IconButton, { CogIcon, KeyIcon, LoginIcon, TrashIcon } from "@/components/ui/IconButton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import AdminStatTile from "@/components/admin/AdminStatTile";
import ListPagination from "@/components/admin/ListPagination";
import { downloadCsv, formatRelativeTime, initialsOf } from "@/components/admin/listUtils";
import BulkActionBar, { BulkButton } from "@/components/ui/BulkActionBar";
import UserSessionsDialog from "@/components/admin/UserSessionsDialog";

const PAGE_SIZE = 25;

const ROLE_FILTER_OPTIONS = [
  { value: "platform_owner", label: "Platform Owner" },
  { value: "partner_admin", label: "Partner Admin" },
  { value: "company_admin", label: "Bedrijfsbeheerder" },
  { value: "company_user", label: "Medewerker" }
];

// Soft-verwijderde accounts komen niet meer terug uit de API, dus geen "Verwijderd"-filter.
const STATUS_FILTER_OPTIONS = USER_STATUS_OPTIONS;

// auth_provider van de backend: 'supabase' of 'local'. Bewust "Verificatie" genoemd, niet "MFA".
const PROVIDER_FILTER_OPTIONS = [
  { value: "supabase", label: "Supabase" },
  { value: "local", label: "Lokaal" }
];

function providerOf(user) {
  return user.auth_provider === "supabase" ? "supabase" : "local";
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
  if (role === "partner_admin") {
    // Violet: hoort visueel bij de paarse Partner-badge op de bedrijvenpagina,
    // maar blijft te onderscheiden van de Platform Owner.
    return (
      <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
        Partner Admin
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rolopties horen bij de bedrijfssoort: in een partnerbedrijf bestaat alleen
// Partner Admin; company-rollen horen exclusief bij klantbedrijven (de backend
// dwingt dit ook af, wij tonen dus nooit een keuze die toch geweigerd wordt).
function roleOptionsForCompany(company) {
  return company?.kind === "partner" ? PARTNER_ROLE_OPTIONS : ASSIGNABLE_ROLE_OPTIONS;
}

// Aanmaakformulier van de Platform Owner: primair bedoeld voor Partner Admins
// (kies een partnerbedrijf), maar werkt ook voor company-rollen op klantbedrijven.
function NewUserForm({ companies, companiesById, onCreated }) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  // Na aanmaken: ofwel een eenmalig tijdelijk wachtwoord (legacy), ofwel de SSPR-instructie.
  const [createdInfo, setCreatedInfo] = useState(null);

  const form = useForm({
    initial: { companyId: "", role: "", email: "", firstName: "", lastName: "" },
    validators: {
      companyId: (value) => (value ? null : "Kies een bedrijf"),
      role: (value) => (value ? null : "Kies een rol"),
      email: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  const selectedCompany = form.values.companyId
    ? companiesById[Number(form.values.companyId)]
    : null;
  const roleOptions = roleOptionsForCompany(selectedCompany);

  function handleCompanyChange(value) {
    form.setValue("companyId", value);
    const company = value ? companiesById[Number(value)] : null;
    const options = roleOptionsForCompany(company);
    // Rol meebewegen met de bedrijfssoort: partnerbedrijf → altijd Partner Admin;
    // klantbedrijf → een eerder gekozen partnerrol vervalt.
    if (!options.some((option) => option.value === form.values.role)) {
      form.setValue("role", company?.kind === "partner" ? "partner_admin" : "");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedInfo(null);

    if (!form.validateAll()) {
      return;
    }

    setCreating(true);
    try {
      const created = await api.post("/api/users", {
        email: form.values.email.trim(),
        firstName: form.values.firstName.trim() || undefined,
        lastName: form.values.lastName.trim() || undefined,
        role: form.values.role,
        companyId: Number(form.values.companyId)
      });

      setCreatedInfo({ email: created.email, tempPassword: created.tempPassword || null });
      form.reset();
      toast.success(`Gebruiker ${created.email} aangemaakt`);
      // Het tijdelijke wachtwoord is eenmalig zichtbaar hierboven en hoort niet
      // in de lijst-state te blijven hangen.
      const { tempPassword: _tempPassword, ...createdUser } = created;
      onCreated(createdUser);
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        if (err.status === 409 && !err.code) {
          // Duplicaat-e-mail komt als kale 409-message terug: onder het e-mailveld tonen.
          form.applyServerErrors({ fieldErrors: { email: [err.message] } });
        } else {
          setFormError(err);
        }
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuwe gebruiker</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormError error={formError} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Bedrijf"
            name="new-user-companyId"
            required
            placeholder="Kies een bedrijf"
            options={companies.map((company) => ({
              value: String(company.id),
              label: company.kind === "partner" ? `${company.name} (partner)` : company.name
            }))}
            value={form.values.companyId}
            onChange={(e) => handleCompanyChange(e.target.value)}
            onBlur={() => form.onBlur("companyId")}
            error={form.errors.companyId}
          />
          <Select
            label="Rol"
            name="new-user-role"
            required
            placeholder="Kies een rol"
            options={roleOptions}
            help={
              selectedCompany?.kind === "partner"
                ? "In een partnerbedrijf is alleen de rol Partner Admin mogelijk."
                : undefined
            }
            value={form.values.role}
            onChange={(e) => form.setValue("role", e.target.value)}
            onBlur={() => form.onBlur("role")}
            error={form.errors.role}
          />
          <Field
            label="E-mail"
            name="new-user-email"
            type="email"
            required
            autoComplete="off"
            placeholder="naam@bedrijf.nl"
            value={form.values.email}
            onChange={(e) => form.setValue("email", e.target.value)}
            onBlur={() => form.onBlur("email")}
            error={form.errors.email}
          />
          <Field
            label="Voornaam"
            name="new-user-firstName"
            autoComplete="off"
            placeholder="Bijv. Anna"
            value={form.values.firstName}
            onChange={(e) => form.setValue("firstName", e.target.value)}
            error={form.errors.firstName}
          />
          <Field
            label="Achternaam"
            name="new-user-lastName"
            autoComplete="off"
            placeholder="Bijv. de Vries"
            value={form.values.lastName}
            onChange={(e) => form.setValue("lastName", e.target.value)}
            error={form.errors.lastName}
          />
        </div>

        <p className="text-xs text-slate-400">
          De nieuwe gebruiker stelt het eigen wachtwoord in via Wachtwoord vergeten op de loginpagina.
        </p>

        <SubmitButton loading={creating}>Aanmaken</SubmitButton>
      </form>

      {createdInfo && !createdInfo.tempPassword && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Laat <span className="font-medium">{createdInfo.email}</span> het wachtwoord instellen via{" "}
          <span className="font-medium">Wachtwoord vergeten</span> op de loginpagina.
        </div>
      )}

      {createdInfo && createdInfo.tempPassword && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Tijdelijk wachtwoord voor {createdInfo.email} (wordt maar één keer getoond, deel dit
            zelf veilig met de gebruiker):
          </p>
          <input
            readOnly
            value={createdInfo.tempPassword}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900"
          />
        </div>
      )}
    </Card>
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
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState("");
  const [sessionsFor, setSessionsFor] = useState(null);

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
    setSelected(new Set());
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
      // Verwijderde accounts komen niet meer terug uit /api/users, dus alles telt mee.
      total: users.length,
      admins: users.filter((u) => u.role === "company_admin").length,
      members: users.filter((u) => u.role === "company_user").length,
      partners: users.filter((u) => u.role === "partner_admin").length,
      owners: users.filter((u) => u.role === "platform_owner").length,
      blocked: users.filter((u) => u.status === "blocked").length,
      online: users.filter((u) => Number(u.active_sessions) > 0).length
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
        "Supabase Auth en kan niet ongedaan gemaakt worden."
    );
    if (!sure) return;
    await patchUser(user, { status: "deleted" });
  }

  async function handleResetPassword(user) {
    try {
      const result = await api.post(`/api/users/${user.id}/reset-password`);
      if (result?.selfService) {
        // Als de server geen tijdelijk wachtwoord geeft maar zelfbediening adviseert:
        // toon de uitleg van de server als info-melding.
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
      // Partner Admins landen in hun eigen partnergebied, company-rollen in /company.
      window.location.href = homeHrefForRole(user.role);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const selectableIds = useMemo(
    () => new Set(filteredUsers.filter((u) => u.role !== "platform_owner").map((u) => u.id)),
    [filteredUsers]
  );
  const pageSelectable = pageItems.filter((u) => selectableIds.has(u.id));
  const allPageSelected = pageSelectable.length > 0 && pageSelectable.every((u) => selected.has(u.id));

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageSelectable.forEach((u) => next.delete(u.id));
      else pageSelectable.forEach((u) => next.add(u.id));
      return next;
    });
  }

  // Bulkwijziging: per gebruiker dezelfde PATCH als bij losse wijzigingen, zodat
  // álle serverregels (laatste beheerder, seat-limiet, partnerrollen) gelden.
  async function runBulk(body, label) {
    const targets = users.filter((u) => selected.has(u.id));
    if (!targets.length) return;
    const sure = window.confirm(`${label} voor ${targets.length} gebruiker${targets.length === 1 ? "" : "s"}?`);
    if (!sure) return;
    setBulkBusy(label);
    let ok = 0;
    const failures = [];
    for (const user of targets) {
      try {
        const updated = await api.patch(`/api/users/${user.id}`, body);
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
        ok += 1;
      } catch (err) {
        failures.push(`${user.email}: ${err.message}`);
      }
    }
    setBulkBusy("");
    setSelected(new Set());
    if (ok) toast.success(`${label}: ${ok} gelukt`);
    if (failures.length) toast.error(`${failures.length} niet gewijzigd — ${failures.slice(0, 2).join("; ")}${failures.length > 2 ? "…" : ""}`);
  }

  function exportSelected() {
    exportRows(users.filter((u) => selected.has(u.id)));
  }

  function exportRows(rows) {
    downloadCsv(
      "veripasso-gebruikers.csv",
      ["Naam", "E-mail", "Bedrijf", "Rol", "Verificatie", "Status", "Laatste login", "Actieve sessies", "Laatst actief"],
      rows.map((user) => [
        fullName(user),
        user.email,
        companyName(user),
        roleLabel(user.role),
        providerOf(user) === "supabase" ? "Supabase" : "Lokaal",
        statusLabel(user.status),
        user.last_login_at ? new Date(user.last_login_at).toLocaleString("nl-NL") : "",
        user.active_sessions ?? 0,
        user.last_activity ? new Date(user.last_activity).toLocaleString("nl-NL") : ""
      ])
    );
  }

  // CSV van de huidige (gefilterde) lijst.
  function handleExport() {
    exportRows(filteredUsers);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Alle gebruikers</h1>
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index}>
              <Skeleton className="h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <AdminStatTile label="Totaal gebruikers" value={stats.total} />
          <AdminStatTile label="Bedrijfsbeheerders" value={stats.admins} />
          <AdminStatTile label="Medewerkers" value={stats.members} />
          <AdminStatTile label="Partner Admins" value={stats.partners} />
          <AdminStatTile label="Platform Owners" value={stats.owners} />
          <AdminStatTile label="Geblokkeerd" value={stats.blocked} tone="danger" />
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50 text-blue-800">
        <p className="text-sm">
          Partner Admins maak je hieronder aan door een partnerbedrijf te kiezen. Bedrijfsbeheerders
          nodig je bij voorkeur uit via de{" "}
          <Link href="/admin/companies" className="font-medium underline hover:no-underline">
            klantbedrijvenpagina
          </Link>
          ; medewerkers worden aangemaakt door hun eigen Bedrijfsbeheerder.
        </p>
      </Card>

      {!loading && (
        <NewUserForm
          companies={companies}
          companiesById={companiesById}
          onCreated={(created) => setUsers((prev) => [created, ...prev])}
        />
      )}

      <Card className="lg:sticky lg:top-0 lg:z-10">
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
                    <th className="w-8 py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={togglePage}
                        disabled={pageSelectable.length === 0}
                        aria-label="Alle gebruikers op deze pagina selecteren"
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                    </th>
                    <th className="py-2 pr-3 font-medium">Gebruiker</th>
                    <th className="py-2 pr-3 font-medium">Bedrijf</th>
                    <th className="py-2 pr-3 font-medium">Rol</th>
                    <th className="py-2 pr-3 font-medium">Verificatie</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Laatste login</th>
                    <th className="py-2 pr-3 font-medium">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((user) => {
                    const isPlatformOwner = user.role === "platform_owner";
                    const name = fullName(user);
                    const canImpersonate =
                      !isPlatformOwner &&
                      user.status === "active" &&
                      (user.role === "company_admin" ||
                        user.role === "company_user" ||
                        user.role === "partner_admin");
                    const isExpanded = expandedId === user.id && !isPlatformOwner;
                    const showReset = resetInfo && resetInfo.userId === user.id;

                    return (
                      <UserRows
                        key={user.id}
                        user={user}
                        name={name}
                        companyLabel={companyName(user)}
                        roleOptions={roleOptionsForCompany(companiesById[user.company_id])}
                        isPlatformOwner={isPlatformOwner}
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
                        selected={selected.has(user.id)}
                        onToggleSelected={() => toggleSelected(user.id)}
                        onShowSessions={() => setSessionsFor(user)}
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

      <BulkActionBar count={selected.size} total={selectableIds.size} onClear={() => setSelected(new Set())}>
        <BulkButton disabled={Boolean(bulkBusy)} onClick={() => runBulk({ status: "active" }, "Activeren")}>
          Activeren
        </BulkButton>
        <BulkButton disabled={Boolean(bulkBusy)} onClick={() => runBulk({ status: "blocked" }, "Blokkeren")}>
          Blokkeren
        </BulkButton>
        <BulkButton disabled={Boolean(bulkBusy)} onClick={() => runBulk({ role: "company_user" }, "Rol → Medewerker")}>
          Rol: Medewerker
        </BulkButton>
        <BulkButton disabled={Boolean(bulkBusy)} onClick={() => runBulk({ role: "company_admin" }, "Rol → Bedrijfsbeheerder")}>
          Rol: Bedrijfsbeheerder
        </BulkButton>
        <BulkButton disabled={Boolean(bulkBusy)} onClick={exportSelected}>
          Exporteren
        </BulkButton>
        <BulkButton tone="danger" disabled={Boolean(bulkBusy)} onClick={() => runBulk({ status: "archived" }, "Archiveren")}>
          Archiveren
        </BulkButton>
      </BulkActionBar>

      {sessionsFor && (
        <UserSessionsDialog
          user={sessionsFor}
          onClose={() => setSessionsFor(null)}
          onRevoked={() => setUsers((prev) => prev.map((u) => (u.id === sessionsFor.id ? { ...u, active_sessions: 0 } : u)))}
        />
      )}
    </div>
  );
}

// Eén gebruiker = maximaal drie rijen: de datarij, een optionele beheer-uitklap
// (rol/status/verwijderen) en een optionele eenmalige wachtwoord-uitklap.
function UserRows({
  user,
  name,
  companyLabel,
  roleOptions,
  isPlatformOwner,
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
  onDelete,
  selected,
  onToggleSelected,
  onShowSessions
}) {
  return (
    <>
      <tr className={`border-b border-slate-100 ${selected ? "bg-emerald-50/50" : ""}`}>
        <td className="py-2.5 pr-2">
          {!isPlatformOwner && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={`Selecteer ${user.email}`}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
          )}
        </td>
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
          {user.auth_provider === "supabase" ? (
            <Badge variant="info">Supabase</Badge>
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
          <span title={user.last_activity ? `Laatst actief: ${new Date(user.last_activity).toLocaleString("nl-NL")}` : undefined}>
            {formatRelativeTime(user.last_login_at, "Nog nooit")}
          </span>
          {Number(user.active_sessions) > 0 && (
            <span className="block text-xs text-emerald-700">
              {user.active_sessions} actieve sessie{Number(user.active_sessions) === 1 ? "" : "s"}
            </span>
          )}
        </td>
        <td className="py-2.5 pr-3">
          {isPlatformOwner ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <LockIcon />
              Beschermd
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {canImpersonate && (
                <IconButton title="Inloggen als" tone="primary" onClick={onImpersonate}>
                  <LoginIcon />
                </IconButton>
              )}
              <IconButton title="Sessies bekijken" onClick={onShowSessions}>
                <SessionsIcon />
              </IconButton>
              <IconButton title="Reset wachtwoord" onClick={onResetPassword}>
                <KeyIcon />
              </IconButton>
              <IconButton
                title={isExpanded ? "Sluiten" : "Beheren"}
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
              >
                <CogIcon />
              </IconButton>
              <IconButton title="Verwijderen" tone="danger" onClick={onDelete}>
                <TrashIcon />
              </IconButton>
            </div>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={8} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Rol"
                name={`user-role-${user.id}`}
                options={roleOptions}
                help={
                  roleOptions === PARTNER_ROLE_OPTIONS
                    ? "In een partnerbedrijf is alleen de rol Partner Admin mogelijk."
                    : undefined
                }
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
            </div>
          </td>
        </tr>
      )}

      {showReset && resetInfo.tempPassword && (
        <tr className="border-b border-amber-100 bg-amber-50">
          <td colSpan={8} className="px-3 py-3">
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
          <td colSpan={8} className="px-3 py-3">
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

function SessionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 16.5h6M10 13.5v3" />
    </svg>
  );
}
