"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { USER_STATUS_BADGE_VARIANTS, USER_STATUS_OPTIONS, fullName, statusLabel } from "@/lib/labels";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import { ChevronRightIcon, SearchIcon, UsersIcon } from "@/components/ui/icons";
import { formatRelativeTime } from "@/components/admin/listUtils";
import OrgDetailPanel from "@/components/admin/org/OrgDetailPanel";
import {
  CompanyStatusBadge,
  InlineError,
  KindBadge,
  Pager,
  RoleBadge,
  RowSkeleton,
  usePagedList
} from "@/components/admin/org/orgUi";

// Organisaties & gebruikers (Platform Owner). Zonder zoekterm of filter: een uitklapbare
// boom Platform → Partners → (Partner Admins, Klantbedrijven → gebruikers), plus de groep
// Zelfstandige klantbedrijven. Elk niveau laadt pas bij uitklappen en is server-side
// gepagineerd. Met zoekterm of filter: één gepagineerde resultatenlijst met het pad
// (partner › bedrijf), zodat ook resultaten diep in de boom direct vindbaar zijn.

const TYPE_OPTIONS = [
  { value: "partner", label: "Partners" },
  { value: "customer", label: "Klantbedrijven" },
  { value: "standalone", label: "Zelfstandige klantbedrijven" },
  { value: "user", label: "Gebruikers" }
];

const ROLE_OPTIONS = [
  { value: "platform_owner", label: "Platform Owner" },
  { value: "partner_admin", label: "Partner Admin" },
  { value: "company_admin", label: "Bedrijfsbeheerder" },
  { value: "company_user", label: "Medewerker" }
];

const PARTNER_SORT_OPTIONS = [
  { value: "name", label: "Naam (A–Z)" },
  { value: "customers", label: "Meeste klantbedrijven" },
  { value: "created", label: "Nieuwste eerst" }
];

const CUSTOMER_SORT_OPTIONS = [
  { value: "name", label: "Naam (A–Z)" },
  { value: "users", label: "Meeste gebruikers" },
  { value: "products", label: "Meeste producten" },
  { value: "activity", label: "Recent actief" },
  { value: "created", label: "Nieuwste eerst" }
];

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Paginering per lijst; terug naar pagina 1 als het aantal per pagina wijzigt.
function usePaging() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  return {
    page,
    pageSize,
    setPage,
    setPageSize: (size) => {
      setPageSize(size);
      setPage(1);
    }
  };
}

function Chevron({ open }) {
  return (
    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>
      <ChevronRightIcon size={14} />
    </span>
  );
}

