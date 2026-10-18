"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fetchBlob, saveBlob } from "@/lib/download";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import ProgressBar from "@/components/ui/ProgressBar";
import { CheckCircleIcon, DownloadIcon } from "@/components/ui/icons";

const FORMATS = [
  { key: "png", label: "PNG", help: "Losse afbeeldingen, 1200 px (≈ 10 cm op 300 DPI)" },
  { key: "svg", label: "SVG", help: "Vectorbestanden voor drukwerk en verpakkingsontwerp" }
];

const CHUNK = { png: 500, svg: 2000 };

function nl(n) {
  return Number(n || 0).toLocaleString("nl-NL");
}

// QR-codes van een selectie producten (id's of filter) downloaden als ZIP, in delen
// van max. 500 (PNG) / 2.000 (SVG) per bestand.
export default function QrExportDialog({ open, onClose, selection, count, initialFormat = "png", onDone }) {
  const [format, setFormat] = useState(initialFormat);
  const [symbology, setSymbology] = useState("qr");
  const [generateMissing, setGenerateMissing] = useState(true);
  const [progress, setProgress] = useState(null); // { done, total, part, parts }
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFormat(FORMATS.some((f) => f.key === initialFormat) ? initialFormat : "png");
    setProgress(null);
    setResult(null);
    setError("");
    cancelledRef.current = false;
  }, [open, initialFormat]);

  const busy = Boolean(progress) && !result;

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
      setProgress({ done: 0, total: ids.length, part: 1, parts });
      for (let part = 1; part <= parts; part += 1) {
        if (cancelledRef.current) break;
        const chunk = ids.slice((part - 1) * size, part * size);
        const { blob, filename, headers } = await fetchBlob("/api/qr/codes.zip", {
          body: { ids: chunk, format, symbology, generateMissing, part: parts > 1 ? part : undefined },
          fallbackName: `${symbology === "datamatrix" ? "datamatrix" : "qr"}-codes-${format}.zip`
        });
        saveBlob(blob, filename);
        files += Number(headers.get("x-files-count") || chunk.length);
        done += chunk.length;
        setProgress({ done, total: ids.length, part, parts });
      }
      setResult({ files, parts, cancelled: cancelledRef.current });
      onDone?.();
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      dismissable={!busy}
      title="QR-codes downloaden"
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
            <Button variant="accent" icon={DownloadIcon} onClick={generate}>
              ZIP downloaden
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
            {result.cancelled ? "Gestopt" : "Klaar"}: {nl(result.files)} QR-codes in {result.parts} {result.parts === 1 ? "bestand" : "bestanden"}
          </p>
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
            <legend className="mb-2 text-sm font-medium text-slate-700">Soort code</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { key: "qr", label: "QR-code", help: "Standaard; elke telefoon leest hem." },
                { key: "datamatrix", label: "Data Matrix", help: "Kleiner; voor zakelijke scanners. Telefooncamera's openen hem meestal niet." }
              ].map((s) => (
                <label key={s.key} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${symbology === s.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"}`}>
                  <input type="radio" name="export-symbology" value={s.key} checked={symbology === s.key} onChange={() => setSymbology(s.key)} className="sr-only" />
                  <span className="block font-medium text-slate-900">{s.label}</span>
                  <span className="block text-xs text-slate-500">{s.help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Formaat</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FORMATS.map((f) => (
                <label key={f.key} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${format === f.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"}`}>
                  <input type="radio" name="export-format" value={f.key} checked={format === f.key} onChange={() => setFormat(f.key)} className="sr-only" />
                  <span className="block font-medium text-slate-900">{f.label}</span>
                  <span className="block text-xs text-slate-500">{f.help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={generateMissing} onChange={(e) => setGenerateMissing(e.target.checked)} className="mt-0.5" />
            <span>
              QR-code aanmaken voor producten die er nog geen hebben
              <span className="block text-xs text-slate-500">De code wordt gereserveerd en pas actief zodra het product gepubliceerd is. Zonder dit vinkje worden zulke producten overgeslagen.</span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
