"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fetchBlob, saveBlob } from "@/lib/download";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

const STATUS = {
  none: ["neutral", "Niet aangemeld"],
  queued: ["neutral", "Niet aangemeld"],
  submitted: ["info", "Ingediend"],
  registered: ["success", "Geregistreerd"],
  rejected: ["warning", "Afgewezen"],
  failed: ["warning", "Afgewezen"]
};

const REGISTRY_URL = "https://registry.product-passport.ec.europa.eu/";

// EU DPP-register. De klant registreert zelf (na verificatie met EU Login en een
// gekwalificeerd elektronisch zegel); VeriPasso levert de registratiegegevens, controleert
// ze zoals het register dat doet en bewaart wat het register teruggaf.
export default function RegistryCard({ product }) {
  const toast = useToast();
  const [reg, setReg] = useState(null);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState({ status: "registered", registryUri: "", correlationId: "", errorCode: "", errorMessage: "" });

  useEffect(() => {
    api.get(`/api/products/${product.id}/registration`).then(setReg).catch(() => setReg(null));
  }, [product.id]);

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await api.get(`/api/products/${product.id}/registration/check`));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function download(granularity) {
    try {
      const { blob, filename } = await fetchBlob(`/api/products/${product.id}/registration/records?granularity=${granularity}`, {
        method: "GET",
        fallbackName: `registratie-${granularity}.csv`
      });
      saveBlob(blob, filename);
    } catch (err) {
      const issues = err.details?.issues;
      toast.error(issues?.length ? `${err.message}: ${issues[0].message} (${issues[0].upi})` : err.message);
    }
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      setReg(await api.patch(`/api/products/${product.id}/registration`, outcome));
      toast.success("Uitkomst van het register opgeslagen");
    } catch (err) {
      toast.error(err.details?.fieldErrors?.registryUri?.[0] || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt");
    }
  }

  const [variant, label] = STATUS[reg?.status || "none"] || STATUS.none;
  const published = Boolean(product.published_at);
  const record = reg?.record;
  const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm";

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">EU DPP-register</h2>
        <Badge variant={variant}>{label}</Badge>
      </div>
      <p className="text-sm text-slate-600">
        Je bedrijf registreert zelf in het{" "}
        <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          EU-register
        </a>
        , nadat het daar geverifieerd is (EU Login en een gekwalificeerd elektronisch zegel). VeriPasso host het paspoort en
        zorgt dat de UPI altijd naar het paspoort leidt. Batterijen worden per exemplaar geregistreerd.
      </p>

      {!published && <p className="text-xs text-slate-400">Publiceer het paspoort eerst.</p>}

      {published && record && (
        <dl className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-slate-500">Granulariteit</dt>
          <dd>Model (exemplaren: zie de downloads hieronder)</dd>
          <dt className="text-slate-500">UPI</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <code className="truncate text-xs">{record.upi}</code>
            <Button type="button" size="sm" variant="ghost" onClick={() => copy(record.upi)}>
              Kopiëren
            </Button>
          </dd>
          <dt className="text-slate-500">Model-ID</dt>
          <dd>{record.modelIdentifier || <span className="text-slate-400">— (vul model of SKU in)</span>}</dd>
          {reg.registry_uri && (
            <>
              <dt className="text-slate-500">Registratie-ID (URI)</dt>
              <dd className="break-all">{reg.registry_uri}</dd>
            </>
          )}
          {reg.correlation_id && (
            <>
              <dt className="text-slate-500">Correlation ID</dt>
              <dd className="break-all">{reg.correlation_id}</dd>
            </>
          )}
          {reg.version_number && (
            <>
              <dt className="text-slate-500">Paspoortversie</dt>
              <dd>{reg.version_number}</dd>
            </>
          )}
          {reg.status === "rejected" && (
            <>
              <dt className="text-slate-500">Fout</dt>
              <dd className="text-amber-700">{[reg.error_code, reg.last_error].filter(Boolean).join(": ") || "Afgewezen"}</dd>
            </>
          )}
        </dl>
      )}

      {published && reg?.issues?.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-700">
          {reg.issues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      )}

      {published && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" loading={checking} onClick={runCheck}>
            UPI controleren
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => download("item")}>
            Gegevens exemplaren (CSV)
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => download("batch")}>
            Gegevens batches (CSV)
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => download("model")}>
            Gegevens model (CSV)
          </Button>
        </div>
      )}
      {check && (
        <p className={`text-sm ${check.resolvable?.ok ? "text-emerald-700" : "text-amber-700"}`}>
          {check.resolvable?.ok
            ? `In orde: de UPI opent het paspoort (${check.resolvable.redirects} doorverwijzing).`
            : check.issues?.[0]?.message || check.resolvable?.message || "Niet in orde"}
        </p>
      )}
      {published && (
        <p className="text-xs text-slate-400">
          De CSV-bestanden bevatten per paspoort de UPI, model-ID en batch-ID, in delen van maximaal 100 (de limiet per bestand van
          het register). Het officiële uploadsjabloon van het register zit nog niet in VeriPasso.
        </p>
      )}

      {published && (
        <form onSubmit={save} className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-800">Uitkomst uit het register vastleggen</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              Status
              <select className={input} value={outcome.status} onChange={(e) => setOutcome((o) => ({ ...o, status: e.target.value }))}>
                <option value="submitted">Ingediend</option>
                <option value="registered">Geregistreerd</option>
                <option value="rejected">Afgewezen</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Correlation ID
              <input className={input} maxLength={200} value={outcome.correlationId} onChange={(e) => setOutcome((o) => ({ ...o, correlationId: e.target.value }))} />
            </label>
            {outcome.status === "registered" && (
              <label className="text-sm text-slate-700 sm:col-span-2">
                Registratie-ID (URI)
                <input className={input} maxLength={500} value={outcome.registryUri} onChange={(e) => setOutcome((o) => ({ ...o, registryUri: e.target.value }))} />
              </label>
            )}
            {outcome.status === "rejected" && (
              <>
                <label className="text-sm text-slate-700">
                  Foutcode
                  <input className={input} maxLength={100} value={outcome.errorCode} onChange={(e) => setOutcome((o) => ({ ...o, errorCode: e.target.value }))} />
                </label>
                <label className="text-sm text-slate-700">
                  Foutmelding
                  <input className={input} maxLength={500} value={outcome.errorMessage} onChange={(e) => setOutcome((o) => ({ ...o, errorMessage: e.target.value }))} />
                </label>
              </>
            )}
          </div>
          <Button type="submit" size="sm" variant="accent" loading={saving}>
            Opslaan
          </Button>
        </form>
      )}
    </Card>
  );
}
