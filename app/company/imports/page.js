"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { ButtonLink } from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import ProgressBar from "@/components/ui/ProgressBar";
import { DownloadIcon, UploadIcon } from "@/components/ui/icons";

const STATUS = {
  pending: ["neutral", "Kolommen koppelen"],
  validating: ["info", "Klaar om te importeren"],
  importing: ["warning", "Onderbroken"],
  completed: ["success", "Voltooid"],
  failed: ["danger", "Mislukt"],
  cancelled: ["neutral", "Geannuleerd"]
};

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

export default function ImportCenterPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setError("");
    api
      .get(`/api/products/import?page=${page}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Center"
        description="Alle productimports van je bedrijf: status, resultaat en foutrapporten. Onderbroken imports kun je hier hervatten."
        actions={
          <>
            <ButtonLink href="/api/products/import/template.xlsx" icon={DownloadIcon}>
              Excel-template
            </ButtonLink>
            <ButtonLink href="/company/products/import" variant="accent" icon={UploadIcon}>
              Importeren
            </ButtonLink>
          </>
        }
      />

      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-700">We konden de imports niet laden: {error}</Card>}

      <Card>
        {!data && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={UploadIcon}
            title="Nog geen imports"
            description="Importeer je productcatalogus vanuit Excel of CSV. Hier zie je daarna elke import terug."
            action={
              <ButtonLink href="/company/products/import" variant="accent" size="sm" icon={UploadIcon}>
                Eerste import starten
              </ButtonLink>
            }
          />
        ) : data ? (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Datum</th>
                    <th className="py-2 pr-3 font-medium">Bestand</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Voortgang</th>
                    <th className="py-2 pr-3 text-right font-medium">Rijen</th>
                    <th className="py-2 pr-3 text-right font-medium">Toegevoegd</th>
                    <th className="py-2 pr-3 text-right font-medium">Bijgewerkt</th>
                    <th className="py-2 pr-3 text-right font-medium">Fouten</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Acties</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((job) => {
                    const [variant, label] = STATUS[job.status] || STATUS.pending;
                    const pct = job.total_rows ? (job.processed_rows / job.total_rows) * 100 : 0;
                    return (
                      <tr key={job.id} className="border-b border-slate-100">
                        <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">{formatDateTime(job.created_at)}</td>
                        <td className="max-w-[16rem] py-2.5 pr-3">
                          <p className="truncate font-medium text-slate-900" title={job.filename}>
                            {job.filename}
                          </p>
                          {job.created_by_email && <p className="truncate text-xs text-slate-500">{job.created_by_email}</p>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={job.status === "completed" && job.error_count ? "warning" : variant}>{job.status === "completed" && job.error_count ? "Met fouten" : label}</Badge>
                        </td>
                        <td className="w-36 py-2.5 pr-3">
                          <ProgressBar value={pct} tone={job.status === "completed" ? "success" : "info"} />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{nl(job.total_rows)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{nl(job.created_count)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{nl(job.updated_count)}</td>
                        <td className={`py-2.5 pr-3 text-right tabular-nums ${job.error_count ? "text-red-700" : ""}`}>{nl(job.error_count)}</td>
                        <td className="py-2.5 text-right">
                          <span className="inline-flex gap-1.5">
                            {(job.error_count > 0 || job.warning_count > 0) && (
                              <a href={`/api/products/import/${job.id}/errors.csv`} title="Foutrapport downloaden" aria-label="Foutrapport downloaden" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                                <DownloadIcon size={16} />
                              </a>
                            )}
                            <Link href={`/company/products/import?id=${job.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                              {["pending", "validating", "importing"].includes(job.status) ? "Verdergaan" : "Bekijken"}
                            </Link>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
                <span>
                  Pagina {page} van {totalPages}
                </span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Vorige
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Volgende
                  </Button>
                </span>
              </div>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}
