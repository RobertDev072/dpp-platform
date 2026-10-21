"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fetchBlob, saveBlob } from "@/lib/download";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

const STATUS = {
  none: ["neutral", "Nog niet aangemeld"],
  queued: ["neutral", "Nog niet aangemeld"],
  submitted: ["info", "Ingediend bij de EU"],
  registered: ["success", "Aangemeld bij de EU"],
  rejected: ["warning", "Afgewezen door de EU"],
  failed: ["warning", "Afgewezen door de EU"]
};

const REGISTRY_URL = "https://registry.product-passport.ec.europa.eu/";
const CHECKLIST_URL = "/docs/veripasso-checklist-eu-register.pdf";

const HELP = {
  upi: "Het vaste webadres van dit paspoort. Het verandert nooit. Dit adres vul je in het EU-register in (bij de EU heet het UPI).",
  itemUpi: "Elk exemplaar heeft een eigen webadres met het serienummer erin. Batterijen meld je per exemplaar aan.",
  model: "Het type- of modelnummer van je product. Mag je meesturen, hoeft niet.",
  uri: "Het nummer dat de EU geeft als je aanmelding gelukt is. Bewaar dit goed: het is je bewijs.",
  correlation: "Het nummer van je aanvraag bij de EU. Handig als je contact opneemt met de EU-helpdesk.",
  errorCode: "Alleen bij een afwijzing: de foutcode of foutmelding die de EU toont."
};

// Kleine uitleg achter een ⓘ: werkt met klikken (ook op telefoons, waar geen hover is).
function Info({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Uitleg"
        title={text}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 align-middle text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
      >
        i
      </button>
      {open && <span className="mt-1 block text-xs font-normal text-slate-500">{text}</span>}
    </>
  );
}

function Step({ n, title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>
        {title}
      </h3>
      <div className="space-y-2 pl-8 text-sm text-slate-600">{children}</div>
    </section>
  );
}

