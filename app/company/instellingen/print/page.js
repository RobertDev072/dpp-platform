"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  PAPER_PRESETS,
  LAYOUT_PRESETS,
  MEDIA_TYPES,
  PRINTER_TYPES,
  TEMPLATE_PRESETS,
  TEMPLATE_ELEMENTS,
  ERROR_CORRECTION,
  checkSettings,
  defaultSettings,
  computeLayout
} from "@/src/services/printLayout";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import PrintPreview from "@/components/print/PrintPreview";
import { PlusIcon, PrinterIcon } from "@/components/ui/icons";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

function NumberInput({ label, value, onChange, step = 0.5, min = 0, max, suffix = "mm", disabled }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={`${inputClass} pr-10`}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

function SelectInput({ label, value, onChange, options, disabled }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {Object.entries(options).map(([key, def]) => (
          <option key={key} value={key}>
            {typeof def === "string" ? def : def.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children, description }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">{title}</legend>
      {description && <p className="-mt-1 text-xs text-slate-500">{description}</p>}
      {children}
    </fieldset>
  );
}

function ProfileEditor({ initial, readOnly, onSaved, onCancel }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name || "");
  const [purpose, setPurpose] = useState(initial.purpose || "");
  const [isDefault, setIsDefault] = useState(Boolean(initial.isDefault));
  const [settings, setSettings] = useState(() => structuredClone(initial.settings || defaultSettings()));
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const check = useMemo(() => checkSettings(settings), [settings]);
  const layout = computeLayout(settings);

  function update(group, patch) {
    setSettings((prev) => ({ ...prev, [group]: { ...prev[group], ...patch } }));
  }

  function choosePaper(preset) {
    const def = PAPER_PRESETS[preset];
    update("paper", { preset, widthMm: def.widthMm, heightMm: def.heightMm });
    if (preset === "label") {
      update("layout", { preset: "1", columns: 1, rows: 1, marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2, gapXMm: 0, gapYMm: 0 });
    }
  }

  function chooseLayout(preset) {
    const def = LAYOUT_PRESETS[preset];
    update("layout", { preset, columns: def.columns, rows: def.rows });
  }

  function chooseTemplate(preset) {
    update("template", { preset, elements: { ...TEMPLATE_PRESETS[preset].elements } });
  }

  async function save(event) {
    event.preventDefault();
    if (check.errors.length) return;
    setSaving(true);
    try {
      const body = { name, purpose, isDefault, settings };
      const saved = initial.id ? await api.patch(`/api/print-profiles/${initial.id}`, body) : await api.post("/api/print-profiles", body);
      toast.success(`Printprofiel "${saved.name}" opgeslagen`);
      onSaved(saved);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const s = settings;
  const isLabelPrinter = s.paper.preset === "label";

  return (
    <form onSubmit={save} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Section title="Profiel">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Naam <span className="text-red-500">*</span>
              <input required maxLength={100} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Productlabel A4" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Toepassing
              <input maxLength={200} value={purpose} disabled={readOnly} onChange={(e) => setPurpose(e.target.value)} placeholder="Bijv. kleine verpakkingen" className={inputClass} />
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isDefault} disabled={readOnly} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            Standaardprofiel voor dit bedrijf
          </label>
        </Section>

        <Section title="Papier & labels">
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectInput label="Papier/media-formaat" value={s.paper.preset} onChange={choosePaper} options={PAPER_PRESETS} disabled={readOnly} />
            {!isLabelPrinter && (
              <SelectInput label="Labelindeling" value={s.layout.preset} onChange={chooseLayout} options={LAYOUT_PRESETS} disabled={readOnly} />
            )}
            <SelectInput
              label="Oriëntatie"
              value={s.paper.orientation}
              onChange={(v) => update("paper", { orientation: v })}
              options={{ portrait: "Staand", landscape: "Liggend" }}
              disabled={readOnly}
            />
          </div>
          {(s.paper.preset === "custom" || isLabelPrinter) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput label={isLabelPrinter ? "Labelbreedte" : "Paginabreedte"} value={s.paper.widthMm} onChange={(v) => update("paper", { widthMm: v })} disabled={readOnly} />
              <NumberInput label={isLabelPrinter ? "Labelhoogte" : "Paginahoogte"} value={s.paper.heightMm} onChange={(v) => update("paper", { heightMm: v })} disabled={readOnly} />
            </div>
          )}
          {s.layout.preset === "custom" && !isLabelPrinter && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput label="Kolommen" value={s.layout.columns} step={1} min={1} max={10} suffix="" onChange={(v) => update("layout", { columns: Math.round(v) })} disabled={readOnly} />
              <NumberInput label="Rijen" value={s.layout.rows} step={1} min={1} max={20} suffix="" onChange={(v) => update("layout", { rows: Math.round(v) })} disabled={readOnly} />
            </div>
          )}
          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-sm font-medium text-emerald-700 hover:underline" aria-expanded={advanced}>
            {advanced ? "Marges verbergen" : "Marges en tussenruimte aanpassen"}
          </button>
          {advanced && (
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberInput label="Marge boven" value={s.layout.marginTopMm} onChange={(v) => update("layout", { marginTopMm: v })} disabled={readOnly} />
              <NumberInput label="Marge onder" value={s.layout.marginBottomMm} onChange={(v) => update("layout", { marginBottomMm: v })} disabled={readOnly} />
              <NumberInput label="Marge links" value={s.layout.marginLeftMm} onChange={(v) => update("layout", { marginLeftMm: v })} disabled={readOnly} />
              <NumberInput label="Marge rechts" value={s.layout.marginRightMm} onChange={(v) => update("layout", { marginRightMm: v })} disabled={readOnly} />
              <NumberInput label="Tussenruimte horizontaal" value={s.layout.gapXMm} onChange={(v) => update("layout", { gapXMm: v })} disabled={readOnly} />
              <NumberInput label="Tussenruimte verticaal" value={s.layout.gapYMm} onChange={(v) => update("layout", { gapYMm: v })} disabled={readOnly} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectInput label="Media" value={s.media.type} onChange={(v) => update("media", { type: v })} options={MEDIA_TYPES} disabled={readOnly} />
            <SelectInput label="Printertype" value={s.printer.type} onChange={(v) => update("printer", { type: v })} options={PRINTER_TYPES} disabled={readOnly} />
            <NumberInput
              label="Papiergewicht (optioneel)"
              value={s.media.weightGsm ?? ""}
              step={10}
              min={0}
              suffix="g/m²"
              onChange={(v) => update("media", { weightGsm: v ? Math.round(v) : null })}
              disabled={readOnly}
            />
          </div>
        </Section>

        <Section title="QR-code" description="Groter = betrouwbaarder scannen. Advies: minimaal 15–20 mm, donker op licht.">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberInput label="QR-grootte" value={s.qr.sizeMm} min={5} max={300} onChange={(v) => update("qr", { sizeMm: v })} disabled={readOnly} />
            <SelectInput label="Foutcorrectie" value={s.qr.errorCorrection} onChange={(v) => update("qr", { errorCorrection: v })} options={ERROR_CORRECTION} disabled={readOnly} />
            <NumberInput label="Witrand" value={s.qr.quietZoneModules} step={1} min={0} max={10} suffix="mod." onChange={(v) => update("qr", { quietZoneModules: Math.round(v) })} disabled={readOnly} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              QR-kleur
              <input type="color" value={s.qr.color} disabled={readOnly} onChange={(e) => update("qr", { color: e.target.value.toUpperCase() })} className="mt-1 block h-10 w-full rounded-lg border border-slate-300" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Achtergrond
              <input type="color" value={s.qr.background} disabled={readOnly} onChange={(e) => update("qr", { background: e.target.value.toUpperCase() })} className="mt-1 block h-10 w-full rounded-lg border border-slate-300" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Scantekst
              <input maxLength={80} value={s.qr.caption} disabled={readOnly} onChange={(e) => update("qr", { caption: e.target.value })} className={inputClass} />
            </label>
          </div>
        </Section>

        <Section title="Template" description="Kies een voorinstelling of zet zelf elementen aan en uit.">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Template">
            {Object.entries(TEMPLATE_PRESETS).map(([key, def]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={s.template.preset === key}
                disabled={readOnly}
                onClick={() => chooseTemplate(key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  s.template.preset === key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {def.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(TEMPLATE_ELEMENTS).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(s.template.elements[key])}
                  disabled={readOnly}
                  onChange={(e) => update("template", { preset: "custom", elements: { ...s.template.elements, [key]: e.target.checked } })}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                {label}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Export">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput
              label="Standaardformaat"
              value={s.export.format}
              onChange={(v) => update("export", { format: v })}
              options={{ pdf: "PDF — printen", png: "PNG — digitaal", svg: "SVG — drukker/vector" }}
              disabled={readOnly}
            />
            <SelectInput
              label="PNG-resolutie"
              value={String(s.export.dpi)}
              onChange={(v) => update("export", { dpi: Number(v) })}
              options={{ 300: "300 DPI (standaard)", 600: "600 DPI", 150: "150 DPI (scherm)" }}
              disabled={readOnly}
            />
          </div>
          <p className="text-xs text-slate-500">
            Normaal printen → PDF · professionele drukker → PDF of SVG · digitaal gebruik → PNG · verder bewerken → SVG.
          </p>
        </Section>
      </div>

      <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Voorvertoning</p>
        <PrintPreview settings={settings} />
        <dl className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-3 text-sm">
          <dt className="text-slate-500">Pagina</dt>
          <dd className="text-right">{layout.page.width.toFixed(0)} × {layout.page.height.toFixed(0)} mm</dd>
          <dt className="text-slate-500">Labels/pagina</dt>
          <dd className="text-right">{layout.perPage}</dd>
          <dt className="text-slate-500">Label</dt>
          <dd className="text-right">{layout.labelWidth.toFixed(1)} × {layout.labelHeight.toFixed(1)} mm</dd>
          <dt className="text-slate-500">1.000 producten</dt>
          <dd className="text-right">{Math.ceil(1000 / layout.perPage)} pagina&apos;s</dd>
        </dl>
        {check.errors.map((m) => (
          <p key={m} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {m}
          </p>
        ))}
        {check.warnings.map((m) => (
          <p key={m} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠️ {m}
          </p>
        ))}
        {!readOnly && (
          <div className="flex gap-2">
            <ActionButton onClick={onCancel}>Annuleren</ActionButton>
            <button
              type="submit"
              disabled={saving || check.errors.length > 0 || !name.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Opslaan…" : "Profiel opslaan"}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

export default function PrintSettingsPage() {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);

  async function load() {
    const [profiles, user] = await Promise.all([api.get("/api/print-profiles"), api.get("/api/auth/me")]);
    setData(profiles);
    setMe(user);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const isAdmin = me?.role === "company_admin";

  async function remove(profile) {
    const ok = await confirm({
      title: `Printprofiel "${profile.name}" verwijderen?`,
      description: "Bestaande PDF's blijven bestaan; het profiel is daarna niet meer te kiezen.",
      confirmLabel: "Verwijderen",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api.delete(`/api/print-profiles/${profile.id}`);
      toast.success("Printprofiel verwijderd");
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function makeDefault(profile) {
    try {
      await api.patch(`/api/print-profiles/${profile.id}`, { isDefault: true });
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Instellingen"
        title="Print & labels"
        description="Sla printprofielen op voor je labels: papier of labelrol, indeling, QR-formaat en welke gegevens erop staan. Bij het printen kies je daarna alleen nog het profiel."
        actions={
          isAdmin &&
          !editing && (
            <ActionButton variant="primary" icon={<PlusIcon />} onClick={() => setEditing({ name: "", settings: defaultSettings() })}>
              Printprofiel
            </ActionButton>
          )
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}
      {me && !isAdmin && (
        <p className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
          Je kunt deze profielen gebruiken bij het printen; alleen een bedrijfsbeheerder kan ze wijzigen.
        </p>
      )}

      {editing ? (
        <Card>
          <ProfileEditor
            key={editing.id || "new"}
            initial={editing}
            readOnly={!isAdmin}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        </Card>
      ) : !data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          {data.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<PrinterIcon />}
                title="Nog geen printprofielen"
                description="Begin met een voorbeeld hieronder of maak een eigen profiel. Zonder profiel gebruiken we het standaardlabel A4 (3 × 8)."
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((profile) => {
                const layout = computeLayout(profile.settings);
                return (
                  <Card key={profile.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-slate-900">{profile.name}</h2>
                        {profile.purpose && <p className="truncate text-xs text-slate-500">{profile.purpose}</p>}
                      </div>
                      {profile.isDefault && <Badge variant="success">Standaard</Badge>}
                    </div>
                    <div className="mx-auto w-32">
                      <PrintPreview settings={profile.settings} maxFilled={1} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {PAPER_PRESETS[profile.settings.paper.preset]?.label} · {layout.perPage} per pagina · QR {profile.settings.qr.sizeMm} mm ·{" "}
                      {PRINTER_TYPES[profile.settings.printer.type]}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <ActionButton size="sm" onClick={() => setEditing(profile)}>
                        {isAdmin ? "Bewerken" : "Bekijken"}
                      </ActionButton>
                      {isAdmin && !profile.isDefault && (
                        <ActionButton size="sm" variant="ghost" onClick={() => makeDefault(profile)}>
                          Maak standaard
                        </ActionButton>
                      )}
                      {isAdmin && (
                        <ActionButton size="sm" variant="danger" onClick={() => remove(profile)}>
                          Verwijderen
                        </ActionButton>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {isAdmin && (
            <Card>
              <h2 className="text-sm font-semibold text-slate-900">Beginnen vanuit een voorbeeld</h2>
              <p className="mb-3 text-sm text-slate-500">Kies een voorbeeld; je kunt alles daarna aanpassen voordat je opslaat.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.examples.map((example) => (
                  <button
                    key={example.name}
                    type="button"
                    onClick={() => setEditing({ ...example })}
                    className="rounded-xl border border-slate-200 p-3 text-left hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <span className="block text-sm font-medium text-slate-900">{example.name}</span>
                    <span className="block text-xs text-slate-500">{example.purpose}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
          <p className="text-sm text-slate-500">
            Printen doe je vanuit{" "}
            <Link href="/company/qr-codes" className="font-medium text-emerald-700 hover:underline">
              QR-codes
            </Link>{" "}
            (één of duizenden labels tegelijk) of vanuit de QR-tab van een product.
          </p>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
