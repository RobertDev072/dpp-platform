"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { ButtonLink } from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import FileDropzone from "@/components/ui/FileDropzone";
import ProgressBar from "@/components/ui/ProgressBar";
import Skeleton from "@/components/ui/Skeleton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AlertIcon, CheckCircleIcon, CheckIcon, ChevronLeftIcon, DownloadIcon, ErrorIcon, FileIcon, RefreshIcon, UploadIcon } from "@/components/ui/icons";

const STEPS = [
  { key: "upload", label: "Bestand" },
  { key: "mapping", label: "Kolommen" },
  { key: "review", label: "Controle" },
  { key: "import", label: "Importeren" },
  { key: "result", label: "Resultaat" }
];

const STRATEGIES = [
  { key: "skip", label: "Overslaan", help: "Bestaande producten (zelfde SKU of GTIN) blijven ongewijzigd. Veiligste keuze." },
  { key: "update", label: "Bestaand product bijwerken", help: "Ingevulde cellen overschrijven de huidige gegevens. Lege cellen wissen niets; status en QR-code blijven ongewijzigd." },
  { key: "create", label: "Nieuw product maken", help: "Er komt een extra product bij, ook als de SKU of GTIN al bestaat." }
];

const ACTION_BADGES = {
  create: ["success", "Nieuw"],
  update: ["info", "Bijwerken"],
  skip: ["neutral", "Overslaan"],
  error: ["danger", "Fout"]
};

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

