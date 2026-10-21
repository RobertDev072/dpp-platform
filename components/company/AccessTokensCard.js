"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const LEVEL_OPTIONS = [
  { value: "professional", label: "Professional (reparateur, recycler)" },
  { value: "authority", label: "Autoriteit (markttoezicht, aangemelde instantie)" }
];
// Altijd een vervaldatum: tokenhouders zijn vaak personen (AVG).
const EXPIRY_OPTIONS = [
  { value: "365", label: "Over 1 jaar" },
  { value: "90", label: "Over 90 dagen" },
  { value: "730", label: "Over 2 jaar" }
];
const RESOURCE_LABELS = { passport: "paspoort", version: "oude versie", document: "document" };

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("nl-NL") : "—";
}

// Toegangstokens voor externe partijen. Met zo'n token zien reparateurs, recyclers en
// autoriteiten in de machineleesbare paspoorten (JSON/XML) ook de documenten die voor hun
// niveau zijn vrijgegeven. Het token staat alleen in het antwoord op aanmaken.
export default function AccessTokensCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tokens, setTokens] = useState(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("professional");
  const [expiry, setExpiry] = useState("365");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState(null);

  async function showLog(token) {
    if (log?.tokenId === token.id) {
      setLog(null);
      return;
    }
    try {
      setLog({ tokenId: token.id, rows: await api.get(`/api/company/access-tokens/${token.id}/log`) });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function load() {
    try {
      setTokens(await api.get("/api/company/access-tokens"));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError("");
    if (!name.trim()) {
      setError("Geef het token een naam, bijv. de naam van de partij die het krijgt.");
      return;
    }
    setCreating(true);
    try {
      setCreated(await api.post("/api/company/access-tokens", { name: name.trim(), level, expiresInDays: Number(expiry) }));
      setName("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token) {
    const ok = await confirm({
      title: `Token "${token.name}" intrekken?`,
      message: "Deze partij ziet daarna alleen nog de openbare gegevens. Dit kan niet ongedaan worden gemaakt.",
      confirmLabel: "Intrekken",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api.delete(`/api/company/access-tokens/${token.id}`);
      toast.success("Token ingetrokken");
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.token);
      toast.success("Token gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt; selecteer het token en kopieer handmatig");
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Toegang voor professionals en autoriteiten</h2>
        <p className="mt-1 text-xs text-slate-500">
          Consumenten zien alleen de openbare gegevens. Geef een reparateur, recycler of toezichthouder een token; daarmee ziet
          die in de machineleesbare paspoorten ook de documenten die je bij <em>Zichtbaar voor</em> voor dat niveau hebt
          vrijgegeven. Meesturen als <code>Authorization: Bearer vpa_…</code>. Elk token verloopt; wie wanneer iets opvroeg,
          zie je bij <em>Gebruik</em>.
        </p>
      </div>

      {created && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Token “{created.name}” wordt maar één keer getoond. Geef het veilig door aan de partij.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label="Nieuw toegangstoken"
              value={created.token}
              onClick={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900"
            />
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              Kopiëren
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Verbergen
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Partij" name="access-token-name" placeholder="Bijv. Reparatiebedrijf Jansen" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Niveau" name="access-token-level" options={LEVEL_OPTIONS} value={level} onChange={(e) => setLevel(e.target.value)} />
        <Select label="Geldigheid" name="access-token-expiry" options={EXPIRY_OPTIONS} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <Button type="button" variant="accent" loading={creating} onClick={create}>
          Token maken
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {tokens && tokens.length === 0 && <p className="text-sm text-slate-500">Nog geen toegangstokens.</p>}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {tokens.map((token) => {
            const expired = token.expires_at && new Date(token.expires_at) < new Date();
            return (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {token.name} <span className="font-mono text-xs text-slate-500">{token.token_prefix}_…</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {token.access_level === "authority" ? "Autoriteit" : "Professional"} · gemaakt {formatDate(token.created_at)} · laatst
                    gebruikt {formatDate(token.last_used_at)}
                    {token.expires_at ? ` · verloopt ${formatDate(token.expires_at)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => showLog(token)}>
                    {log?.tokenId === token.id ? "Gebruik verbergen" : "Gebruik"}
                  </Button>
                  {token.revoked_at ? (
                    <Badge variant="neutral">Ingetrokken</Badge>
                  ) : expired ? (
                    <Badge variant="warning">Verlopen</Badge>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => revoke(token)}>
                      Intrekken
                    </Button>
                  )}
                </div>
                {log?.tokenId === token.id && (
                  <div className="w-full text-xs text-slate-600">
                    {log.rows.length === 0 ? (
                      <p className="text-slate-400">Nog niet gebruikt.</p>
                    ) : (
                      <ul className="max-h-48 space-y-0.5 overflow-auto">
                        {log.rows.map((row, i) => (
                          <li key={i}>
                            {new Date(row.accessed_at).toLocaleString("nl-NL")} · {RESOURCE_LABELS[row.resource] || row.resource} ·{" "}
                            <span className="font-mono">{String(row.public_id).toUpperCase().slice(0, 8)}…</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-slate-400">Laatste 100 opvragingen; het logboek wordt 365 dagen bewaard.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