// EU DPP-register. De klant meldt zelf aan (na verificatie met EU Login en een
// gekwalificeerd elektronisch zegel); VeriPasso zorgt dat het paspoort online en bereikbaar
// is, geeft de gegevens om over te nemen en bewaart wat de EU teruggaf. Standaard ingeklapt:
// voor de meeste producten is aanmelden (nog) niet nodig.
export default function RegistryCard({ product }) {
  const toast = useToast();
  const [reg, setReg] = useState(null);
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState({ status: "", registryUri: "", correlationId: "", errorCode: "", errorMessage: "" });

  useEffect(() => {
    api
      .get(`/api/products/${product.id}/registration`)
      .then((data) => {
        setReg(data);
        if (data?.status && !["none", "queued"].includes(data.status)) setOpen(true);
      })
      .catch(() => setReg(null));
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
        fallbackName: `overzicht-${granularity}.csv`
      });
      saveBlob(blob, filename);
    } catch (err) {
      const issues = err.details?.issues;
      toast.error(issues?.length ? `${err.message}: ${issues[0].message} (${issues[0].upi})` : err.message);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!outcome.status) {
      toast.error("Kies eerst de uitkomst die de EU gaf.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.patch(`/api/products/${product.id}/registration`, outcome);
      setReg((prev) => ({ ...prev, ...saved }));
      setOutcome({ status: "", registryUri: "", correlationId: "", errorCode: "", errorMessage: "" });
      toast.success("Uitkomst van de EU opgeslagen");
    } catch (err) {
      toast.error(err.details?.fieldErrors?.registryUri?.[0] || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Webadres gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt; selecteer het adres en kopieer handmatig");
    }
  }

  const [variant, label] = STATUS[reg?.status || "none"] || STATUS.none;
  const published = Boolean(product.published_at);
  const record = reg?.record;
  const hasItems = (reg?.itemCount || 0) > 0;
  const hasBatches = (reg?.batchCount || 0) > 0;
  const input = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm";

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">EU-register (Europese Commissie)</h2>
        <Badge variant={variant}>{label}</Badge>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Je hoeft nu nog niets te doen.</strong> De EU laat aanmelden op dit moment nog niet toe. Het register gaat eerst
        open voor <strong>batterijen</strong> (batterijpaspoort verplicht vanaf 18 februari 2027); andere producten volgen later.
      </div>

      {(reg?.registry_uri || reg?.status === "rejected") && (
        <dl className="grid gap-1 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
          {reg.registry_uri && (
            <>
              <dt className="text-slate-500">Registratienummer van de EU</dt>
              <dd className="break-all">{reg.registry_uri}</dd>
            </>
          )}
          {reg.correlation_id && (
            <>
              <dt className="text-slate-500">Aanvraagnummer</dt>
              <dd className="break-all">{reg.correlation_id}</dd>
            </>
          )}
          {reg.status === "rejected" && (
            <>
              <dt className="text-slate-500">Reden afwijzing</dt>
              <dd className="text-amber-700">{[reg.error_code, reg.last_error].filter(Boolean).join(": ") || "Onbekend"}</dd>
            </>
          )}
          {reg.version_number && (
            <>
              <dt className="text-slate-500">Paspoortversie bij aanmelding</dt>
              <dd>{reg.version_number}</dd>
            </>
          )}
        </dl>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Uitleg en stappen verbergen" : "Hoe werkt aanmelden? (uitleg en stappen)"}
      </Button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">
            De EU wil weten welke productpaspoorten bestaan en waar ze staan. <strong>Jouw bedrijf meldt dit zelf</strong> bij de
            EU. VeriPasso zorgt dat je paspoort online staat en altijd bereikbaar is, en geeft je hieronder de gegevens om over te
            nemen.
          </p>

          <Step n={1} title="Laat je bedrijf verifiëren bij de EU (eenmalig)">
            <p>
              Je hebt een EU Login-account en een gekwalificeerd elektronisch zegel (QSeal) van je bedrijf nodig. Na de verificatie
              toont de EU tot wanneer je zegel geldig is; daarna moet je opnieuw verifiëren.
            </p>
            <p className="flex flex-wrap gap-3">
              <a href={CHECKLIST_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                Lees onze checklist (PDF)
              </a>
              <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                Naar het EU-register
              </a>
            </p>
          </Step>

          <Step n={2} title="Meld dit product aan in het EU-register">
            {!published ? (
              <p className="text-slate-400">Publiceer het paspoort eerst; dan verschijnt hier het webadres.</p>
            ) : (
              <>
                {hasItems ? (
                  <>
                    <p>
                      Dit product heeft {reg.itemCount} exemplaren. Batterijen meld je <strong>per exemplaar</strong> aan, elk met een
                      eigen webadres met het serienummer erin.
                      <Info text={HELP.itemUpi} />
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="accent" onClick={() => download("item")}>
                        Overzicht exemplaren
                      </Button>
                      {hasBatches && (
                        <Button type="button" size="sm" variant="outline" onClick={() => download("batch")}>
                          Overzicht batches
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <p>Kopieer het webadres van dit paspoort en plak het in het EU-register.</p>
                )}

                {record && (
                  <dl className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <dt className="text-slate-500">
                      {hasItems ? "Webadres van het model" : "Webadres paspoort"}
                      <Info text={hasItems ? `${HELP.upi} Dit adres geldt alleen voor de model-informatie.` : HELP.upi} />
                    </dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      <code className="truncate text-xs text-slate-800">{record.upi}</code>
                      <Button type="button" size="sm" variant="ghost" onClick={() => copy(record.upi)}>
                        Kopiëren
                      </Button>
                    </dd>
                    <dt className="text-slate-500">
                      Modelnummer
                      <Info text={HELP.model} />
                    </dt>
                    <dd>{record.modelIdentifier || <span className="text-slate-400">niet ingevuld (mag leeg blijven)</span>}</dd>
                  </dl>
                )}
                {reg?.issues?.length > 0 && (
                  <ul className="list-disc pl-5 text-amber-700">
                    {reg.issues.map((issue) => (
                      <li key={issue.code}>{issue.message}</li>
                    ))}
                  </ul>
                )}

                {hasItems && (
                  <p className="text-xs text-slate-400">
                    Het overzicht is een lijst om over te nemen (maximaal 100 per bestand). Je kunt het <strong>niet uploaden</strong> in
                    het EU-register: dat accepteert alleen een eigen JSON- of XML-bestand.
                  </p>
                )}
                {!hasItems && (
                  <button type="button" onClick={() => download("model")} className="text-xs text-blue-600 hover:underline">
                    Gegevens als lijst downloaden (CSV, niet om te uploaden)
                  </button>
                )}

                <div>
                  <Button type="button" size="sm" variant="outline" loading={checking} onClick={runCheck}>
                    Controleer of het webadres werkt
                  </Button>
                  {check && (
                    <p className={`mt-2 ${check.resolvable?.ok ? "text-emerald-700" : "text-amber-700"}`}>
                      {check.resolvable?.ok
                        ? "Het webadres werkt: het opent je paspoort via een beveiligde verbinding. De EU doet zelf nog een eigen controle."
                        : check.issues?.[0]?.message || check.resolvable?.message || "Het webadres werkt niet goed."}
                    </p>
                  )}
                </div>
              </>
            )}
          </Step>

          <Step n={3} title="Vul hier in wat de EU teruggaf">
            <p>Na het aanmelden toont de EU een uitkomst. Neem die hier over, zodat je in VeriPasso ziet of het gelukt is.</p>
            {published ? (
              <form onSubmit={save} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Uitkomst
                    <select className={input} value={outcome.status} onChange={(e) => setOutcome((o) => ({ ...o, status: e.target.value }))}>
                      <option value="">Kies…</option>
                      <option value="submitted">Ingediend (nog in behandeling)</option>
                      <option value="registered">Gelukt</option>
                      <option value="rejected">Afgewezen</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Aanvraagnummer (correlation ID)
                    <Info text={HELP.correlation} />
                    <input className={input} maxLength={200} value={outcome.correlationId} onChange={(e) => setOutcome((o) => ({ ...o, correlationId: e.target.value }))} />
                  </label>
                  {outcome.status === "registered" && (
                    <label className="text-sm text-slate-700 sm:col-span-2">
                      Registratienummer van de EU (URI)
                      <Info text={HELP.uri} />
                      <input className={input} maxLength={500} value={outcome.registryUri} onChange={(e) => setOutcome((o) => ({ ...o, registryUri: e.target.value }))} />
                    </label>
                  )}
                  {outcome.status === "rejected" && (
                    <>
                      <label className="text-sm text-slate-700">
                        Foutcode
                        <Info text={HELP.errorCode} />
                        <input className={input} maxLength={100} value={outcome.errorCode} onChange={(e) => setOutcome((o) => ({ ...o, errorCode: e.target.value }))} />
                      </label>
                      <label className="text-sm text-slate-700">
                        Foutmelding
                        <input className={input} maxLength={500} value={outcome.errorMessage} onChange={(e) => setOutcome((o) => ({ ...o, errorMessage: e.target.value }))} />
                      </label>
                    </>
                  )}
                </div>
                <Button type="submit" size="sm" variant="accent" loading={saving} disabled={!outcome.status}>
                  Opslaan
                </Button>
              </form>
            ) : (
              <p className="text-slate-400">Publiceer het paspoort eerst.</p>
            )}
          </Step>
        </div>
      )}
    </Card>
  );
}
