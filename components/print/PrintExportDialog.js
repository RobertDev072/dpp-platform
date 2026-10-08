"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fetchBlob, saveBlob } from "@/lib/download";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import ProgressBar from "@/components/ui/ProgressBar";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, CheckCircleIcon, ErrorIcon, PrinterIcon } from "@/components/ui/icons";

const FORMATS = [
  { key: "pdf", label: "PDF-labels", help: "Voor printen op vellen of een labelprinter" },
  { key: "png", label: "PNG (ZIP)", help: "Losse afbeeldingen, 1200 px (≈ 10 cm op 300 DPI)" },
  { key: "svg", label: "SVG (ZIP)", help: "Vectorbestanden voor drukwerk en ontwerp" }
];

const CHUNK = { pdf: 500, png: 500, svg: 2000 };

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

// Bulk printen/exporteren voor een selectie producten (id's of filter).
// Flow: formaat + printprofiel → controle (pagina's, labels, QR-grootte,
// waarschuwingen) → voorbeeld → genereren in delen van max. 500 → downloaden.
export default function PrintExportDialog({ open, onClose, selection, count, initialFormat = "pdf", onDone }) {
  const toast = useToast();
  const [format, setFormat] = useState(initialFormat);
  const [profiles, setProfiles] = useState(null);
  const [presets, setPresets] = useState([]);
  const [source, setSource] = useState(null); // { profileId } | { presetKey }
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [generateMissing, setGenerateMissing] = useState(true);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, part, parts }
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFormat(initialFormat);
    setProgress(null);
    setResult(null);
    setError("");
    cancelledRef.current = false;
    Promise.all([api.get("/api/print/profiles"), api.get("/api/print/options")])
      .then(([saved, options]) => {
        setProfiles(saved);
        setPresets(options.presets);
        const def = saved.find((p) => p.is_default) || saved[0];
        setSource(def ? { profileId: def.id } : { presetKey: options.presets[0].key });
      })
      .catch((err) => setError(err.message));
  }, [open, initialFormat]);

  useEffect(() => {
    if (!open || !source || format !== "pdf") return;
    let cancelled = false;
    setSummary(null);
    setSummaryError("");
    api
      .post("/api/print/summary", { ...source, productCount: count })
      .then((data) => !cancelled && setSummary(data))
      .catch((err) => !cancelled && setSummaryError(err.message));
    return () => {
      cancelled = true;
    };
  }, [open, source, format, count]);

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const sourceKey = source ? (source.profileId ? `p:${source.profileId}` : `s:${source.presetKey}`) : "";
  const blocking = format === "pdf" && summary?.errors?.length > 0;
  const busy = Boolean(progress) && !result;

  async function showPreview() {
    setPreviewLoading(true);
    try {
      const ids = selection.ids ? selection.ids.slice(0, 40) : (await api.post("/api/products/bulk/resolve", { selection })).ids.slice(0, 40);
      const { blob } = await fetchBlob("/api/print/preview.pdf", { body: { ...source, productIds: ids } });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function generate() {
    setError("");
    setResult(null);
    cancelledRef.current = false;
    try {
      const { ids } = selection.ids ? { ids: selection.ids } : await api.post("/api/products/bulk/resolve", { selection });
      if (!ids.length) throw new Error("Er zijn geen producten geselecteerd.");
      const size = CHUNK[format];
      const parts = Math.ceil(ids.length / size);
      let done = 0;
      let files = 0;
      let skipped = 0;
      setProgress({ done: 0, total: ids.length, part: 1, parts });
      for (let part = 1; part <= parts; part += 1) {
        if (cancelledRef.current) break;
        const chunk = ids.slice((part - 1) * size, part * size);
        const partNumber = parts > 1 ? part : undefined;
        const { blob, filename, headers } =
          format === "pdf"
            ? await fetchBlob("/api/print/labels.pdf", { body: { ...source, ids: chunk, generateMissing, part: partNumber }, fallbackName: `labels-${String(part).padStart(3, "0")}.pdf` })
            : await fetchBlob("/api/print/qr.zip", { body: { ids: chunk, format, generateMissing, part: partNumber }, fallbackName: `qr-codes-${format}.zip` });
        saveBlob(blob, filename);
        files += Number(headers.get("x-labels-count") || headers.get("x-files-count") || chunk.length);
        skipped += Number(headers.get("x-labels-skipped") || 0);
        done += chunk.length;
        setProgress({ done, total: ids.length, part, parts });
      }
      setResult({ files, skipped, parts, cancelled: cancelledRef.current });
      onDone?.();
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  }

  const selectedPreset = useMemo(() => {
    if (!source) return null;
    if (source.profileId) return profiles?.find((p) => p.id === source.profileId);
    return presets.find((p) => p.key === source.presetKey);
  }, [source, profiles, presets]);

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      dismissable={!busy}
      size="lg"
      title={format === "pdf" ? "Labels printen" : "QR-codes downloaden"}
      description={`${nl(count)} ${count === 1 ? "product" : "producten"} geselecteerd`}
      footer={
        result ? (
          <Button variant="accent" onClick={onClose}>
            Sluiten
          </Button>
        ) : busy ? (
          <Button variant="outline" onClick={() => (cancelledRef.current = true)}>
            Stoppen na dit deel
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Annuleren
            </Button>
            <Button variant="accent" icon={PrinterIcon} onClick={generate} disabled={!source || blocking || (format === "pdf" && !summary)}>
              {format === "pdf" ? "PDF genereren" : "ZIP downloaden"}
            </Button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result ? (
        <div className="py-4 text-center">
          <CheckCircleIcon size={40} className="mx-auto text-emerald-600" />
          <p className="mt-3 text-base font-semibold text-slate-900">
            {result.cancelled ? "Gestopt" : "Klaar"}: {nl(result.files)} {format === "pdf" ? "labels" : "QR-codes"} in {result.parts} {result.parts === 1 ? "bestand" : "bestanden"}
          </p>
          {result.skipped > 0 && <p className="mt-1 text-sm text-amber-700">{nl(result.skipped)} producten overgeslagen (geen QR-code).</p>}
          <p className="mt-1 text-sm text-slate-500">De bestanden staan in je downloadmap.</p>
        </div>
      ) : busy ? (
        <div className="py-6">
          <ProgressBar
            value={(progress.done / progress.total) * 100}
            label={progress.parts > 1 ? `Deel ${progress.part} van ${progress.parts}` : "Bezig met genereren…"}
            description={`${nl(progress.done)} / ${nl(progress.total)}`}
          />
          <p className="mt-3 text-xs text-slate-500">Houd dit venster open. Grote selecties worden in delen van {nl(CHUNK[format])} producten gemaakt.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Formaat</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {FORMATS.map((f) => (
                <label key={f.key} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${format === f.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"}`}>
                  <input type="radio" name="export-format" value={f.key} checked={format === f.key} onChange={() => setFormat(f.key)} className="sr-only" />
                  <span className="block font-medium text-slate-900">{f.label}</span>
                  <span className="block text-xs text-slate-500">{f.help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {format === "pdf" && (
            <div>
              <label htmlFor="print-profile" className="mb-1 block text-sm font-medium text-slate-700">
                Printprofiel
              </label>
              {!profiles ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <select
                  id="print-profile"
                  value={sourceKey}
                  onChange={(e) => {
                    const [kind, value] = e.target.value.split(":");
                    setPreviewUrl("");
                    setSource(kind === "p" ? { profileId: Number(value) } : { presetKey: value });
                  }}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                >
                  {profiles.length > 0 && (
                    <optgroup label="Profielen van je bedrijf">
                      {profiles.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name}
                          {p.is_default ? " (standaard)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Standaardprofielen">
                    {presets.map((p) => (
                      <option key={p.key} value={`s:${p.key}`}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              )}
              {selectedPreset?.description && <p className="mt-1 text-xs text-slate-500">{selectedPreset.description}</p>}
              <p className="mt-1 text-xs text-slate-500">
                Eigen profielen beheer je onder{" "}
                <Link href="/company/print-labels" className="font-medium text-emerald-700 hover:underline">
                  Print &amp; labels
                </Link>
                .
              </p>
            </div>
          )}

          {format === "pdf" &&
            (summaryError ? (
              <p className="text-sm text-red-600">{summaryError}</p>
            ) : !summary ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">Producten</dt>
                    <dd className="font-semibold tabular-nums">{nl(summary.productCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Labels per pagina</dt>
                    <dd className="font-semibold tabular-nums">{summary.perPage}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Pagina&apos;s</dt>
                    <dd className="font-semibold tabular-nums">{nl(summary.pages)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">QR-grootte</dt>
                    <dd className="font-semibold tabular-nums">{summary.settings.qr.sizeMm} mm</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  Label {summary.layout.cellW.toFixed(1).replace(".", ",")} × {summary.layout.cellH.toFixed(1).replace(".", ",")} mm op{" "}
                  {summary.layout.pageW.toFixed(0)} × {summary.layout.pageH.toFixed(0)} mm
                  {summary.productCount > CHUNK.pdf ? ` · wordt opgesplitst in ${Math.ceil(summary.productCount / CHUNK.pdf)} PDF's` : ""}
                </p>
                {[...summary.errors.map((m) => ["error", m]), ...summary.warnings.map((m) => ["warning", m])].map(([kind, message]) => (
                  <p key={message} className={`mt-2 flex items-start gap-1.5 text-sm ${kind === "error" ? "text-red-700" : "text-amber-700"}`}>
                    {kind === "error" ? <ErrorIcon size={16} className="mt-0.5" /> : <AlertIcon size={16} className="mt-0.5" />}
                    {message}
                  </p>
                ))}
              </div>
            ))}

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={generateMissing} onChange={(e) => setGenerateMissing(e.target.checked)} className="mt-0.5" />
            <span>
              QR-code aanmaken voor producten die er nog geen hebben
              <span className="block text-xs text-slate-500">De code wordt gereserveerd en pas actief zodra het product gepubliceerd is. Zonder dit vinkje worden zulke producten overgeslagen.</span>
            </span>
          </label>

          {format === "pdf" && summary && !blocking && (
            <div>
              {previewUrl ? (
                <div>
                  <iframe title="Voorbeeld van de eerste pagina" src={previewUrl} className="h-80 w-full rounded-lg border border-slate-200 bg-white" />
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline">
                    Voorbeeld in nieuw tabblad openen
                  </a>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={showPreview} loading={previewLoading}>
                  Voorbeeld van de eerste pagina
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
