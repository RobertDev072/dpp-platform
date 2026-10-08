"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDayMonth, formatNumber } from "@/lib/format";
import Card from "@/components/ui/Card";
import Button, { ButtonLink } from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import KpiCard from "@/components/ui/KpiCard";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ProgressBar from "@/components/ui/ProgressBar";
import StatusBadge, { QrStatusBadge } from "@/components/ui/StatusBadge";
import CompletenessBar from "@/components/products/CompletenessBar";
import LineChart from "@/components/monitoring/LineChart";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatValidity } from "@/components/license/licenseFormat";
import {
  AlertIcon,
  BoxIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  ErrorIcon,
  FileIcon,
  InfoIcon,
  PlusIcon,
  RefreshIcon,
  ScanIcon,
  SparkIcon,
  UploadIcon
} from "@/components/ui/icons";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "Goedenacht";
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

function trendText(current, previous) {
  if (!previous) return current ? { text: `${formatNumber(current)} in 30 dagen`, tone: "neutral" } : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { text: `${pct >= 0 ? "+" : ""}${pct}% t.o.v. vorige 30 dagen`, tone: pct >= 0 ? "success" : "warning" };
}

const SEVERITY = {
  error: { icon: ErrorIcon, className: "text-red-600 bg-red-50" },
  warning: { icon: AlertIcon, className: "text-amber-600 bg-amber-50" },
  info: { icon: InfoIcon, className: "text-blue-600 bg-blue-50" }
};

