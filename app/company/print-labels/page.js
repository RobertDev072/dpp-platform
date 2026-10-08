"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fetchBlob } from "@/lib/download";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AlertIcon, CopyIcon, EditIcon, ErrorIcon, EyeIcon, PlusIcon, PrinterIcon, TrashIcon } from "@/components/ui/icons";

const PRINTER_TYPES = [
  ["laser", "Laserprinter (A4)"],
  ["inkjet", "Inkjetprinter"],
  ["label", "Labelprinter"],
  ["thermal", "Thermische printer"],
  ["professional", "Professionele drukker"],
  ["pdf", "Alleen PDF-export"]
];
const PAPERS = [
  ["A4", "A4 (210 × 297 mm)"],
  ["A5", "A5 (148 × 210 mm)"],
  ["A6", "A6 (105 × 148 mm)"],
  ["Letter", "Letter (216 × 279 mm)"],
  ["custom", "Aangepast formaat"]
];
const LAYOUTS = [
  ["1x1", "1 label per pagina"],
  ["2x4", "2 × 4 (8 per vel)"],
  ["2x7", "2 × 7 (14 per vel)"],
  ["2x8", "2 × 8 (16 per vel)"],
  ["3x7", "3 × 7 (21 per vel)"],
  ["3x8", "3 × 8 (24 per vel)"],
  ["3x9", "3 × 9 (27 per vel)"],
  ["4x6", "4 × 6 (24 per vel)"],
  ["custom", "Aangepast raster"]
];
const MEDIA = [
  ["plain", "Normaal papier"],
  ["matte", "Mat papier"],
  ["glossy", "Glanzend papier"],
  ["sticker", "Stickerpapier"],
  ["transparent", "Transparante sticker"],
  ["thermal", "Thermisch papier"],
  ["cardboard", "Karton"],
  ["custom", "Anders"]
];
const TEMPLATES = [
  ["qr_only", "Alleen QR", "QR-code met optionele scantekst"],
  ["qr_name", "QR + naam", "Productnaam boven de QR-code"],
  ["qr_name_sku", "QR + naam + SKU", "Voor magazijn en verpakking"],
  ["qr_name_category", "QR + naam + categorie", "Voor schappen en catalogi"],
  ["compact", "Compact", "QR links, naam en SKU rechts"],
  ["standard", "Standaard", "Naam, QR, SKU, GTIN en scantekst"],
  ["professional", "Professioneel", "Logo, details en CE/recyclebaar"],
  ["custom", "Aangepast", "Kies zelf welke elementen"]
];
const ELEMENTS = [
  ["logo", "Bedrijfslogo"],
  ["name", "Productnaam"],
  ["sku", "SKU"],
  ["gtin", "GTIN"],
  ["category", "Categorie"],
  ["manufacturer", "Fabrikant"],
  ["country", "Land van oorsprong"],
  ["ce", "CE-markering"],
  ["recyclable", "Recyclebaar"],
  ["scanText", "Scantekst"]
];

const LABEL = Object.fromEntries([...PRINTER_TYPES, ...PAPERS, ...LAYOUTS, ...MEDIA, ...TEMPLATES.map(([k, l]) => [k, l])]);