function Stepper({ current }) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol aria-label="Importstappen" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs sm:text-sm">
      {STEPS.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2" aria-current={i === index ? "step" : undefined}>
          {i > 0 && <span aria-hidden="true" className={`h-px w-4 sm:w-8 ${i <= index ? "bg-emerald-400" : "bg-slate-200"}`} />}
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i < index ? "bg-emerald-600 text-white" : i === index ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
            {i < index ? <CheckIcon size={12} /> : i + 1}
          </span>
          <span className={i === index ? "font-medium text-slate-900" : "text-slate-500"}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ImportWizard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const confirm = useConfirm();
  const jobId = searchParams.get("id");

  const [fields, setFields] = useState(null);
  const [job, setJob] = useState(null);
  const [step, setStep] = useState(jobId ? null : "upload");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [mapping, setMapping] = useState([]);
  const [strategy, setStrategy] = useState("skip");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    api.get("/api/products/import/fields").then(setFields).catch((err) => setError(err));
  }, []);

  const setJobId = useCallback(
    (id) => {
      router.replace(id ? `${pathname}?id=${id}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const runValidation = useCallback(async (id, columnMapping, duplicateStrategy) => {
    setValidating(true);
    setError(null);
    try {
      const result = await api.post(`/api/products/import/${id}/validate`, { columnMapping, duplicateStrategy });
      setValidation(result);
      setStep("review");
    } catch (err) {
      setError(err);
    } finally {
      setValidating(false);
    }
  }, []);

  // Hervatten na een refresh of vanuit het Import Center: de job bepaalt de stap.
  useEffect(() => {
    if (!jobId || job?.id === Number(jobId)) return;
    let cancelled = false;
    api
      .get(`/api/products/import/${jobId}`)
      .then((data) => {
        if (cancelled) return;
        setJob(data);
        setMapping(data.column_mapping || []);
        setStrategy(data.duplicate_strategy || "skip");
        if (data.status === "pending") setStep("mapping");
        else if (data.status === "validating") runValidation(data.id, data.column_mapping, data.duplicate_strategy || "skip");
        else if (data.status === "importing") setStep("import");
        else setStep("result");
      })
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [jobId, job, runValidation]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api.upload("/api/products/import", formData);
      setJob(data);
      setMapping(data.column_mapping || []);
      setStep("mapping");
      setJobId(data.id);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function runImport() {
    setRunning(true);
    setRunError("");
    stopRef.current = false;
    setStep("import");
    try {
      let current = job;
      // Eén chunk (250 rijen) per request; de server onthoudt de voortgang, dus na een
      // fout of refresh gaat "Hervatten" verder zonder rijen dubbel te verwerken.
      for (;;) {
        current = await api.post(`/api/products/import/${job.id}/run`);
        setJob(current);
        if (current.done || ["completed", "cancelled", "failed"].includes(current.status)) break;
        if (stopRef.current) break;
      }
      if (current.status === "completed") {
        setStep("result");
        toast.success("Import voltooid");
      }
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function cancelImport() {
    const ok = await confirm({
      title: "Import annuleren?",
      message: "Producten die al zijn geïmporteerd blijven bestaan. De overige rijen worden niet meer verwerkt.",
      confirmLabel: "Import annuleren",
      tone: "danger"
    });
    if (!ok) return;
    stopRef.current = true;
    try {
      const data = await api.post(`/api/products/import/${job.id}/cancel`);
      setJob(data);
      setStep("result");
    } catch (err) {
      toast.error(err.message);
    }
  }

  function restart() {
    setJob(null);
    setFile(null);
    setValidation(null);
    setMapping([]);
    setStrategy("skip");
    setError(null);
    setRunError("");
    setStep("upload");
    setJobId(null);
  }

  const fieldOptions = fields?.fields || [];
  const mappedName = mapping.includes("name");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/company/products" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeftIcon size={14} /> Producten
        </Link>
        <PageHeader
          title="Producten importeren"
          description="Importeer honderden of duizenden producten in één keer vanuit Excel (.xlsx, .xls) of CSV. Je controleert alles voordat er iets wordt opgeslagen."
          actions={
            <>
              <ButtonLink href="/company/imports" variant="ghost">
                Import Center
              </ButtonLink>
              <ButtonLink href="/api/products/import/template.xlsx" icon={DownloadIcon}>
                Excel-template
              </ButtonLink>
            </>
          }
        />
      </div>

      {step && <Stepper current={step} />}
      <FormError error={error} />

      {!step && <Skeleton className="h-64 w-full" />}

      {step === "upload" && (
        <Card className="space-y-4">
          <FileDropzone
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            extensions={["xlsx", "xls", "csv"]}
            maxSizeMb={fields?.maxFileMb || 4}
            file={file}
            onFile={setFile}
            onClear={() => setFile(null)}
            disabled={uploading}
            error={uploadError}
            label="Sleep je Excel- of CSV-bestand hierheen"
            hint={`.xlsx, .xls of .csv — max ${fields?.maxFileMb || 4} MB en ${nl(fields?.maxRows || 10000)} producten per bestand`}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Nog geen bestand?{" "}
              <a href="/api/products/import/template.xlsx" className="font-medium text-emerald-700 hover:underline">
                Download het template
              </a>{" "}
              met uitleg per kolom. Eigen kolomnamen (bijv. &quot;Artikelnummer&quot; of &quot;EAN&quot;) worden herkend.
            </p>
            <Button variant="accent" icon={UploadIcon} onClick={handleUpload} disabled={!file} loading={uploading}>
              {uploading ? "Analyseren…" : "Bestand analyseren"}
            </Button>
          </div>
        </Card>
      )}

      {step === "mapping" && job && (
        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Kolommen koppelen</h2>
                <p className="text-xs text-slate-500">
                  <FileIcon size={12} className="mr-1 inline" />
                  {job.filename} · {nl(job.total_rows)} rijen gevonden. Controleer de automatische koppeling.
                </p>
              </div>
              <span className="text-xs text-slate-500">{mapping.filter(Boolean).length} van {job.headers.length} kolommen gekoppeld</span>
            </div>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Kolom in je bestand</th>
                    <th className="py-2 pr-3 font-medium">Voorbeeld</th>
                    <th className="py-2 pr-3 font-medium">VeriPasso-veld</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Status</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {job.headers.map((header, index) => {
                    const used = new Set(mapping.filter((m, i) => m && i !== index));
                    const value = mapping[index] || "";
                    return (
                      <tr key={`${header}-${index}`} className="border-b border-slate-100">
                        <td className="py-2 pr-3 font-medium text-slate-900">{header}</td>
                        <td className="max-w-[14rem] truncate py-2 pr-3 text-slate-500" title={(job.sample || []).map((r) => r[index]).filter(Boolean).join(" · ")}>
                          {(job.sample || []).map((r) => r[index]).find(Boolean) || <span className="text-slate-300">leeg</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            aria-label={`Veld voor kolom ${header}`}
                            value={value}
                            onChange={(e) => setMapping((prev) => prev.map((m, i) => (i === index ? e.target.value || null : m)))}
                            className={`w-full rounded-lg border bg-white px-2 py-1.5 text-sm ${value ? "border-slate-300" : "border-amber-300"}`}
                          >
                            <option value="">Niet importeren</option>
                            {fieldOptions.map((f) => (
                              <option key={f.key} value={f.key} disabled={used.has(f.key)}>
                                {f.label}
                                {f.required ? " *" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 text-center">
                          {value ? <CheckIcon size={16} className="text-emerald-600" /> : <AlertIcon size={16} className="text-amber-500" />}
                          <span className="sr-only">{value ? "gekoppeld" : "niet gekoppeld"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!mappedName && <p className="mt-3 text-sm text-red-600">Koppel een kolom aan &quot;Productnaam&quot;; dat veld is verplicht.</p>}
          </Card>

          <Card>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-900">Als een product al bestaat (zelfde SKU of GTIN)</legend>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {STRATEGIES.map((s) => (
                  <label key={s.key} className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm ${strategy === s.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"}`}>
                    <input type="radio" name="duplicate-strategy" value={s.key} checked={strategy === s.key} onChange={() => setStrategy(s.key)} className="sr-only" />
                    <span className="block font-medium text-slate-900">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{s.help}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={restart}>
              Ander bestand
            </Button>
            <Button variant="accent" onClick={() => runValidation(job.id, mapping, strategy)} disabled={!mappedName} loading={validating}>
              {validating ? "Controleren…" : "Controleren"}
            </Button>
          </div>
        </div>
      )}

      {step === "review" && job && validation && (
        <ReviewStep
          job={job}
          validation={validation}
          strategy={strategy}
          onBack={() => setStep("mapping")}
          onImport={runImport}
        />
      )}

      {step === "import" && job && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{running ? "Bezig met importeren…" : "Import gepauzeerd"}</h2>
            <span className="text-xs text-slate-500">{job.filename}</span>
          </div>
          <ProgressBar value={(job.processed_rows / Math.max(1, job.total_rows)) * 100} label="Voortgang" description={`${nl(job.processed_rows)} / ${nl(job.total_rows)}`} />
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Toegevoegd" value={job.created_count} tone="text-emerald-700" />
            <Stat label="Bijgewerkt" value={job.updated_count} tone="text-blue-700" />
            <Stat label="Overgeslagen" value={job.skipped_count} />
            <Stat label="Fouten" value={job.error_count} tone={job.error_count ? "text-red-700" : undefined} />
          </dl>
          {runError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              De import is onderbroken: {runError}. Er is niets dubbel opgeslagen; je kunt veilig hervatten.
            </p>
          )}
          {running ? (
            <p className="text-xs text-slate-500">Je kunt dit venster open laten. Sluit je het, dan kun je later verdergaan via het Import Center.</p>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={cancelImport}>
                Import annuleren
              </Button>
              <Button variant="accent" icon={RefreshIcon} onClick={runImport}>
                {job.processed_rows > 0 ? "Hervatten" : "Starten"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {step === "result" && job && <ResultStep job={job} onRestart={restart} />}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone || "text-slate-900"}`}>{nl(value)}</dd>
    </div>
  );
}

function ReviewStep({ job, validation, strategy, onBack, onImport }) {
  const { summary, blocking, preview, issues, issueCount } = validation;
  const willProcess = summary.toCreate + summary.toUpdate;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold text-slate-900">{nl(summary.total)} rijen gecontroleerd</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Geldig" value={summary.valid} tone="text-emerald-700" />
          <Stat label="Waarschuwingen" value={summary.warnings} tone={summary.warnings ? "text-amber-700" : undefined} />
          <Stat label="Fouten" value={summary.errors} tone={summary.errors ? "text-red-700" : undefined} />
          <Stat label="Al bestaand" value={summary.duplicates} />
          <Stat label="Nieuw" value={summary.toCreate} tone="text-emerald-700" />
          <Stat label={strategy === "update" ? "Bijwerken" : "Overslaan"} value={strategy === "update" ? summary.toUpdate : summary.toSkip} />
        </dl>
        {blocking.map((message) => (
          <p key={message} role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertIcon size={16} className="mt-0.5" />
            {message}
          </p>
        ))}
        {summary.errors > 0 && <p className="mt-3 text-sm text-slate-600">Rijen met een fout worden niet geïmporteerd. Download het foutrapport, corrigeer de rijen en importeer ze daarna opnieuw.</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Voorbeeld (eerste {preview.length} rijen)</h2>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Rij</th>
                <th className="py-2 pr-3 font-medium">Actie</th>
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 font-medium">SKU / GTIN</th>
                <th className="py-2 pr-3 font-medium">Categorie</th>
                <th className="py-2 font-medium">Opmerkingen</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => {
                const [variant, label] = ACTION_BADGES[row.action] || ACTION_BADGES.create;
                return (
                  <tr key={row.row} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 tabular-nums text-slate-500">{row.row}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={variant}>{label}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.values.name || <span className="italic text-slate-400">geen naam</span>}</td>
                    <td className="py-2 pr-3 text-slate-600">{[row.values.sku, row.values.gtin].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">{row.values.category || "—"}</td>
                    <td className="py-2 text-xs">
                      {row.issues.map((issue, i) => (
                        <p key={i} className={issue.severity === "error" ? "text-red-700" : "text-amber-700"}>
                          {issue.message}
                        </p>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {issueCount > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Fouten en waarschuwingen ({nl(issueCount)})</h2>
            <ButtonLink href={`/api/products/import/${job.id}/errors.csv`} size="sm" icon={DownloadIcon}>
              Foutrapport (CSV)
            </ButtonLink>
          </div>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
            {issues.map((issue, i) => (
              <li key={i} className="flex gap-3 py-1.5">
                <span className="w-14 shrink-0 tabular-nums text-slate-500">Rij {issue.row}</span>
                {issue.severity === "error" ? <ErrorIcon size={16} className="mt-0.5 text-red-600" /> : <AlertIcon size={16} className="mt-0.5 text-amber-500" />}
                <span className="min-w-0">
                  <span className="text-slate-800">
                    {issue.fieldLabel}: {issue.message}
                  </span>
                  {issue.suggestion && <span className="block text-xs text-slate-500">{issue.suggestion}</span>}
                </span>
              </li>
            ))}
          </ul>
          {issueCount > issues.length && <p className="mt-2 text-xs text-slate-500">Eerste {issues.length} getoond; het foutrapport bevat alles.</p>}
        </Card>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          Terug naar kolommen
        </Button>
        <Button variant="accent" onClick={onImport} disabled={willProcess === 0}>
          {willProcess === 0 ? "Niets te importeren" : `${nl(willProcess)} producten importeren`}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({ job, onRestart }) {
  const cancelled = job.status === "cancelled";
  return (
    <Card className="space-y-4 text-center">
      {cancelled ? <AlertIcon size={40} className="mx-auto text-amber-500" /> : <CheckCircleIcon size={40} className="mx-auto text-emerald-600" />}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{cancelled ? "Import geannuleerd" : job.error_count ? "Import voltooid met fouten" : "Import voltooid"}</h2>
        <p className="text-sm text-slate-500">{job.filename}</p>
      </div>
      <dl className="mx-auto grid max-w-2xl grid-cols-2 gap-2 text-left text-sm sm:grid-cols-4">
        <Stat label="Toegevoegd" value={job.created_count} tone="text-emerald-700" />
        <Stat label="Bijgewerkt" value={job.updated_count} tone="text-blue-700" />
        <Stat label="Overgeslagen" value={job.skipped_count} />
        <Stat label="Fouten" value={job.error_count} tone={job.error_count ? "text-red-700" : undefined} />
      </dl>
      <p className="text-xs text-slate-500">Geïmporteerde producten staan als concept klaar; publiceren doe je zelf, na controle.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href="/company/products?sort=created_at&order=desc" variant="accent">
          Bekijk producten
        </ButtonLink>
        {(job.error_count > 0 || job.warning_count > 0) && (
          <ButtonLink href={`/api/products/import/${job.id}/errors.csv`} icon={DownloadIcon}>
            Download foutbestand
          </ButtonLink>
        )}
        <Button variant="outline" onClick={onRestart}>
          Nieuwe import
        </Button>
      </div>
    </Card>
  );
}

export default function ImportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ImportWizard />
    </Suspense>
  );
}
