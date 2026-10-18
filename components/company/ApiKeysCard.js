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

const SCOPE_OPTIONS = [
  { value: "read", label: "Alleen lezen" },
  { value: "read write", label: "Lezen en schrijven" }
];
const EXPIRY_OPTIONS = [
  { value: "", label: "Verloopt niet" },
  { value: "90", label: "Over 90 dagen" },
  { value: "365", label: "Over 1 jaar" }
];

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("nl-NL") : "—";
}

// API-sleutels voor koppelingen met andere systemen (ERP, PIM, toezichthouders).
// De volledige sleutel staat alleen in het antwoord op aanmaken; daarna alleen de prefix.
export default function ApiKeysCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read");
  const [expiry, setExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setKeys(await api.get("/api/company/api-keys"));
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
      setError("Geef de sleutel een naam, bijv. de naam van het systeem dat hem gebruikt.");
      return;
    }
    setCreating(true);
    try {
      const result = await api.post("/api/company/api-keys", {
        name: name.trim(),
        scopes,
        expiresInDays: expiry ? Number(expiry) : null
      });
      setCreated(result);
      setName("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key) {
    const ok = await confirm({
      title: `Sleutel "${key.name}" intrekken?`,
      message: "Koppelingen die deze sleutel gebruiken, werken direct niet meer. Dit kan niet ongedaan worden gemaakt.",
      confirmLabel: "Intrekken",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api.delete(`/api/company/api-keys/${key.id}`);
      toast.success("Sleutel ingetrokken");
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.key);
      toast.success("Sleutel gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt; selecteer de sleutel en kopieer handmatig");
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">API-sleutels</h2>
        <p className="mt-1 text-xs text-slate-500">
          Voor koppelingen met andere systemen via de VeriPasso-API (<code>/api/v1</code>). Lezen van gepubliceerde paspoorten
          kan zonder sleutel; aanmaken en wijzigen vraagt een sleutel met schrijfrecht. Beschrijving:{" "}
          <a href="/api/v1/openapi.json" className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
            openapi.json
          </a>
          .
        </p>
      </div>

      {created && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Sleutel “{created.name}” — wordt maar één keer getoond. Bewaar hem veilig in het systeem dat hem gebruikt.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label="Nieuwe API-sleutel"
              value={created.key}
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

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Naam" name="api-key-name" placeholder="Bijv. ERP-koppeling" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Rechten" name="api-key-scopes" options={SCOPE_OPTIONS} value={scopes} onChange={(e) => setScopes(e.target.value)} />
        <Select label="Geldigheid" name="api-key-expiry" options={EXPIRY_OPTIONS} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <Button type="button" variant="accent" loading={creating} onClick={create}>
          Sleutel maken
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {keys && keys.length === 0 && <p className="text-sm text-slate-500">Nog geen API-sleutels.</p>}
      {keys && keys.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {keys.map((key) => {
            const expired = key.expires_at && new Date(key.expires_at) < new Date();
            const inactive = key.revoked_at || expired;
            return (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {key.name} <span className="font-mono text-xs text-slate-500">{key.key_prefix}_…</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {key.scopes === "read write" ? "Lezen en schrijven" : "Alleen lezen"} · gemaakt {formatDate(key.created_at)} ·
                    laatst gebruikt {formatDate(key.last_used_at)}
                    {key.expires_at ? ` · verloopt ${formatDate(key.expires_at)}` : ""}
                  </p>
                </div>
                {key.revoked_at ? (
                  <Badge variant="neutral">Ingetrokken</Badge>
                ) : expired ? (
                  <Badge variant="warning">Verlopen</Badge>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => revoke(key)} disabled={inactive}>
                    Intrekken
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
