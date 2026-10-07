"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { downloadCsv, dateStamp } from "@/lib/download";
import { IMPORT_FIELDS } from "@/src/services/importFields";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";
import { UploadIcon, DownloadIcon, HistoryIcon } from "@/components/ui/icons";
import { formatDateTime } from "@/lib/format";

const STATUS = {
  running: { label: "Bezig", variant: "info" },
  completed: { label: "Voltooid", variant: "success" },
  completed_with_errors: { label: "Met fouten", variant: "warning" },
  failed: { label: "Mislukt", variant: "danger" },
  cancelled: { label: "Afgebroken", variant: "neutral" }
};
const DUPLICATE_LABELS = { skip: "Bestaande overslaan", update: "Bestaande bijwerken", create: "Altijd nieuw" };
const FIELD_LABEL = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f.label]));

function JobDetail({ jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(`/api/imports/${jobId}`).then(setJob).catch((err) => setError(err.message));
  }, [jobId]);

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{job?.file_name || "Import"}</h2>
          {job && (
            <p className="text-sm text-slate-500">
              {formatDateTime(job.created_at)} · {job.created_by_email || "onbekend"} · {DUPLICATE_LABELS[job.duplicate_mode]}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Detail sluiten" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
          ✕
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!job ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Rijen", job.total_rows],
              ["Toegevoegd", job.created_count],
              ["Bijgewerkt", job.updated_count],
              ["Overgeslagen", job.skipped_count],
              ["Fouten", job.error_count]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2.5">
                <div className="text-lg font-bold tabular-nums text-slate-900">{Number(value).toLocaleString("nl-NL")}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          {job.errors?.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Fouten</h3>
                <ActionButton
                  size="sm"
                  icon={<DownloadIcon size={14} />}
                  onClick={() =>
                    downloadCsv(
                      `importfouten-${job.id}-${dateStamp()}.csv`,
                      ["Rij", "Product", "Veld", "Fout", "Suggestie"],
                      job.errors.map((e) => [e.row, e.product, FIELD_LABEL[e.field] || e.field || "", e.error, e.suggestion || ""])
                    )
                  }
                >
                  Foutbestand
                </ActionButton>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Rij</th>
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 font-medium">Fout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {job.errors.slice(0, 200).map((e, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 tabular-nums text-slate-500">{e.row}</td>
                        <td className="max-w-48 truncate py-1.5 pr-3 text-slate-700">{e.product || "—"}</td>
                        <td className="py-1.5 pr-3 text-red-700">
                          {e.error}
                          {e.suggestion && <span className="block text-xs text-slate-500">{e.suggestion}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-emerald-700">✓ Geen fouten in deze import.</p>
          )}
        </>
      )}
    </Card>
  );
}

function ImportCenterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const openJob = searchParams.get("job");

  useEffect(() => {
    api
      .get(`/api/imports?page=${page}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Center"
        description="Alle eerdere imports met resultaten en foutrapporten."
        actions={
          <ActionButton href="/company/import" variant="primary" icon={<UploadIcon />}>
            Importeren
          </ActionButton>
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}
      {openJob && <JobDetail key={openJob} jobId={openJob} onClose={() => router.replace("/company/imports")} />}

      <Card>
        {!data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon />}
            title="Nog geen imports"
            description="Importeer producten vanuit Excel of CSV; elke import verschijnt hier met het resultaat."
            action={<ActionButton href="/company/import" variant="primary">Eerste import starten</ActionButton>}
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Datum</th>
                    <th className="py-2 pr-3 font-medium">Bestand</th>
                    <th className="py-2 pr-3 text-right font-medium">Rijen</th>
                    <th className="py-2 pr-3 font-medium">Resultaat</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">
                      <span className="sr-only">Actie</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((job) => {
                    const status = STATUS[job.status] || STATUS.running;
                    return (
                      <tr key={job.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDateTime(job.created_at)}</td>
                        <td className="max-w-64 truncate py-2.5 pr-3 font-medium text-slate-900" title={job.file_name}>
                          {job.file_name}
                          <span className="block text-xs font-normal text-slate-500">{job.created_by_email}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{job.total_rows.toLocaleString("nl-NL")}</td>
                        <td className="py-2.5 pr-3 text-xs text-slate-600">
                          +{job.created_count} · ↻{job.updated_count} · ↷{job.skipped_count}
                          {job.error_count ? <span className="text-red-700"> · ✕{job.error_count}</span> : null}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          <button
                            type="button"
                            onClick={() => router.replace(`/company/imports?job=${job.id}`)}
                            className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                          >
                            {job.error_count ? "Resultaat" : "Bekijken"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.total > data.pageSize && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <p className="text-sm text-slate-500">
                  Pagina {page} van {totalPages}
                </p>
                <div className="flex gap-2">
                  <ActionButton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Vorige
                  </ActionButton>
                  <ActionButton disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Volgende
                  </ActionButton>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

export default function ImportCenterPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ImportCenterInner />
    </Suspense>
  );
}
