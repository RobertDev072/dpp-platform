"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { downloadBlob, dateStamp } from "@/lib/download";
import { buildLabelsPdf, buildQrZip } from "@/lib/print/labelPdf";
import { checkSettings, defaultSettings, computeLayout } from "@/src/services/printLayout";
import PrintPreview from "@/components/print/PrintPreview";
import ProgressBar from "@/components/ui/ProgressBar";

// Printworkflow voor één of duizenden producten:
//   profiel kiezen → voorvertoning (formaat, labels/pagina, aantal pagina's) →
//   genereren met voortgang → downloaden.
// loadItems(onProgress) levert de productgegevens incl. de officiële qr_url.
export default function PrintDialog({ count, loadItems, onClose, initialMode = "pdf" }) {
  const [profiles, setProfiles] = useState(null);
  const [profileId, setProfileId] = useState("");
  const [mode, setMode] = useState(initialMode);
  const [phase, setPhase] = useState("setup"); // setup | loading | generating | done | error
  const [progress, setProgress] = useState({ value: 0, max: count });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/api/print-profiles"), api.get("/api/auth/me")])
      .then(([data, user]) => {
        setProfiles(data.items);
        setMe(user);
        const def = data.items.find((p) => p.isDefault) || data.items[0];
        setProfileId(def ? String(def.id) : "builtin");
      })
      .catch((err) => setError(err.message));
  }, []);

  // Voorvertoning met de eerste echte producten van de selectie.
  useEffect(() => {
    loadItems(() => {}, 3)
      .then((items) => setPreview(items.filter((i) => i.qr_url).slice(0, 3)))
      .catch(() => setPreview([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profile = profiles?.find((p) => String(p.id) === profileId);
  const settings = useMemo(() => profile?.settings || defaultSettings(), [profile]);
  const check = useMemo(() => checkSettings(settings), [settings]);
  const layout = computeLayout(settings);
  const pages = Math.max(1, Math.ceil(count / layout.perPage));

  async function handleGenerate() {
    setError("");
    try {
      setPhase("loading");
      setProgress({ value: 0, max: count });
      const items = await loadItems((loaded) => setProgress({ value: loaded, max: count }));
      const printable = items.filter((i) => i.qr_url);
      const skipped = items.length - printable.length;
      if (!printable.length) {
        setError("Geen van de geselecteerde producten heeft een QR-code. Genereer eerst QR-codes.");
        setPhase("error");
        return;
      }
      setPhase("generating");
      setProgress({ value: 0, max: printable.length });
      const onProgress = (value) => setProgress({ value, max: printable.length });
      let blob;
      let fileName;
      if (mode === "pdf") {
        blob = await buildLabelsPdf({ items: printable, settings, logoDataUrl: me?.companyLogo, onProgress });
        fileName = `labels-${dateStamp()}.pdf`;
      } else {
        blob = await buildQrZip({ items: printable, format: mode, settings, onProgress });
        fileName = `qr-codes-${mode}-${dateStamp()}.zip`;
      }
      setResult({ blob, fileName, count: printable.length, skipped });
      setPhase("done");
      downloadBlob(blob, fileName);
    } catch (err) {
      setError(err.message || "Genereren mislukt");
      setPhase("error");
    }
  }

  const busy = phase === "loading" || phase === "generating";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-dialog-title"
        className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="print-dialog-title" className="text-lg font-semibold text-slate-900">
              {mode === "pdf" ? "PDF-labels maken" : "QR-codes downloaden"}
            </h2>
            <p className="text-sm text-slate-500">
              {count.toLocaleString("nl-NL")} {count === 1 ? "product" : "producten"} geselecteerd
            </p>
          </div>
          {!busy && (
            <button type="button" onClick={onClose} aria-label="Sluiten" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              ✕
            </button>
          )}
        </div>

        {!profiles && !error ? (
          <div className="mt-6 h-40 animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              <div role="radiogroup" aria-label="Exportformaat" className="grid grid-cols-3 gap-2">
                {[
                  { key: "pdf", label: "PDF-labels", help: "Printen" },
                  { key: "png", label: "PNG (ZIP)", help: `Digitaal, ${settings.export.dpi} DPI` },
                  { key: "svg", label: "SVG (ZIP)", help: "Drukker / vector" }
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={mode === option.key}
                    disabled={busy}
                    onClick={() => setMode(option.key)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm ${
                      mode === option.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className="block font-medium text-slate-900">{option.label}</span>
                    <span className="block text-xs text-slate-500">{option.help}</span>
                  </button>
                ))}
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Printprofiel
                <select
                  value={profileId}
                  disabled={busy}
                  onChange={(event) => setProfileId(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {profiles?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? " (standaard)" : ""}
                    </option>
                  ))}
                  <option value="builtin">Standaard VeriPasso (A4, 3 × 8)</option>
                </select>
              </label>
              <p className="text-xs text-slate-500">
                Formaten, marges en QR-instellingen beheer je onder{" "}
                <Link href="/company/instellingen/print" className="font-medium text-emerald-700 hover:underline">
                  Instellingen → Print & labels
                </Link>
                .
              </p>

              {mode === "pdf" && (
                <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                  <dt className="text-slate-500">Paginaformaat</dt>
                  <dd className="text-right text-slate-900">
                    {layout.page.width.toFixed(0)} × {layout.page.height.toFixed(0)} mm
                  </dd>
                  <dt className="text-slate-500">Labels per pagina</dt>
                  <dd className="text-right text-slate-900">
                    {layout.perPage} ({layout.columns} × {layout.rows})
                  </dd>
                  <dt className="text-slate-500">Labelformaat</dt>
                  <dd className="text-right text-slate-900">
                    {layout.labelWidth.toFixed(1)} × {layout.labelHeight.toFixed(1)} mm
                  </dd>
                  <dt className="text-slate-500">QR-grootte</dt>
                  <dd className="text-right text-slate-900">{settings.qr.sizeMm} mm</dd>
                  <dt className="font-medium text-slate-700">Resultaat</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {count.toLocaleString("nl-NL")} producten → {pages.toLocaleString("nl-NL")} {pages === 1 ? "pagina" : "pagina's"}
                  </dd>
                </dl>
              )}

              {check.errors.map((message) => (
                <p key={message} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {message}
                </p>
              ))}
              {check.warnings.map((message) => (
                <p key={message} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  ⚠️ {message}
                </p>
              ))}

              {busy && (
                <ProgressBar
                  label={phase === "loading" ? "Productgegevens ophalen" : mode === "pdf" ? "Labels tekenen" : "QR-codes maken"}
                  value={progress.value}
                  max={progress.max}
                />
              )}
              {phase === "done" && result && (
                <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  ✓ {result.count.toLocaleString("nl-NL")} {mode === "pdf" ? "labels" : "QR-codes"} gegenereerd
                  {result.skipped ? ` (${result.skipped} zonder QR-code overgeslagen)` : ""}.
                  <button type="button" onClick={() => downloadBlob(result.blob, result.fileName)} className="ml-2 font-medium underline">
                    Opnieuw downloaden
                  </button>
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Voorvertoning</p>
              {mode === "pdf" ? (
                <PrintPreview settings={settings} items={preview || []} />
              ) : (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  Elke QR-code wordt een los bestand ({mode.toUpperCase()}), met SKU en productnaam als bestandsnaam.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {phase === "done" ? "Sluiten" : "Annuleren"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !profiles || (mode === "pdf" && check.errors.length > 0)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Bezig…" : mode === "pdf" ? "PDF genereren" : "ZIP downloaden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Haalt productgegevens (incl. officiële QR-URL) op voor een lijst ids, in blokken.
export function loaderForIds(ids) {
  return async (onProgress, limit) => {
    const wanted = limit ? ids.slice(0, limit) : ids;
    const items = [];
    for (let i = 0; i < wanted.length; i += 500) {
      const data = await api.post("/api/qr/items", { ids: wanted.slice(i, i + 500) });
      items.push(...data.items);
      onProgress(items.length);
    }
    return items;
  };
}