function mm(n) {
  return `${Number(n).toFixed(1).replace(".", ",").replace(",0", "")} mm`;
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Schematische weergave van één pagina: raster, marges en QR-plek per label.
function SheetPreview({ summary }) {
  if (!summary?.layout || !(summary.layout.cellW > 0)) return null;
  const { pageW, pageH, columns, rows, marginTop, marginSide, gapX, gapY, cellW, cellH } = summary.layout;
  const qr = Math.min(summary.settings.qr.sizeMm, cellW, cellH);
  const horizontal = summary.settings.template !== "qr_only" && (["compact", "professional"].includes(summary.settings.template) || cellW > cellH * 1.6);
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = marginSide + c * (cellW + gapX);
      const y = marginTop + r * (cellH + gapY);
      const pad = Math.min(2, cellW * 0.05);
      const qx = horizontal ? x + pad : x + (cellW - qr) / 2;
      const qy = horizontal ? y + (cellH - qr) / 2 : y + (cellH - qr) / 2;
      cells.push(
        <g key={`${r}-${c}`}>
          <rect x={x} y={y} width={cellW} height={cellH} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.3} strokeDasharray="1 1" />
          <rect x={qx} y={qy} width={qr} height={qr} fill="#0f172a" opacity={0.85} />
          {horizontal && cellW - qr - 3 * pad > 4 && (
            <>
              <rect x={qx + qr + pad} y={qy + qr * 0.15} width={(cellW - qr - 3 * pad) * 0.8} height={Math.max(0.8, qr * 0.1)} fill="#64748b" />
              <rect x={qx + qr + pad} y={qy + qr * 0.35} width={(cellW - qr - 3 * pad) * 0.55} height={Math.max(0.6, qr * 0.07)} fill="#cbd5e1" />
            </>
          )}
        </g>
      );
    }
  }
  return (
    <figure>
      <svg viewBox={`0 0 ${pageW} ${pageH}`} role="img" aria-label={`Schema: ${columns} × ${rows} labels op ${Math.round(pageW)} × ${Math.round(pageH)} mm`} className="mx-auto max-h-80 w-full rounded border border-slate-300 bg-slate-100">
        <rect x={0} y={0} width={pageW} height={pageH} fill="#f8fafc" />
        {cells}
      </svg>
      <figcaption className="mt-1 text-center text-xs text-slate-500">
        Pagina {Math.round(pageW)} × {Math.round(pageH)} mm · label {mm(cellW)} × {mm(cellH)}
      </figcaption>
    </figure>
  );
}