// Eén rij in de boom: uitklappen (chevron) en selecteren (naam) zijn aparte knoppen,
// zodat toetsenbordgebruikers beide kunnen.
function TreeRow({ depth, open, onToggle, selected, onSelect, title, meta, badges, aside }) {
  return (
    <div
      className={`group flex min-w-0 items-center gap-2 border-b border-slate-100 py-2 pr-3 ${selected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
      style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
    >
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Inklappen" : "Uitklappen"} className="rounded p-0.5 hover:bg-slate-200">
          <Chevron open={open} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-slate-900">{title}</span>
          {badges}
        </span>
        {meta && <span className="mt-0.5 block truncate text-xs text-slate-500">{meta}</span>}
      </button>
      {aside && <span className="hidden shrink-0 text-xs text-slate-400 sm:block">{aside}</span>}
    </div>
  );
}

function GroupLabel({ depth, children }) {
  return (
    <div className="border-b border-slate-100 bg-slate-50/70 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400" style={{ paddingLeft: `${2.25 + depth * 1.25}rem` }}>
      {children}
    </div>
  );
}

function LevelState({ state, depth, emptyText, onRetry }) {
  const pad = { paddingLeft: `${2.25 + depth * 1.25}rem` };
  if (state.loading && !state.data) return <div style={pad}><RowSkeleton rows={2} /></div>;
  if (state.error) return <div className="py-2 pr-3" style={pad}><InlineError message={state.error} onRetry={onRetry} /></div>;
  if (state.data && state.data.total === 0) return <p className="border-b border-slate-100 py-2 pr-3 text-sm text-slate-500" style={pad}>{emptyText}</p>;
  return null;
}

// --- niveau: gebruikers van één bedrijf ------------------------------------------------
function UserList({ companyId, depth, ctx }) {
  const paging = usePaging();
  const [retry, setRetry] = useState(0);
  const state = usePagedList(`/api/admin/org/companies/${companyId}/users`, { page: paging.page, pageSize: paging.pageSize }, ctx.refreshKey + retry);
  return (
    <div>
      <LevelState state={state} depth={depth} emptyText="Nog geen gebruikers." onRetry={() => setRetry((r) => r + 1)} />
      {state.data?.items.map((user) => (
        <TreeRow
          key={user.id}
          depth={depth}
          selected={ctx.isSelected("user", user.id)}
          onSelect={() => ctx.select({ kind: "user", id: user.id })}
          title={fullName(user) || user.email}
          meta={fullName(user) ? user.email : null}
          badges={
            <>
              <RoleBadge role={user.role} />
              {user.status !== "active" && <Badge variant={USER_STATUS_BADGE_VARIANTS[user.status]}>{statusLabel(user.status)}</Badge>}
            </>
          }
          aside={formatRelativeTime(user.last_activity, "nooit actief")}
        />
      ))}
      {state.data && state.data.pages > 1 && (
        <div style={{ paddingLeft: `${1.5 + depth * 1.25}rem` }}>
          <Pager data={state.data} onPage={paging.setPage} onPageSize={paging.setPageSize} singular="gebruiker" plural="gebruikers" name={`pager-users-${companyId}`} />
        </div>
      )}
    </div>
  );
}

// --- niveau: klantbedrijven van een partner of de zelfstandige groep -----------------
function CustomerNode({ customer, depth, ctx }) {
  const [open, setOpen] = useState(false);
  const meta = [
    plural(customer.admin_count, "beheerder", "beheerders"),
    plural(customer.employee_count, "medewerker", "medewerkers"),
    plural(customer.product_count, "product", "producten"),
    customer.plan_name || "geen plan"
  ].join(" · ");
  return (
    <>
      <TreeRow
        depth={depth}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        selected={ctx.isSelected("customer", customer.id)}
        onSelect={() => ctx.select({ kind: "customer", id: customer.id })}
        title={customer.name}
        meta={meta}
        badges={customer.status !== "active" && <CompanyStatusBadge status={customer.status} />}
        aside={customer.last_activity ? `actief ${formatRelativeTime(customer.last_activity)}` : "nog geen activiteit"}
      />
      {open && <UserList companyId={customer.id} depth={depth + 1} ctx={ctx} />}
    </>
  );
}

function CustomerList({ groupId, depth, ctx }) {
  const paging = usePaging();
  const [retry, setRetry] = useState(0);
  const state = usePagedList(
    `/api/admin/org/groups/${groupId}/customers`,
    { page: paging.page, pageSize: paging.pageSize, sort: ctx.customerSort },
    ctx.refreshKey + retry
  );
  useEffect(() => paging.setPage(1), [ctx.customerSort]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <LevelState state={state} depth={depth} emptyText="Nog geen klantbedrijven." onRetry={() => setRetry((r) => r + 1)} />
      {state.data?.items.map((customer) => (
        <CustomerNode key={customer.id} customer={customer} depth={depth} ctx={ctx} />
      ))}
      {state.data && state.data.pages > 1 && (
        <div style={{ paddingLeft: `${1.5 + depth * 1.25}rem` }}>
          <Pager data={state.data} onPage={paging.setPage} onPageSize={paging.setPageSize} singular="klantbedrijf" plural="klantbedrijven" name={`pager-customers-${groupId}`} />
        </div>
      )}
    </div>
  );
}

// --- niveau: partners ---------------------------------------------------------------
function PartnerNode({ partner, ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TreeRow
        depth={1}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        selected={ctx.isSelected("partner", partner.id)}
        onSelect={() => ctx.select({ kind: "partner", id: partner.id })}
        title={partner.name}
        badges={
          <>
            <KindBadge kind="partner" />
            {partner.status !== "active" && <CompanyStatusBadge status={partner.status} />}
          </>
        }
        meta={[
          plural(partner.customer_count, "klantbedrijf", "klantbedrijven"),
          plural(partner.partner_admin_count, "Partner Admin", "Partner Admins"),
          plural(partner.customer_user_count, "gebruiker bij klanten", "gebruikers bij klanten")
        ].join(" · ")}
      />
      {open && (
        <>
          <GroupLabel depth={1}>Partner Admins</GroupLabel>
          <UserList companyId={partner.id} depth={2} ctx={ctx} />
          <GroupLabel depth={1}>Klantbedrijven</GroupLabel>
          <CustomerList groupId={partner.id} depth={2} ctx={ctx} />
        </>
      )}
    </>
  );
}

function OwnersNode({ ctx }) {
  const [open, setOpen] = useState(false);
  const paging = usePaging();
  const state = usePagedList(open ? "/api/admin/org/owners" : null, { page: paging.page, pageSize: paging.pageSize }, ctx.refreshKey);
  return (
    <>
      <TreeRow
        depth={0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onSelect={() => setOpen((o) => !o)}
        title="VeriPasso platform"
        badges={<RoleBadge role="platform_owner" />}
        meta="Platform Owners: beheren alle partners en klantbedrijven"
      />
      {open && (
        <>
          <LevelState state={state} depth={1} emptyText="Geen Platform Owners." />
          {state.data?.items.map((user) => (
            <TreeRow
              key={user.id}
              depth={1}
              selected={ctx.isSelected("user", user.id)}
              onSelect={() => ctx.select({ kind: "user", id: user.id })}
              title={fullName(user) || user.email}
              meta={fullName(user) ? user.email : null}
              badges={<RoleBadge role={user.role} />}
              aside={formatRelativeTime(user.last_activity, "nooit actief")}
            />
          ))}
          {state.data && state.data.pages > 1 && (
            <Pager data={state.data} onPage={paging.setPage} onPageSize={paging.setPageSize} singular="Platform Owner" plural="Platform Owners" name="pager-owners" />
          )}
        </>
      )}
    </>
  );
}

function StandaloneNode({ summary, ctx }) {
  const [open, setOpen] = useState(false);
  if (!summary || summary.customer_count === 0) return null;
  return (
    <>
      <TreeRow
        depth={0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onSelect={() => setOpen((o) => !o)}
        title="Zelfstandige klantbedrijven"
        badges={<KindBadge kind="customer" standalone />}
        meta={`${plural(summary.customer_count, "klantbedrijf", "klantbedrijven")} zonder partner · ${plural(summary.customer_user_count, "gebruiker", "gebruikers")}`}
      />
      {open && <CustomerList groupId="standalone" depth={1} ctx={ctx} />}
    </>
  );
}

function OrgTree({ ctx }) {
  const paging = usePaging();
  const [retry, setRetry] = useState(0);
  const state = usePagedList("/api/admin/org/groups", { page: paging.page, pageSize: paging.pageSize, sort: ctx.partnerSort }, ctx.refreshKey + retry);
  useEffect(() => paging.setPage(1), [ctx.partnerSort]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <OwnersNode ctx={ctx} />
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Partners</span>
        {state.data && <span className="text-xs text-slate-400">{plural(state.data.total, "partner", "partners")}</span>}
      </div>
      {state.loading && !state.data && <RowSkeleton rows={5} />}
      {state.error && (
        <div className="p-3">
          <InlineError message={state.error} onRetry={() => setRetry((r) => r + 1)} />
        </div>
      )}
      {state.data && state.data.total === 0 && (
        <p className="border-b border-slate-100 px-3 py-3 text-sm text-slate-500">
          Nog geen partners. <Link href="/admin/partners/nieuw" className="font-medium text-blue-600 hover:underline">Nieuwe partner</Link>
        </p>
      )}
      {state.data?.items.map((partner) => (
        <PartnerNode key={partner.id} partner={partner} ctx={ctx} />
      ))}
      {state.data && state.data.total > 0 && (
        <Pager data={state.data} onPage={paging.setPage} onPageSize={paging.setPageSize} singular="partner" plural="partners" name="pager-partners" />
      )}
      <StandaloneNode summary={state.data?.standalone} ctx={ctx} />
    </div>
  );
}

// --- zoek-/filterresultaten -------------------------------------------------------------
function ResultPath({ item }) {
  const parts = [];
  if (item.kind === "customer") parts.push(item.partner_name || "Zelfstandig");
  if (item.kind === "user") {
    if (item.role === "platform_owner") parts.push("VeriPasso platform");
    else {
      if (item.company_kind === "customer") parts.push(item.partner_name || "Zelfstandig");
      if (item.company_name) parts.push(item.company_name);
    }
  }
  if (!parts.length) return null;
  return <span className="mt-0.5 block truncate text-xs text-slate-400">{parts.join(" › ")}</span>;
}

function SearchResults({ params, ctx }) {
  const paging = usePaging();
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => paging.setPage(1), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = usePagedList("/api/admin/org/search", { ...params, page: paging.page, pageSize: paging.pageSize }, ctx.refreshKey + retry);

  if (state.loading && !state.data) return <RowSkeleton rows={6} />;
  if (state.error)
    return (
      <div className="p-3">
        <InlineError message={state.error} onRetry={() => setRetry((r) => r + 1)} />
      </div>
    );
  if (!state.data || state.data.total === 0)
    return (
      <div className="p-4">
        <EmptyState icon={SearchIcon} title="Geen resultaten" description="Pas je zoekterm of filters aan." compact />
      </div>
    );

  return (
    <div aria-busy={state.loading}>
      <ul>
        {state.data.items.map((item) => {
          const kind = item.kind === "user" ? "user" : item.kind;
          return (
            <li key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                onClick={() => ctx.select({ kind, id: item.id })}
                className={`flex w-full min-w-0 items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left ${ctx.isSelected(kind, item.id) ? "bg-emerald-50" : "hover:bg-slate-50"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
                    {item.kind === "user" ? (
                      <RoleBadge role={item.role} />
                    ) : (
                      <KindBadge kind={item.kind} standalone={item.kind === "customer" && !item.partner_id} />
                    )}
                    {item.status !== "active" &&
                      (item.kind === "user" ? (
                        <Badge variant={USER_STATUS_BADGE_VARIANTS[item.status]}>{statusLabel(item.status)}</Badge>
                      ) : (
                        <CompanyStatusBadge status={item.status} />
                      ))}
                  </span>
                  {item.kind === "user" && item.subtitle !== item.title && (
                    <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>
                  )}
                  <ResultPath item={item} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Pager data={state.data} onPage={paging.setPage} onPageSize={paging.setPageSize} singular="resultaat" plural="resultaten" name="pager-search" />
    </div>
  );
}

export default function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [partnerSort, setPartnerSort] = useState("name");
  const [customerSort, setCustomerSort] = useState("name");
  const [selection, setSelection] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const q = useDebounced(search.trim());

  // Oude deeplink /admin/users?companyId=… opent direct het detailpaneel van dat bedrijf.
  useEffect(() => {
    const companyId = new URLSearchParams(window.location.search).get("companyId");
    if (companyId && /^\d+$/.test(companyId)) setSelection({ kind: "customer", id: Number(companyId) });
  }, []);

  const filtering = Boolean(q || type || role || status);
  const ctx = {
    refreshKey,
    partnerSort,
    customerSort,
    select: setSelection,
    isSelected: (kind, id) =>
      Boolean(selection) && selection.id === id && (selection.kind === kind || (kind !== "user" && selection.kind !== "user"))
  };

  function resetFilters() {
    setSearch("");
    setType("");
    setRole("");
    setStatus("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Organisaties & gebruikers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bekijk hoe partners, klantbedrijven en gebruikers binnen VeriPasso georganiseerd zijn.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/partners/nieuw" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Nieuwe partner
          </Link>
          <Link href="/admin/companies/new" className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            Nieuw klantbedrijf
          </Link>
        </div>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] xl:items-end">
          <div className="md:col-span-2 xl:col-span-1">
            <label htmlFor="org-search" className="block text-sm font-medium text-slate-700">
              Zoeken
            </label>
            <div className="relative mt-1">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <SearchIcon size={16} />
              </span>
              <input
                id="org-search"
                type="search"
                autoComplete="off"
                maxLength={100}
                placeholder="Zoek op bedrijfsnaam, gebruiker of e-mailadres..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
          </div>
          <Select label="Type" name="org-type" placeholder="Alle typen" options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />
          <Select label="Rol" name="org-role" placeholder="Alle rollen" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} />
          <Select label="Status" name="org-status" placeholder="Alle statussen" options={USER_STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
          {filtering ? (
            <div className="flex items-end">
              <button type="button" onClick={resetFilters} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Filters wissen
              </button>
            </div>
          ) : (
            <Select
              label="Sorteren"
              name="org-sort"
              options={PARTNER_SORT_OPTIONS}
              value={partnerSort}
              onChange={(e) => setPartnerSort(e.target.value)}
            />
          )}
        </div>
        {!filtering && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <label htmlFor="org-customer-sort">Klantbedrijven sorteren op</label>
            <select
              id="org-customer-sort"
              value={customerSort}
              onChange={(e) => setCustomerSort(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs"
            >
              {CUSTOMER_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {filtering ? (
            <SearchResults params={{ q, type, role, status }} ctx={ctx} />
          ) : (
            <OrgTree ctx={ctx} />
          )}
        </div>
        {selection ? (
          <OrgDetailPanel
            selection={selection}
            onSelect={setSelection}
            onClose={() => setSelection(null)}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <div className="sticky top-4 hidden w-96 shrink-0 lg:block">
            <EmptyState
              icon={UsersIcon}
              title="Niets geselecteerd"
              description="Kies een partner, klantbedrijf of gebruiker om details en acties te zien."
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