export default function CompanyDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (range) => {
    setError("");
    try {
      setData(await api.get(`/api/dashboard/overview?days=${range}`));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const stats = data?.stats;
  const loading = !data && !error;
  const isNew = stats && stats.total === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data ? `${greeting()}${data.user?.firstName ? ` ${data.user.firstName}` : ""}` : "Overzicht"}
        description={data?.company ? `Hier is het overzicht van ${data.company.name}.` : "Je productpaspoorten, QR-scans en wat er nog moet gebeuren."}
        actions={
          <>
            <ButtonLink href="/company/products/import" icon={UploadIcon}>
              Importeren
            </ButtonLink>
            <ButtonLink href="/company/products?new=1" variant="accent" icon={PlusIcon}>
              Product
            </ButtonLink>
          </>
        }
      />

      {error && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-red-200 bg-red-50 text-sm text-red-700">
          <span>We konden het overzicht niet laden: {error}</span>
          <Button variant="outline" size="sm" icon={RefreshIcon} onClick={() => load(days)}>
            Opnieuw proberen
          </Button>
        </Card>
      )}

      {data?.recommendations?.length > 0 && (
        <div className="space-y-2">
          {data.recommendations.map((tip) => (
            <Link
              key={tip.text}
              href={tip.href}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                tip.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-emerald-100 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-50"
              }`}
            >
              {tip.tone === "warning" ? <AlertIcon size={16} /> : <SparkIcon size={16} />}
              <span className="flex-1">{tip.text}</span>
              <ChevronRightIcon size={14} />
            </Link>
          ))}
        </div>
      )}

      {(isNew || (data && data.onboarding.pct < 100)) && <Onboarding onboarding={data.onboarding} prominent={isNew} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard loading={loading} label="Producten" value={stats && formatNumber(stats.total - stats.archived)} icon={BoxIcon} trend={stats && { text: `+${stats.createdThisMonth} deze maand`, tone: "neutral" }} href="/company/products" />
        <KpiCard loading={loading} label="Gepubliceerd" value={stats && formatNumber(stats.published)} icon={CheckCircleIcon} tone="success" trend={stats && { text: `+${stats.publishedThisMonth} deze maand`, tone: "neutral" }} href="/company/products?status=published" />
        <KpiCard loading={loading} label="Gem. compleetheid" value={stats && (stats.avgCompleteness == null ? "—" : `${stats.avgCompleteness}%`)} icon={SparkIcon} tone="info" trend={stats && { text: `${formatNumber(stats.complete)} compleet`, tone: "neutral" }} href="/company/products?doc=incompleet" />
        <KpiCard loading={loading} label="QR-codes actief" value={stats && formatNumber(stats.qrActive)} icon={ScanIcon} tone="success" trend={stats && stats.qrReserved > 0 ? { text: `${stats.qrReserved} gereserveerd`, tone: "neutral" } : undefined} href="/company/qr-codes" />
        <KpiCard loading={loading} label="QR-scans (30 d)" value={data && formatNumber(data.scans.last30Days)} icon={ScanIcon} tone="neutral" trend={data && trendText(data.scans.last30Days, data.scans.previous30Days)} href="/company/qr-codes" />
        <KpiCard
          loading={loading}
          label="Documenten"
          value={data && formatNumber(data.documents.total)}
          icon={FileIcon}
          tone={data?.documents.expired ? "danger" : "neutral"}
          trend={data && (data.documents.expired ? { text: `${data.documents.expired} verlopen`, tone: "danger" } : data.documents.expiring ? { text: `${data.documents.expiring} verlopen binnenkort`, tone: "warning" } : { text: `${data.documents.public} openbaar`, tone: "neutral" })}
          href="/company/documenten"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">QR-scans</h2>
              <p className="text-xs text-slate-500">Hoe vaak je productpaspoorten bekeken zijn</p>
            </div>
            <div role="group" aria-label="Periode" className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {[7, 30, 90].map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={days === range}
                  onClick={() => setDays(range)}
                  className={`rounded-md px-2.5 py-1 font-medium ${days === range ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {range} dagen
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : data.scans.total === 0 ? (
            <EmptyState compact icon={ScanIcon} title="Nog geen scans" description="Zodra iemand een QR-code van een gepubliceerd product scant, zie je dat hier." />
          ) : (
            <>
              <LineChart
                label={`QR-scans per dag, laatste ${days} dagen`}
                timestamps={data.scans.series.map((p) => p.day)}
                series={[{ name: "Scans", color: "#059669", values: data.scans.series.map((p) => p.total) }]}
                formatValue={(v) => formatNumber(v)}
                formatTimeShort={(d) => formatDayMonth(d)}
                formatTimeLong={(d) => formatDayMonth(d)}
                height={200}
              />
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Vandaag</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(data.scans.today)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Deze maand</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(data.scans.thisMonth)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Totaal</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(data.scans.total)}</dd>
                </div>
              </dl>
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Acties nodig</h2>
          <p className="mb-3 text-xs text-slate-500">Wat er nog moet gebeuren voor complete paspoorten</p>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : data.actions.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <CheckIcon size={16} />
              {isNew ? "Voeg je eerste product toe om te beginnen." : "Alles is bijgewerkt. Goed bezig!"}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {data.actions.map((action) => {
                const sev = SEVERITY[action.severity] || SEVERITY.info;
                const SevIcon = sev.icon;
                return (
                  <li key={action.key} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${sev.className}`}>
                      <SevIcon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-700">
                      <strong className="tabular-nums text-slate-900">{formatNumber(action.count)}</strong> {action.title}
                    </span>
                    <Link href={action.href} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                      Bekijken
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Recent gewijzigde producten</h2>
            <Link href="/company/products?sort=updated_at&order=desc" className="text-xs font-medium text-emerald-700 hover:underline">
              Alle producten
            </Link>
          </div>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : data.recentProducts.length === 0 ? (
            <EmptyState
              compact
              icon={BoxIcon}
              title="Nog geen producten"
              description="Maak een product aan of importeer je hele catalogus vanuit Excel."
              action={
                <>
                  <ButtonLink href="/company/products/import" size="sm" icon={UploadIcon}>
                    Importeren
                  </ButtonLink>
                  <ButtonLink href="/company/products?new=1" size="sm" variant="accent" icon={PlusIcon}>
                    Product
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">QR</th>
                    <th className="py-2 pr-3 font-medium">Compleetheid</th>
                    <th className="py-2 pr-3 font-medium">Gewijzigd</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Actie</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentProducts.map((product) => (
                    <tr key={product.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-900">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.sku || "Geen SKU"}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={product.status} />
                      </td>
                      <td className="py-2 pr-3">
                        <QrStatusBadge status={product.qr_status} />
                      </td>
                      <td className="py-2 pr-3">
                        <CompletenessBar value={product.completeness} />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{formatDayMonth(product.updated_at)}</td>
                      <td className="py-2 text-right">
                        <Link href={`/company/products/${product.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                          Openen
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Producten per categorie</h2>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : data.categories.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen producten.</p>
            ) : (
              <CategoryBars categories={data.categories} />
            )}
          </Card>
          {data?.topScanned?.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Meest gescand ({days} dagen)</h2>
              <ol className="space-y-1.5 text-sm">
                {data.topScanned.map((product, index) => (
                  <li key={product.id} className="flex items-center gap-2">
                    <span className="w-4 text-xs tabular-nums text-slate-400">{index + 1}</span>
                    <Link href={`/company/products/${product.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-emerald-700">
                      {product.name}
                    </Link>
                    <span className="tabular-nums text-slate-900">{formatNumber(product.scans)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {data?.license && <LicenseCard license={data.license} />}
        </div>
      </div>
    </div>
  );
}

function CategoryBars({ categories }) {
  const max = Math.max(...categories.map((c) => c.total), 1);
  return (
    <ul className="space-y-2">
      {categories.map((c) => {
        const label = c.category === "__other__" ? "Overig" : c.category || "Zonder categorie";
        const href = c.category && c.category !== "__other__" ? `/company/products?category=${encodeURIComponent(c.category)}` : c.category === null ? "/company/products?missing=category" : "/company/products";
        return (
          <li key={label}>
            <Link href={href} className="group block">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={`truncate ${c.category ? "text-slate-700" : "italic text-slate-500"} group-hover:text-emerald-700`}>{label}</span>
                <span className="tabular-nums text-slate-500">{formatNumber(c.total)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(c.total / max) * 100}%` }} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Onboarding({ onboarding, prominent }) {
  return (
    <Card className={prominent ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`${prominent ? "text-lg" : "text-sm"} font-semibold text-slate-900`}>{prominent ? "Welkom bij VeriPasso — aan de slag" : "Aan de slag"}</h2>
          <p className="text-sm text-slate-500">In een paar stappen naar je eerste openbare productpaspoort.</p>
        </div>
        <div className="w-full sm:w-56">
          <ProgressBar value={onboarding.pct} label={`${onboarding.pct}% voltooid`} description={`${onboarding.done}/${onboarding.total}`} />
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {onboarding.steps.map((step, index) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className={`flex h-full items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                step.done ? "border-emerald-200 bg-white" : "border-slate-200 bg-white hover:border-emerald-300"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {step.done ? <CheckIcon size={14} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${step.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}>{step.label}</span>
                <span className="block text-xs text-slate-500">{step.description}</span>
                <span className="sr-only">{step.done ? "(voltooid)" : "(nog te doen)"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function LicenseCard({ license }) {
  const maxPct = Math.max(license.users.pct ?? 0, license.products.pct ?? 0);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Abonnement</h2>
        <LicenseStatusBadge status={license.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {license.plan ? license.plan.name : "Geen plan"} · {formatValidity(license.licenseStart, license.licenseEnd)}
      </p>
      <div className="mt-3 space-y-3">
        <UsageBar label="Producten" {...license.products} />
        <UsageBar label="Gebruikers" {...license.users} />
      </div>
      {(license.status === "Verlopen" || maxPct >= 80) && (
        <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-xs ${license.status === "Verlopen" || maxPct >= 100 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
          {license.status === "Verlopen"
            ? "Abonnement verlopen — nieuwe producten en gebruikers aanmaken is geblokkeerd."
            : maxPct >= 100
              ? "Limiet bereikt — nieuwe producten of gebruikers aanmaken is geblokkeerd."
              : "Je nadert de limiet van je abonnement."}
        </p>
      )}
    </Card>
  );
}
