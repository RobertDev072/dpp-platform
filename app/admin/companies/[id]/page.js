"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { fullName, roleLabel, statusLabel, USER_STATUS_BADGE_VARIANTS, USER_STATUS_OPTIONS } from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Tabs from "@/components/ui/Tabs";
import KpiCard from "@/components/ui/KpiCard";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import SubscriptionUsage from "@/components/license/SubscriptionUsage";
import { formatBytes, formatPrice, toDateInputValue } from "@/components/license/licenseFormat";
import { formatRelativeTime } from "@/components/admin/listUtils";
import { documentExpiry, documentCategoryLabel } from "@/components/products/documentUtils";
import { BoxIcon, ChartIcon, FileIcon, QrIcon } from "@/components/ui/icons";

const TABS = [
  { key: "overview", label: "Overzicht" },
  { key: "products", label: "Producten" },
  { key: "users", label: "Gebruikers" },
  { key: "qr", label: "QR-codes" },
  { key: "documents", label: "Documenten" },
  { key: "activity", label: "Activiteit" },
  { key: "subscription", label: "Abonnement" },
  { key: "billing", label: "Facturatie" },
  { key: "settings", label: "Instellingen" }
];

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

const PRODUCT_STATUS = { draft: ["Concept", "neutral"], published: ["Gepubliceerd", "success"], archived: ["Gearchiveerd", "warning"] };

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function useLoader(loader, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    return loader()
      .then(setData)
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

function Loading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function ErrorBox({ message }) {
  return message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p> : null;
}

function Field({ label, children }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

// --- Tabs -----------------------------------------------------------------------

function OverviewTab({ data, onTab }) {
  const { company, counts, usage, recentActivity } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Producten" value={counts.products.toLocaleString("nl-NL")} hint={`${counts.published} gepubliceerd · ${counts.drafts} concept`} icon={<BoxIcon />} />
        <KpiCard label="Actieve QR-codes" value={counts.qr_active.toLocaleString("nl-NL")} hint={`${counts.qr_reserved} gereserveerd`} icon={<QrIcon />} />
        <KpiCard label="QR-scans (30 dagen)" value={counts.scans_30d.toLocaleString("nl-NL")} hint={`${counts.scans_total.toLocaleString("nl-NL")} totaal`} icon={<ChartIcon />} />
        <KpiCard
          label="Documenten"
          value={counts.documents.toLocaleString("nl-NL")}
          hint={counts.documents_expired ? `${counts.documents_expired} verlopen` : formatBytes(usage?.storage?.used)}
          tone={counts.documents_expired ? "danger" : "neutral"}
          icon={<FileIcon />}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Abonnement</h2>
            <button type="button" onClick={() => onTab("subscription")} className="text-sm font-medium text-emerald-700 hover:underline">
              Beheren
            </button>
          </div>
          <SubscriptionUsage usage={usage} />
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Klantgegevens</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Contactpersoon</dt>
            <dd className="text-slate-900">{company.contact_name || "—"}</dd>
            <dt className="text-slate-500">E-mail</dt>
            <dd className="break-all text-slate-900">{company.contact_email || "—"}</dd>
            <dt className="text-slate-500">Telefoon</dt>
            <dd className="text-slate-900">{company.contact_phone || "—"}</dd>
            <dt className="text-slate-500">Partner</dt>
            <dd className="text-slate-900">{company.partner_name || "Direct (geen partner)"}</dd>
            <dt className="text-slate-500">Gebruikers</dt>
            <dd className="text-slate-900">
              {counts.users_active} actief van {counts.users_total}
            </dd>
            <dt className="text-slate-500">Klant sinds</dt>
            <dd className="text-slate-900">{formatDate(company.created_at)}</dd>
            <dt className="text-slate-500">Laatste login</dt>
            <dd className="text-slate-900">{formatRelativeTime(counts.last_login, "Nog nooit")}</dd>
            <dt className="text-slate-500">Laatste activiteit</dt>
            <dd className="text-slate-900">{formatRelativeTime(counts.last_activity, "Geen")}</dd>
          </dl>
          {!company.contact_name && !company.contact_email && (
            <button type="button" onClick={() => onTab("settings")} className="mt-3 text-sm font-medium text-emerald-700 hover:underline">
              Contactpersoon toevoegen
            </button>
          )}
        </Card>
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recente activiteit</h2>
          <button type="button" onClick={() => onTab("activity")} className="text-sm font-medium text-emerald-700 hover:underline">
            Alles bekijken
          </button>
        </div>
        <ActivityList items={recentActivity} />
      </Card>
    </div>
  );
}

function ActivityList({ items }) {
  if (!items?.length) return <p className="text-sm text-slate-500">Nog geen activiteit vastgelegd.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
          <span>
            <span className="font-medium text-slate-900">{row.action}</span>{" "}
            <span className="text-slate-500">
              {row.entity_type}
              {row.entity_id ? ` #${row.entity_id}` : ""}
            </span>
            {row.impersonator_email && <span className="ml-1 text-xs text-amber-700">(via {row.impersonator_email})</span>}
          </span>
          <span className="text-xs text-slate-500">
            {row.user_email || "systeem"} · {new Date(row.timestamp).toLocaleString("nl-NL")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProductsTab({ companyId }) {
  const [page, setPage] = useState(1);
  const { data, error } = useLoader(() => api.get(`/api/products?companyId=${companyId}&page=${page}&pageSize=25&sort=created_at&order=desc`), [companyId, page]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <EmptyState title="Geen producten" description="Deze klant heeft nog geen producten aangemaakt." />;
  const pages = Math.max(1, Math.ceil((data.total || 0) / 25));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Product</th>
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Compleet</th>
              <th className="py-2">Aangemaakt</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => {
              const [label, variant] = PRODUCT_STATUS[p.status] || [p.status, "neutral"];
              return (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-900">{p.name}</td>
                  <td className="py-2 pr-3 text-slate-600">{p.sku || "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={variant}>{label}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{p.completeness != null ? `${p.completeness}%` : "—"}</td>
                  <td className="py-2 text-slate-600">{formatDate(p.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} total={data.total} onPage={setPage} />
    </div>
  );
}

function Pager({ page, pages, total, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>
        Pagina {page} van {pages} · {Number(total).toLocaleString("nl-NL")} totaal
      </span>
      <div className="flex gap-2">
        <ActionButton size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Vorige
        </ActionButton>
        <ActionButton size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Volgende
        </ActionButton>
      </div>
    </div>
  );
}

function UsersTab({ companyId }) {
  const { data, error } = useLoader(() => api.get(`/api/users?companyId=${companyId}`), [companyId]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <EmptyState title="Geen gebruikers" description="Nodig een bedrijfsbeheerder uit om te beginnen." action={<ActionButton href={`/admin/companies/${companyId}/uitnodigen`}>Beheerder uitnodigen</ActionButton>} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Gebruiker</th>
            <th className="py-2 pr-3">Rol</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Laatste login</th>
            <th className="py-2">Sessies</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id} className="border-b border-slate-100">
              <td className="py-2 pr-3">
                <span className="block font-medium text-slate-900">{fullName(u) || u.email}</span>
                {fullName(u) && <span className="block text-xs text-slate-500">{u.email}</span>}
              </td>
              <td className="py-2 pr-3 text-slate-600">{roleLabel(u.role)}</td>
              <td className="py-2 pr-3">
                <Badge variant={USER_STATUS_BADGE_VARIANTS[u.status] || "neutral"}>{statusLabel(u.status)}</Badge>
              </td>
              <td className="py-2 pr-3 text-slate-600">{formatRelativeTime(u.last_login_at, "Nog nooit")}</td>
              <td className="py-2 text-slate-600">{u.active_sessions || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-slate-500">
        Rollen, status, sessies en wachtwoorden beheer je in{" "}
        <Link href="/admin/users" className="font-medium text-emerald-700 hover:underline">
          Alle gebruikers
        </Link>
        .
      </p>
    </div>
  );
}

function QrTab({ companyId }) {
  const { data, error } = useLoader(() => api.get(`/api/admin/companies/${companyId}/qr`), [companyId]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <EmptyState title="Nog geen QR-codes" description="QR-codes ontstaan zodra de klant een product publiceert of een QR reserveert." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3">QR-URL</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3 text-right">Scans</th>
            <th className="py-2">Laatste scan</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-900">{item.name}</td>
              <td className="max-w-xs truncate py-2 pr-3">
                <a href={item.qr_url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                  {item.qr_url}
                </a>
              </td>
              <td className="py-2 pr-3">
                <Badge variant={item.status === "published" ? "success" : item.status === "archived" ? "warning" : "neutral"}>
                  {item.status === "published" ? "Actief" : item.status === "archived" ? "Gearchiveerd" : "Gereserveerd"}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-right text-slate-900">{Number(item.scans_total || 0).toLocaleString("nl-NL")}</td>
              <td className="py-2 text-slate-600">{formatRelativeTime(item.last_scan, "Nog niet")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > data.items.length && (
        <p className="mt-2 text-xs text-slate-500">De 100 meest gescande van {Number(data.total).toLocaleString("nl-NL")} QR-codes.</p>
      )}
    </div>
  );
}

function DocumentsTab({ companyId }) {
  const { data, error } = useLoader(() => api.get(`/api/admin/companies/${companyId}/documents`), [companyId]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <EmptyState title="Geen documenten" description="Deze klant heeft nog geen documenten geüpload." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Document</th>
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3">Zichtbaarheid</th>
            <th className="py-2 pr-3">Vervaldatum</th>
            <th className="py-2">Geüpload</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => {
            const e = documentExpiry(d.valid_until);
            return (
              <tr key={d.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <span className="block font-medium text-slate-900">{d.title}</span>
                  <span className="block text-xs text-slate-500">
                    {documentCategoryLabel(d.category)}
                    {d.version ? ` · v${d.version}` : ""}
                    {d.archived_at ? " · gearchiveerd" : ""}
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-600">{d.product_name}</td>
                <td className="py-2 pr-3">
                  <Badge variant={d.is_public ? "success" : "neutral"}>{d.is_public ? "Openbaar" : "Privé"}</Badge>
                </td>
                <td className="py-2 pr-3">
                  {e.status === "none" ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <Badge variant={e.status === "expired" ? "danger" : e.status === "expiring" ? "warning" : "neutral"}>{e.status === "valid" ? e.date : e.label}</Badge>
                  )}
                </td>
                <td className="py-2 text-slate-600">
                  {formatDate(d.created_at)}
                  {(d.uploader_name || d.uploader_email) && <span className="block text-xs text-slate-500">{d.uploader_name || d.uploader_email}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ companyId }) {
  const [page, setPage] = useState(1);
  const { data, error } = useLoader(() => api.get(`/api/audit?companyId=${companyId}&page=${page}&pageSize=25`), [companyId, page]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <div>
      <ActivityList items={data.items} />
      <Pager page={page} pages={Math.max(1, Math.ceil((data.total || 0) / 25))} total={data.total} onPage={setPage} />
    </div>
  );
}

function SubscriptionTab({ data, onSaved }) {
  const toast = useToast();
  const { company, usage } = data;
  const [plans, setPlans] = useState(null);
  const [values, setValues] = useState({
    planId: company.plan_id ?? "",
    licenseStart: toDateInputValue(company.license_start),
    licenseEnd: toDateInputValue(company.license_end)
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/admin/plans").then(setPlans).catch(() => setPlans([]));
  }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/admin/companies/${company.id}`, {
        planId: values.planId === "" ? null : Number(values.planId),
        licenseStart: values.licenseStart || null,
        licenseEnd: values.licenseEnd || null
      });
      toast.success("Abonnement bijgewerkt");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Verbruik</h2>
        <SubscriptionUsage usage={usage} />
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Plan en looptijd</h2>
        <form onSubmit={save} className="space-y-3">
          <Field label="Plan">
            <select value={values.planId} onChange={(e) => setValues((v) => ({ ...v, planId: e.target.value }))} className={inputClass}>
              <option value="">— geen plan (geen limieten) —</option>
              {(plans || []).map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.price_monthly_cents != null ? ` — ${formatPrice(plan.price_monthly_cents)}` : ""} ({plan.max_products} producten, {plan.max_users} gebruikers)
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ingangsdatum">
              <input type="date" value={values.licenseStart} onChange={(e) => setValues((v) => ({ ...v, licenseStart: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Einddatum">
              <input type="date" value={values.licenseEnd} onChange={(e) => setValues((v) => ({ ...v, licenseEnd: e.target.value }))} className={inputClass} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">Een lagere limiet verwijdert nooit data; alleen nieuwe producten of gebruikers worden dan geblokkeerd.</p>
          <ActionButton type="submit" variant="primary" disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </ActionButton>
        </form>
      </Card>
    </div>
  );
}

function CompanyForm({ company, fields, onSaved, children }) {
  const toast = useToast();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, company[f.column] ?? ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, f.required ? values[f.key] : values[f.key] === "" ? null : values[f.key]]));
      await api.patch(`/api/admin/companies/${company.id}`, body);
      toast.success("Opgeslagen");
      onSaved();
    } catch (err) {
      setError(err.details?.fieldErrors ? Object.values(err.details.fieldErrors).flat().join(" ") || err.message : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <ErrorBox message={error} />
      {children}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === "textarea" ? (
              <textarea rows={4} maxLength={5000} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={inputClass} />
            ) : f.type === "select" ? (
              <select value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={inputClass}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type || "text"}
                required={f.required}
                maxLength={f.maxLength || 200}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={inputClass}
              />
            )}
          </Field>
        ))}
      </div>
      <ActionButton type="submit" variant="primary" disabled={saving}>
        {saving ? "Opslaan…" : "Opslaan"}
      </ActionButton>
    </form>
  );
}

function BillingTab({ data, onSaved }) {
  const { company, usage } = data;
  const price = formatPrice(usage?.priceMonthlyCents);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Maandbedrag</h2>
        <p className="text-2xl font-semibold text-slate-900">{price || "—"}</p>
        <p className="mt-1 text-sm text-slate-500">{usage?.plan ? `Plan ${usage.plan.name}` : "Geen plan gekoppeld"}</p>
        {!price && usage?.plan && <p className="mt-2 text-xs text-slate-500">Stel een prijs in bij Abonnementen (plannen) om hier het maandbedrag te zien.</p>}
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Facturen en betalingen lopen (nog) buiten VeriPasso. Er is bewust geen betaalprovider gekoppeld; dat vraagt eerst een besluit over provider en kosten.
        </p>
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Facturatiegegevens</h2>
        <CompanyForm
          company={company}
          onSaved={onSaved}
          fields={[
            { key: "billingEmail", column: "billing_email", label: "Factuur-e-mail", type: "email" },
            { key: "billingReference", column: "billing_reference", label: "Referentie / PO-nummer", maxLength: 100 },
            { key: "vatNumber", column: "vat_number", label: "Btw-nummer", maxLength: 30 }
          ]}
        />
      </Card>
    </div>
  );
}

function SettingsTab({ data, onSaved }) {
  const { company } = data;
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Bedrijf en contactpersoon</h2>
      <CompanyForm
        company={company}
        onSaved={onSaved}
        fields={[
          { key: "name", column: "name", label: "Bedrijfsnaam", required: true },
          { key: "status", column: "status", label: "Status", type: "select", required: true, options: USER_STATUS_OPTIONS },
          { key: "contactName", column: "contact_name", label: "Contactpersoon" },
          { key: "contactEmail", column: "contact_email", label: "Contact-e-mail", type: "email" },
          { key: "contactPhone", column: "contact_phone", label: "Telefoon", type: "tel", maxLength: 50 },
          { key: "notes", column: "notes", label: "Interne notities (alleen zichtbaar voor platformbeheer)", type: "textarea" }
        ]}
      />
    </Card>
  );
}

// --- Pagina ----------------------------------------------------------------------

export default function Customer360Page() {
  const { id } = useParams();
  const companyId = Number(id);
  const [tab, setTab] = useState("overview");
  const { data, error, reload } = useLoader(() => api.get(`/api/admin/companies/${companyId}/overview`), [companyId]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.key === requested)) setTab(requested);
  }, []);

  function changeTab(key) {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/admin/companies" className="text-sm text-slate-500 hover:text-slate-700">
          ← Klantbedrijven
        </Link>
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { company, usage } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/companies" className="text-sm text-slate-500 hover:text-slate-700">
          ← Klantbedrijven
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {company.logo ? (
              <img src={company.logo} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-emerald-50 text-lg font-semibold text-emerald-700">
                {company.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-900">{company.name}</h1>
              <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <Badge variant={USER_STATUS_BADGE_VARIANTS[company.status] || "neutral"}>{statusLabel(company.status)}</Badge>
                <span>{company.kind === "partner" ? "Partner" : "Klantbedrijf"}</span>
                {usage?.plan && <span>· {usage.plan.name}</span>}
                {company.partner_name && <span>· via {company.partner_name}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {company.kind !== "partner" && (
              <ActionButton href={`/admin/companies/${company.id}/uitnodigen`}>Beheerder uitnodigen</ActionButton>
            )}
          </div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={changeTab} />

      {tab === "overview" && <OverviewTab data={data} onTab={changeTab} />}
      {tab === "products" && (
        <Card>
          <ProductsTab companyId={companyId} />
        </Card>
      )}
      {tab === "users" && (
        <Card>
          <UsersTab companyId={companyId} />
        </Card>
      )}
      {tab === "qr" && (
        <Card>
          <QrTab companyId={companyId} />
        </Card>
      )}
      {tab === "documents" && (
        <Card>
          <DocumentsTab companyId={companyId} />
        </Card>
      )}
      {tab === "activity" && (
        <Card>
          <ActivityTab companyId={companyId} />
        </Card>
      )}
      {tab === "subscription" && <SubscriptionTab key={`${company.plan_id}-${company.license_end}`} data={data} onSaved={reload} />}
      {tab === "billing" && <BillingTab key={company.updated_at} data={data} onSaved={reload} />}
      {tab === "settings" && <SettingsTab key={company.updated_at} data={data} onSaved={reload} />}
    </div>
  );
}
