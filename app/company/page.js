"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import KpiCard from "@/components/ui/KpiCard";
import ActionButton from "@/components/ui/ActionButton";
import Skeleton from "@/components/ui/Skeleton";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import CompletenessBar from "@/components/products/CompletenessBar";
import LineChart from "@/components/monitoring/LineChart";
import { ProductStageBadge, QrStatusBadge } from "@/components/products/ProductStatus";
import { PlusIcon, UploadIcon, BoxIcon, QrIcon, ChartIcon, FileIcon, AlertIcon, CheckIcon } from "@/components/ui/icons";
import { formatNumber, formatBytes, formatDate, formatDayMonth } from "@/lib/format";

// Eén vaste serieskleur voor de scans-grafiek (single series: geen legenda nodig,
// de kaarttitel benoemt de reeks).
const SERIES_COLOR = "#2a78d6";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "Goedenacht";
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

function trendText(current, previous, suffix) {
  if (!current && !previous) return null;
  const diff = current - previous;
  return `${diff >= 0 ? "+" : ""}${formatNumber(diff)} ${suffix}`;
}

function ActionsNeeded({ summary }) {
  const items = [
    {
      count: summary.incomplete,
      text: (n) => `${formatNumber(n)} ${n === 1 ? "product is" : "producten zijn"} incompleet`,
      href: "/company/products?doc=incompleet",
      tone: "warning"
    },
    {
      count: summary.missing_documents,
      text: (n) => `${formatNumber(n)} ${n === 1 ? "product mist" : "producten missen"} documenten`,
      href: "/company/documenten",
      tone: "warning"
    },
    {
      count: summary.missing_photo,
      text: (n) => `${formatNumber(n)} ${n === 1 ? "product heeft" : "producten hebben"} geen afbeelding`,
      href: "/company/products?doc=incompleet",
      tone: "info"
    },
    {
      count: summary.ready_to_publish,
      text: (n) => `${formatNumber(n)} ${n === 1 ? "product is" : "producten zijn"} compleet maar nog niet gepubliceerd`,
      href: "/company/products?status=draft&doc=compleet",
      tone: "positive"
    },
    {
      count: summary.drafts_without_qr,
      text: (n) => `${formatNumber(n)} ${n === 1 ? "concept heeft" : "concepten hebben"} nog geen QR-code`,
      href: "/company/qr-codes?qrStatus=none",
      tone: "info"
    }
  ].filter((item) => item.count > 0);

  return (
    <Card className="h-full">
      <h2 className="text-sm font-semibold text-slate-900">Acties nodig</h2>
      {items.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckIcon /> Alles is bijgewerkt. Goed bezig!
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.href + item.count} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-slate-700">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    item.tone === "warning" ? "bg-amber-500" : item.tone === "positive" ? "bg-emerald-500" : "bg-blue-500"
                  }`}
                />
                {item.text(item.count)}
              </span>
              <Link href={item.href} className="shrink-0 text-sm font-medium text-emerald-700 hover:text-emerald-800">
                Bekijken
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Onboarding({ onboarding, isAdmin }) {
  const steps = [
    { done: onboarding.has_logo, label: "Bedrijfsprofiel instellen (logo)", href: isAdmin ? "/company/instellingen" : null },
    { done: onboarding.has_product, label: "Eerste product toevoegen", href: "/company/products" },
    { done: onboarding.has_import, label: "Producten importeren vanuit Excel", href: "/company/import" },
    { done: onboarding.has_qr, label: "Eerste QR-code genereren", href: "/company/qr-codes" },
    { done: onboarding.has_document, label: "Eerste document toevoegen", href: "/company/documenten" }
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Aan de slag met VeriPasso</h2>
          <p className="text-sm text-slate-600">{pct}% voltooid — nog {steps.length - done} {steps.length - done === 1 ? "stap" : "stappen"}.</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-emerald-100" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => {
          const content = (
            <>
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-300"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span className={step.done ? "text-slate-500 line-through" : "text-slate-800"}>{step.label}</span>
            </>
          );
          const classes = "flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm ring-1 ring-slate-200";
          return (
            <li key={step.label}>
              {step.href && !step.done ? (
                <Link href={step.href} className={`${classes} hover:ring-emerald-300`}>
                  {content}
                </Link>
              ) : (
                <div className={classes}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function CategoryBars({ categories }) {
  const max = Math.max(1, ...categories.map((c) => c.n));
  return (
    <ul className="space-y-2.5">
      {categories.map((c) => (
        <li key={c.category} title={`${c.category}: ${formatNumber(c.n)} producten`}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{c.category}</span>
            <span className="tabular-nums text-slate-500">{formatNumber(c.n)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-full rounded-r-[4px] rounded-l-full" style={{ width: `${(c.n / max) * 100}%`, background: SERIES_COLOR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CompanyDashboardPage() {
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState(30);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/api/dashboard/overview"), api.get("/api/auth/me")])
      .then(([overview, user]) => {
        if (!cancelled) {
          setData(overview);
          setMe(user);
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const scanSeries = useMemo(() => (data ? data.scansDaily.slice(-range) : []), [data, range]);
  const isAdmin = me?.role === "company_admin";

  if (error) {
    return <Card className="border-red-200 bg-red-50 text-red-700">Het overzicht kon niet geladen worden: {error}</Card>;
  }

  const s = data?.summary;
  const scansInRange = scanSeries.reduce((sum, d) => sum + d.scans, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            {greeting()}
            {me?.firstName ? ` ${me.firstName}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `Hier is het overzicht van ${data.companyName}.` : "Het overzicht wordt geladen…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton href="/company/import" icon={<UploadIcon />}>
            Importeren
          </ActionButton>
          <ActionButton href="/company/products?new=1" variant="primary" icon={<PlusIcon />}>
            Product
          </ActionButton>
        </div>
      </div>

      {data && <Onboarding onboarding={data.onboarding} isAdmin={isAdmin} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          loading={!data}
          label="Producten"
          value={s && formatNumber(s.total)}
          hint={s && trendText(s.created_this_month, s.created_prev_month, "t.o.v. vorige maand")}
          tone={s && s.created_this_month >= s.created_prev_month ? "positive" : "neutral"}
          href="/company/products"
          icon={<BoxIcon />}
        />
        <KpiCard
          loading={!data}
          label="Gepubliceerd"
          value={s && formatNumber(s.published)}
          hint={s && `${formatNumber(s.drafts)} concept`}
          href="/company/products?status=published"
          icon={<CheckIcon />}
        />
        <KpiCard
          loading={!data}
          label="QR-codes"
          value={s && formatNumber(s.qr_codes)}
          hint={s && s.drafts_without_qr ? `${formatNumber(s.drafts_without_qr)} concepten zonder QR` : null}
          tone="neutral"
          href="/company/qr-codes"
          icon={<QrIcon />}
        />
        <KpiCard
          loading={!data}
          label="QR-scans deze maand"
          value={data && formatNumber(data.scans.this_month)}
          hint={data && trendText(data.scans.this_month, data.scans.prev_month, "t.o.v. vorige maand")}
          tone={data && data.scans.this_month >= data.scans.prev_month ? "positive" : "warning"}
          icon={<ChartIcon />}
        />
        <KpiCard
          loading={!data}
          label="Gem. compleetheid"
          value={s && `${s.avg_completeness}%`}
          hint={s && s.incomplete ? `${formatNumber(s.incomplete)} aandacht nodig` : "Alles compleet"}
          tone={s && s.incomplete ? "warning" : "positive"}
          href="/company/products?doc=incompleet"
        />
        <KpiCard
          loading={!data}
          label="Documenten"
          value={data && formatNumber(data.documents.documents)}
          hint={s && s.missing_documents ? `${formatNumber(s.missing_documents)} producten zonder document` : null}
          tone="warning"
          href="/company/documenten"
          icon={<FileIcon />}
        />
        <KpiCard loading={!data} label="Opslag documenten" value={data && formatBytes(data.documents.storage_bytes)} />
        <KpiCard
          loading={!data}
          label="Totaal scans"
          value={data && formatNumber(data.scans.total)}
          hint={data && `${formatNumber(data.scans.today)} vandaag`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">QR-scans per dag</h2>
              <p className="text-xs text-slate-500">
                {data ? `${formatNumber(scansInRange)} scans in de afgelopen ${range} dagen` : " "}
              </p>
            </div>
            <div role="group" aria-label="Periode" className="inline-flex rounded-lg border border-slate-200 p-0.5">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setRange(days)}
                  aria-pressed={range === days}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === days ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {days} dagen
                </button>
              ))}
            </div>
          </div>
          {!data ? (
            <Skeleton className="h-52 w-full" />
          ) : data.scans.total === 0 ? (
            <div className="grid h-52 place-items-center rounded-lg border border-dashed border-slate-200 text-center text-sm text-slate-500">
              <div>
                Nog geen scans. Zodra klanten een QR-code scannen, zie je hier de trend.
                <div className="mt-2">
                  <Link href="/company/qr-codes" className="font-medium text-emerald-700 hover:text-emerald-800">
                    Naar QR-codes →
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <LineChart
              timestamps={scanSeries.map((d) => d.day)}
              series={[{ name: "Scans", color: SERIES_COLOR, values: scanSeries.map((d) => d.scans) }]}
              label="QR-scans per dag"
              formatValue={formatNumber}
              formatTimeShort={formatDayMonth}
              formatTimeLong={formatDate}
            />
          )}
        </Card>
        {data ? <ActionsNeeded summary={s} /> : <Skeleton className="h-64 w-full" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent gewijzigde producten</h2>
            <Link href="/company/products" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
              Alle producten →
            </Link>
          </div>
          {!data ? (
            <Skeleton className="h-48 w-full" />
          ) : data.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nog geen producten. Voeg er een toe of importeer ze vanuit Excel.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">SKU</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">QR</th>
                    <th className="py-2 pr-3 font-medium">Compleetheid</th>
                    <th className="py-2 pr-4 font-medium">Gewijzigd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recent.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/company/products/${p.id}`} className="font-medium text-slate-900 hover:text-emerald-700">
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{p.sku || "—"}</td>
                      <td className="py-2.5 pr-3">
                        <ProductStageBadge product={p} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <QrStatusBadge product={p} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <CompletenessBar value={p.completeness} />
                      </td>
                      <td className="py-2.5 pr-4 text-slate-500">{formatDate(p.updated_at)}</td>
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
            {!data ? (
              <Skeleton className="h-32 w-full" />
            ) : data.categories.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen producten.</p>
            ) : (
              <CategoryBars categories={data.categories} />
            )}
          </Card>

          {data?.license && (
            <Card>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Abonnement</h2>
                <LicenseStatusBadge status={data.license.status} />
              </div>
              <p className="mt-1 text-sm text-slate-600">{data.license.plan ? data.license.plan.name : "Geen plan"}</p>
              <div className="mt-3 space-y-3">
                <UsageBar label="Producten" {...data.license.products} />
                <UsageBar label="Gebruikers" {...data.license.users} />
              </div>
              {(data.license.products.pct ?? 0) >= 80 && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertIcon size={14} /> Je nadert de productlimiet van je abonnement.
                </p>
              )}
            </Card>
          )}

          {s && s.total > 0 && s.missing_documents / Math.max(1, s.total) >= 0.5 && (
            <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              💡 {Math.round((s.missing_documents / s.total) * 100)}% van je producten heeft nog geen document.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