function Messages({ summary }) {
  if (!summary) return null;
  const list = [...summary.errors.map((m) => ["error", m]), ...summary.warnings.map((m) => ["warning", m])];
  if (!list.length) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">QR-code is goed scanbaar met deze instellingen.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {list.map(([kind, message]) => (
        <li key={message} className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm ${kind === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {kind === "error" ? <ErrorIcon size={16} className="mt-0.5 shrink-0" /> : <AlertIcon size={16} className="mt-0.5 shrink-0" />}
          {message}
        </li>
      ))}
    </ul>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 0.5, suffix = "mm", id }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600">
        <input id={id} type="number" min={min} max={max} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="w-full min-w-0 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none" />
        {suffix && <span className="pr-2.5 text-xs text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

function SelectInput({ label, value, onChange, options, id }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProfileEditor({ open, initial, templateElements, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open || !initial) return;
    setName(initial.name || "");
    setDescription(initial.description || "");
    setIsDefault(Boolean(initial.is_default));
    setSettings(initial.settings);
    setFormError(null);
    setSummary(null);
  }, [open, initial]);

  const debounced = useDebounced(settings, 350);
  const requestRef = useRef(0);
  useEffect(() => {
    if (!open || !debounced) return;
    const id = ++requestRef.current;
    api
      .post("/api/print/summary", { settings: debounced, productCount: 1000 })
      .then((data) => id === requestRef.current && setSummary(data))
      .catch((err) => id === requestRef.current && setSummary({ errors: [err.message], warnings: [] }));
  }, [debounced, open]);

  if (!settings) return null;
  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const setQr = (key, value) => setSettings((prev) => ({ ...prev, qr: { ...prev.qr, [key]: value } }));
  const isLabelPrinter = ["label", "thermal"].includes(settings.printerType);
  const elements = settings.template === "custom" ? { ...templateElements.standard, ...(settings.elements || {}) } : templateElements[settings.template] || {};

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      const body = { name: name.trim(), description: description.trim() || null, isDefault, settings };
      if (initial.id) await api.put(`/api/print/profiles/${initial.id}`, body);
      else await api.post("/api/print/profiles", body);
      toast.success("Printprofiel opgeslagen");
      onSaved();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    try {
      const { blob } = await fetchBlob("/api/print/preview.pdf", { body: { settings } });
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={initial.id ? "Printprofiel bewerken" : "Nieuw printprofiel"}
      description="Papier, labelindeling, printer en QR-instellingen. Rechts zie je direct het resultaat."
      footer={
        <>
          <Button variant="outline" icon={EyeIcon} onClick={preview} loading={previewing} disabled={summary?.errors?.length > 0}>
            Voorbeeld-PDF
          </Button>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button variant="accent" onClick={save} loading={saving} disabled={!name.trim()}>
            Opslaan
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <FormError error={formError} />
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="pp-name" className="block text-xs font-medium text-slate-600">
                Naam <span className="text-red-500">*</span>
              </label>
              <input id="pp-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Productlabel A4 – 3×8" className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pp-desc" className="block text-xs font-medium text-slate-600">
                Toepassing
              </label>
              <input id="pp-desc" value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} placeholder="Bijv. kleine verpakking, magazijn" className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Standaardprofiel (wordt voorgeselecteerd bij printen)
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Printer &amp; papier</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectInput id="pp-printer" label="Printertype" value={settings.printerType} onChange={(v) => set("printerType", v)} options={PRINTER_TYPES} />
              <SelectInput id="pp-media" label="Media" value={settings.media} onChange={(v) => set("media", v)} options={MEDIA} />
              {isLabelPrinter ? (
                <>
                  <NumberInput id="pp-lw" label="Labelbreedte" value={settings.labelWidthMm} min={10} max={300} onChange={(v) => set("labelWidthMm", v)} />
                  <NumberInput id="pp-lh" label="Labelhoogte" value={settings.labelHeightMm} min={10} max={300} onChange={(v) => set("labelHeightMm", v)} />
                </>
              ) : (
                <>
                  <SelectInput id="pp-paper" label="Papierformaat" value={settings.paper} onChange={(v) => set("paper", v)} options={PAPERS} />
                  <SelectInput id="pp-orient" label="Oriëntatie" value={settings.orientation} onChange={(v) => set("orientation", v)} options={[["portrait", "Staand"], ["landscape", "Liggend"]]} />
                  {settings.paper === "custom" && (
                    <>
                      <NumberInput id="pp-pw" label="Papierbreedte" value={settings.paperWidthMm} min={20} max={1000} onChange={(v) => set("paperWidthMm", v)} />
                      <NumberInput id="pp-ph" label="Papierhoogte" value={settings.paperHeightMm} min={20} max={1000} onChange={(v) => set("paperHeightMm", v)} />
                    </>
                  )}
                </>
              )}
              {settings.media !== "thermal" && (
                <NumberInput id="pp-gsm" label="Gramgewicht (optioneel)" value={settings.mediaWeightGsm} min={40} max={1000} step={1} suffix="g/m²" onChange={(v) => set("mediaWeightGsm", v)} />
              )}
            </div>
          </section>

          {!isLabelPrinter && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Labelindeling</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectInput id="pp-layout" label="Labels per vel" value={settings.layout} onChange={(v) => set("layout", v)} options={LAYOUTS} />
                {settings.layout === "custom" && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput id="pp-cols" label="Kolommen" value={settings.columns} min={1} max={10} step={1} suffix="" onChange={(v) => set("columns", v)} />
                    <NumberInput id="pp-rows" label="Rijen" value={settings.rows} min={1} max={30} step={1} suffix="" onChange={(v) => set("rows", v)} />
                  </div>
                )}
              </div>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Marges</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumberInput id="pp-mt" label="Boven/onder" value={settings.marginTopMm} min={0} max={50} onChange={(v) => set("marginTopMm", v ?? 0)} />
              <NumberInput id="pp-ms" label="Links/rechts" value={settings.marginSideMm} min={0} max={50} onChange={(v) => set("marginSideMm", v ?? 0)} />
              {!isLabelPrinter && (
                <>
                  <NumberInput id="pp-gx" label="Tussenruimte hor." value={settings.gapXMm} min={0} max={30} onChange={(v) => set("gapXMm", v ?? 0)} />
                  <NumberInput id="pp-gy" label="Tussenruimte vert." value={settings.gapYMm} min={0} max={30} onChange={(v) => set("gapYMm", v ?? 0)} />
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">QR-code</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberInput id="pp-qr" label="Grootte" value={settings.qr.sizeMm} min={5} max={200} onChange={(v) => setQr("sizeMm", v ?? 5)} />
              <SelectInput
                id="pp-ecc"
                label="Foutcorrectie"
                value={settings.qr.errorCorrection}
                onChange={(v) => setQr("errorCorrection", v)}
                options={[["L", "Laag (L, 7%)"], ["M", "Middel (M, 15%) — aanbevolen"], ["Q", "Hoog (Q, 25%)"], ["H", "Zeer hoog (H, 30%)"]]}
              />
              <NumberInput id="pp-qz" label="Witte rand (blokjes)" value={settings.qr.quietZoneModules} min={0} max={10} step={1} suffix="" onChange={(v) => setQr("quietZoneModules", v ?? 0)} />
              <div>
                <label htmlFor="pp-color" className="block text-xs font-medium text-slate-600">
                  QR-kleur
                </label>
                <input id="pp-color" type="color" value={settings.qr.color} onChange={(e) => setQr("color", e.target.value.toUpperCase())} className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
              </div>
              <div>
                <label htmlFor="pp-bg" className="block text-xs font-medium text-slate-600">
                  Achtergrond
                </label>
                <input id="pp-bg" type="color" value={settings.qr.background} onChange={(e) => setQr("background", e.target.value.toUpperCase())} className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Template</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map(([key, label, help]) => (
                <label key={key} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${settings.template === key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"}`}>
                  <input type="radio" name="pp-template" value={key} checked={settings.template === key} onChange={() => set("template", key)} className="sr-only" />
                  <span className="block font-medium text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{help}</span>
                </label>
              ))}
            </div>
            <fieldset className="mt-3" disabled={settings.template !== "custom"}>
              <legend className="mb-1 text-xs font-medium text-slate-600">Elementen op het label {settings.template !== "custom" && "(kies 'Aangepast' om te wijzigen)"}</legend>
              <div className="flex flex-wrap gap-2">
                {ELEMENTS.map(([key, label]) => (
                  <label key={key} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${elements[key] ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"} ${settings.template !== "custom" ? "opacity-70" : "cursor-pointer"}`}>
                    <input type="checkbox" className="h-3 w-3" checked={Boolean(elements[key])} onChange={(e) => set("elements", { ...elements, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="pp-scan" className="block text-xs font-medium text-slate-600">
                  Scantekst
                </label>
                <input id="pp-scan" value={settings.scanText} maxLength={60} onChange={(e) => set("scanText", e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600" />
              </div>
              <NumberInput id="pp-font" label="Tekstgrootte" value={settings.fontSizePt} min={5} max={24} step={0.5} suffix="pt" onChange={(v) => set("fontSizePt", v ?? 8)} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={settings.showCutLines} onChange={(e) => set("showCutLines", e.target.checked)} />
              Snijlijnen rond elk label printen
            </label>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          {!summary ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <>
              <SheetPreview summary={summary} />
              {summary.layout && (
                <dl className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
                  <div>
                    <dt className="text-slate-500">Per pagina</dt>
                    <dd className="text-base font-semibold tabular-nums">{summary.perPage}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">1.000 producten</dt>
                    <dd className="text-base font-semibold tabular-nums">{summary.pages} p.</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">QR-blokje</dt>
                    <dd className="text-base font-semibold tabular-nums">{summary.moduleMm ? summary.moduleMm.toFixed(2).replace(".", ",") : "—"} mm</dd>
                  </div>
                </dl>
              )}
              <Messages summary={summary} />
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
}

export default function PrintLabelsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.get("/api/auth/me").then(setMe).catch(() => {});
    api.get("/api/print/options").then(setOptions).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api
      .get("/api/print/profiles")
      .then(setProfiles)
      .catch((err) => setError(err.message));
  }, [reload]);

  const canEdit = me?.role === "company_admin";
  const templateElements = useMemo(() => options?.templateElements || {}, [options]);

  async function remove(profile) {
    const ok = await confirm({ title: `"${profile.name}" verwijderen?`, message: "Het profiel is daarna niet meer te kiezen bij het printen.", confirmLabel: "Verwijderen", tone: "danger" });
    if (!ok) return;
    try {
      await api.delete(`/api/print/profiles/${profile.id}`);
      toast.success("Profiel verwijderd");
      setReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function makeDefault(profile) {
    try {
      await api.put(`/api/print/profiles/${profile.id}`, { name: profile.name, description: profile.description, isDefault: true, settings: profile.settings });
      toast.success(`"${profile.name}" is nu het standaardprofiel`);
      setReload((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Print & labels"
        description="Leg vast hoe je QR-labels geprint worden: papier, labelindeling, printer, QR-formaat en wat er op het label staat. Profielen kies je daarna bij elk printmoment."
        actions={
          canEdit && options ? (
            <Button variant="accent" icon={PlusIcon} onClick={() => setEditing({ name: "", settings: options.presets[0].settings })}>
              Printprofiel
            </Button>
          ) : null
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>}
      {me && !canEdit && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Alleen een bedrijfsbeheerder kan printprofielen aanmaken of wijzigen. Je kunt ze wel gebruiken bij het printen.</p>}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Profielen van je bedrijf</h2>
        {!profiles ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : profiles.length === 0 ? (
          <Card>
            <EmptyState icon={PrinterIcon} title="Nog geen eigen printprofielen" description={canEdit ? "Begin met een van de standaardprofielen hieronder en pas het aan op je eigen labels." : "De standaardprofielen hieronder zijn direct te gebruiken."} />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                name={profile.name}
                description={profile.description}
                settings={profile.settings}
                summary={profile.summary}
                isDefault={profile.is_default}
                actions={
                  canEdit && (
                    <>
                      <button type="button" onClick={() => setEditing(profile)} title="Bewerken" aria-label={`${profile.name} bewerken`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                        <EditIcon size={16} />
                      </button>
                      <button type="button" onClick={() => setEditing({ ...profile, id: undefined, is_default: false, name: `${profile.name} (kopie)` })} title="Dupliceren" aria-label={`${profile.name} dupliceren`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                        <CopyIcon size={16} />
                      </button>
                      <button type="button" onClick={() => remove(profile)} title="Verwijderen" aria-label={`${profile.name} verwijderen`} className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600">
                        <TrashIcon size={16} />
                      </button>
                      {!profile.is_default && (
                        <button type="button" onClick={() => makeDefault(profile)} className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                          Maak standaard
                        </button>
                      )}
                    </>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Standaardprofielen</h2>
        <p className="mb-3 text-xs text-slate-500">Direct bruikbaar bij het printen{canEdit ? "; of gebruik ze als startpunt voor een eigen profiel" : ""}.</p>
        {!options ? (
          <Skeleton className="h-36 w-full" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {options.presets.map((preset) => (
              <ProfileCard
                key={preset.key}
                name={preset.name}
                description={preset.description}
                settings={preset.settings}
                actions={
                  canEdit && (
                    <Button variant="outline" size="sm" icon={CopyIcon} onClick={() => setEditing({ name: preset.name, description: preset.description, settings: preset.settings })}>
                      Als basis gebruiken
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <Card className="text-sm text-slate-600">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Welk exportformaat?</h2>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li>• Normaal printen → <strong>PDF</strong> met een printprofiel</li>
          <li>• Professionele drukker → <strong>PDF of SVG</strong> (vector)</li>
          <li>• Digitaal gebruik → <strong>PNG</strong> (300 DPI)</li>
          <li>• Verder bewerken in ontwerpsoftware → <strong>SVG</strong></li>
        </ul>
      </Card>

      {editing && options && (
        <ProfileEditor
          open
          initial={editing}
          templateElements={templateElements}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function ProfileCard({ name, description, settings, summary, isDefault, actions }) {
  const isLabelPrinter = ["label", "thermal"].includes(settings.printerType);
  const format = isLabelPrinter ? `${settings.labelWidthMm} × ${settings.labelHeightMm} mm` : `${LABEL[settings.paper] ? settings.paper : "Aangepast"} · ${settings.layout === "custom" ? `${settings.columns} × ${settings.rows}` : settings.layout.replace("x", " × ")}`;
  const problems = summary ? summary.errors.length + summary.warnings.length : 0;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{name}</p>
          {description && <p className="truncate text-xs text-slate-500">{description}</p>}
        </div>
        {isDefault && <Badge variant="success">Standaard</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Formaat</dt>
        <dd className="text-slate-800">{format}</dd>
        <dt className="text-slate-500">Printer</dt>
        <dd className="text-slate-800">{LABEL[settings.printerType]}</dd>
        <dt className="text-slate-500">QR-code</dt>
        <dd className="text-slate-800">
          {settings.qr.sizeMm} mm · niveau {settings.qr.errorCorrection}
        </dd>
        <dt className="text-slate-500">Template</dt>
        <dd className="text-slate-800">{LABEL[settings.template]}</dd>
      </dl>
      {summary && problems > 0 && (
        <p className={`flex items-center gap-1 text-xs ${summary.errors.length ? "text-red-700" : "text-amber-700"}`}>
          <AlertIcon size={14} /> {summary.errors.length ? "Niet printbaar: " + summary.errors[0] : summary.warnings[0]}
        </p>
      )}
      {actions && <div className="mt-auto flex items-center gap-1 border-t border-slate-100 pt-2">{actions}</div>}
    </Card>
  );
}
