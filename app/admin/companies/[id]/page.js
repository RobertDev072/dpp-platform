"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { roleLabel, statusLabel, USER_STATUS_BADGE_VARIANTS, fullName } from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Tabs from "@/components/ui/Tabs";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import { ButtonLink } from "@/components/ui/Button";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatValidity } from "@/components/license/licenseFormat";
import { formatFileSize } from "@/components/products/documentUtils";
import { BoxIcon, CheckCircleIcon, ChevronLeftIcon, FileIcon, ScanIcon, UsersIcon } from "@/components/ui/icons";

const TABS = [
  { key: "overview", label: "Overzicht" },
  { key: "users", label: "Gebruikers" },
  { key: "products", label: "Producten & QR" },
  { key: "imports", label: "Imports" },
  { key: "activity", label: "Activiteit" },
  { key: "subscription", label: "Abonnement" }
];

const COMPANY_STATUS = { active: ["success", "Actief"], blocked: ["danger", "Geblokkeerd"], suspended: ["warning", "Opgeschort"], archived: ["neutral", "Gearchiveerd"] };

// Customer 360: één klantbedrijf in één oogopslag (alleen Platform Owner). Alle
// cijfers komen uit bestaande data; facturatie bestaat (nog) niet in het systeem en
// wordt daarom ook niet getoond.
export default function Customer360Page() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    api
      .get(`/api/admin/companies/${id}/overview`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 text-sm text-red-700">
        {error}{" "}
        <Link href="/admin/companies" className="font-medium underline">
          Terug naar klantbedrijven
        </Link>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { company, license, users, stats, scans, documents, imports, activity, onboarding, plan } = data;
  const [statusVariant, statusText] = COMPANY_STATUS[company.status] || ["neutral", company.status];
  const admins = users.filter((u) => u.role === "company_admin" && u.status === "active");

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/companies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeftIcon size={14} /> Klantbedrijven
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{company.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge variant={statusVariant}>{statusText}</Badge>
              {license && <LicenseStatusBadge status={license.status} />}
              <span>{plan ? plan.name : "Geen plan"}</span>
              {company.partner_name && <span>via partner {company.partner_name}</span>}
              <span>klant sinds {new Date(company.created_at).toLocaleDateString("nl-NL")}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/admin/users?companyId=${company.id}`} size="sm">
              Gebruikers beheren
            </ButtonLink>
            <ButtonLink href={`/admin/products?companyId=${company.id}`} size="sm">
              Producten
            </ButtonLink>
            <ButtonLink href={`/admin/companies/${company.id}/uitnodigen`} size="sm" variant="accent">
              Beheerder uitnodigen
            </ButtonLink>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Producten" value={formatNumber(stats.total - stats.archived)} icon={BoxIcon} trend={{ text: `${formatNumber(stats.published)} gepubliceerd`, tone: "neutral" }} />
        <KpiCard label="QR-scans (30 d)" value={formatNumber(scans.last30Days)} icon={ScanIcon} trend={{ text: `${formatNumber(scans.total)} totaal`, tone: "neutral" }} />
        <KpiCard label="Gebruikers" value={formatNumber(users.filter((u) => u.status === "active").length)} icon={UsersIcon} trend={{ text: `${admins.length} beheerder${admins.length === 1 ? "" : "s"}`, tone: "neutral" }} />
        <KpiCard label="Documenten" value={formatNumber(documents.total)} icon={FileIcon} trend={{ text: `${formatFileSize(documents.storageBytes)} opslag`, tone: documents.expired ? "danger" : "neutral" }} />
      </div>

      <div className="overflow-x-auto">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Gezondheid van de paspoorten</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Mini label="Gem. compleetheid" value={stats.avgCompleteness == null ? "—" : `${stats.avgCompleteness}%`} />
              <Mini label="Compleet" value={formatNumber(stats.complete)} />
              <Mini label="Concept" value={formatNumber(stats.drafts)} />
              <Mini label="QR actief" value={formatNumber(stats.qrActive)} />
              <Mini label="Zonder document" value={formatNumber(stats.missing.documents)} />
              <Mini label="Zonder foto" value={formatNumber(stats.missing.photo)} />
              <Mini label="Docs verlopen" value={formatNumber(documents.expired)} />
              <Mini label="Gearchiveerd" value={formatNumber(stats.archived)} />
            </dl>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Onboarding</h2>
            <ProgressBar value={onboarding.pct} label={`${onboarding.pct}% voltooid`} description={`${onboarding.done}/${onboarding.total}`} />
            <ul className="mt-3 space-y-1 text-sm">
              {onboarding.steps.map((s) => (
                <li key={s.key} className={`flex items-center gap-2 ${s.done ? "text-slate-500" : "text-slate-900"}`}>
                  {s.done ? <CheckCircleIcon size={15} className="text-emerald-600" /> : <span className="ml-0.5 h-3 w-3 rounded-full border-2 border-slate-300" />}
                  {s.label}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="lg:col-span-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Contactpersonen</h2>
            {admins.length === 0 ? (
              <p className="text-sm text-amber-700">Dit bedrijf heeft geen actieve bedrijfsbeheerder.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {admins.map((u) => (
                  <li key={u.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <p className="font-medium text-slate-900">{fullName(u) || u.email}</p>
                    <a href={`mailto:${u.email}`} className="text-xs text-emerald-700 hover:underline">
                      {u.email}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "users" && (
        <Card>
          {users.length === 0 ? (
            <EmptyState icon={UsersIcon} title="Nog geen gebruikers" />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Naam</th>
                    <th className="py-2 pr-3 font-medium">Rol</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Laatste login</th>
                    <th className="py-2 pr-3 font-medium">Actieve sessies</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-900">{fullName(u) || "—"}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{roleLabel(u.role)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={USER_STATUS_BADGE_VARIANTS[u.status] || "neutral"}>{statusLabel(u.status)}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{u.last_login ? formatDateTime(u.last_login) : "Nooit"}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">{u.active_sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "products" && (
        <Card>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Mini label="Totaal" value={formatNumber(stats.total)} />
            <Mini label="Gepubliceerd" value={formatNumber(stats.published)} />
            <Mini label="Concept" value={formatNumber(stats.drafts)} />
            <Mini label="QR actief" value={formatNumber(stats.qrActive)} />
            <Mini label="QR gereserveerd" value={formatNumber(stats.qrReserved)} />
            <Mini label="Scans deze maand" value={formatNumber(scans.thisMonth)} />
          </dl>
          <ButtonLink href={`/admin/products?companyId=${company.id}`} size="sm" className="mt-4">
            Alle producten van {company.name}
          </ButtonLink>
        </Card>
      )}

      {tab === "imports" && (
        <Card>
          {imports.length === 0 ? (
            <EmptyState title="Nog geen imports" description="Dit bedrijf heeft nog geen producten via Excel/CSV geïmporteerd." />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {imports.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{job.filename}</span>
                    <span className="block text-xs text-slate-500">{formatDateTime(job.created_at)} · {job.status}</span>
                  </span>
                  <span className="text-xs text-slate-600">
                    {formatNumber(job.total_rows)} rijen · {formatNumber(job.created_count)} toegevoegd · {formatNumber(job.updated_count)} bijgewerkt · {formatNumber(job.error_count)} fouten
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "activity" && (
        <Card>
          {!activity?.length ? (
            <EmptyState title="Nog geen activiteit" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-800">
                    <span className="font-medium">{a.action}</span> · {a.entity_type}
                    {a.entity_id ? ` #${a.entity_id}` : ""}
                  </span>
                  <span className="text-xs text-slate-500">
                    {a.user_email || "systeem"} · {formatDateTime(a.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ButtonLink href={`/admin/audit?companyId=${company.id}`} size="sm" className="mt-3">
            Volledig auditlog
          </ButtonLink>
        </Card>
      )}

      {tab === "subscription" && (
        <Card className="space-y-4">
          {license ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{license.plan ? license.plan.name : "Geen plan gekoppeld"}</p>
                  <p className="text-sm text-slate-500">Geldigheid: {formatValidity(license.licenseStart, license.licenseEnd)}</p>
                </div>
                <LicenseStatusBadge status={license.status} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <UsageBar label="Producten" {...license.products} />
                <UsageBar label="Gebruikers" {...license.users} />
              </div>
              <p className="text-xs text-slate-500">
                Resterend: {license.products.max == null ? "onbeperkt" : formatNumber(Math.max(0, license.products.max - license.products.used))} producten,{" "}
                {license.users.max == null ? "onbeperkt" : formatNumber(Math.max(0, license.users.max - license.users.used))} gebruikers. Facturatiegegevens worden niet in VeriPasso bijgehouden.
              </p>
              <ButtonLink href="/admin/licenses" size="sm">
                Abonnementen beheren
              </ButtonLink>
            </>
          ) : (
            <p className="text-sm text-slate-500">Geen abonnementsgegevens.</p>
          )}
        </Card>
      )}
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
