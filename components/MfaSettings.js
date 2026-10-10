"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

// Tweestapsverificatie (TOTP) beheren vanuit het eigen profiel:
// koppelen (QR-code scannen + eerste code bevestigen), herstelcodes één keer tonen,
// en uitschakelen (wachtwoord + code). Sterk aanbevolen voor beheerders.
export default function MfaSettings({ role }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const recommended = ["platform_owner", "partner_admin", "company_admin"].includes(role);

  async function load() {
    try {
      setStatus(await api.get("/api/auth/mfa"));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function startSetup() {
    setError("");
    setBusy(true);
    try {
      setSetup(await api.post("/api/auth/mfa/setup"));
      setCode("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.post("/api/auth/mfa/enable", { code: code.trim() });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode("");
      toast.success("Tweestapsverificatie staat aan");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/mfa/disable", { password, code: code.trim() });
      setDisabling(false);
      setPassword("");
      setCode("");
      toast.success("Tweestapsverificatie staat uit");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 block w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600";

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Tweestapsverificatie</h2>
        {status && (
          <Badge variant={status.enabled ? "success" : recommended ? "warning" : "neutral"}>
            {status.enabled ? "Aan" : "Uit"}
          </Badge>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {recoveryCodes && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Bewaar deze herstelcodes op een veilige plek. Ze worden maar één keer getoond.</p>
          <p className="mt-1">Elke code werkt één keer, als je je telefoon kwijt bent.</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs font-medium text-amber-900 underline" onClick={() => setRecoveryCodes(null)}>
            Ik heb ze bewaard
          </button>
        </div>
      )}

      {status && !status.enabled && !setup && (
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Beveilig je account met een code uit een authenticator-app (bijv. Microsoft Authenticator, Google
            Authenticator of 1Password) naast je wachtwoord.
            {recommended && " Voor beheerders sterk aanbevolen."}
          </p>
          <button
            type="button"
            onClick={startSetup}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Tweestapsverificatie instellen
          </button>
        </div>
      )}

      {setup && (
        <form onSubmit={confirmSetup} className="space-y-3 text-sm text-slate-600">
          <p>1. Scan deze QR-code met je authenticator-app.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="QR-code om tweestapsverificatie te koppelen" width={180} height={180} />
          <p>
            Lukt scannen niet? Voer deze sleutel handmatig in:{" "}
            <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs">{setup.secret}</code>
          </p>
          <label className="block font-medium text-slate-700">
            2. Vul de code uit de app in
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={inputClass}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              Bevestigen
            </button>
            <button type="button" onClick={() => setSetup(null)} className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100">
              Annuleren
            </button>
          </div>
        </form>
      )}

      {status?.enabled && !disabling && (
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Bij het inloggen vragen we naast je wachtwoord een code uit je authenticator-app. Nog{" "}
            {status.recoveryCodesRemaining} herstelcode(s) beschikbaar.
          </p>
          <button type="button" onClick={() => setDisabling(true)} className="text-sm font-medium text-red-700 hover:underline">
            Tweestapsverificatie uitschakelen
          </button>
        </div>
      )}

      {disabling && (
        <form onSubmit={disable} className="space-y-3 text-sm">
          <label className="block font-medium text-slate-700">
            Huidig wachtwoord
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </label>
          <label className="block font-medium text-slate-700">
            Code uit de app
            <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-60">
              Uitschakelen
            </button>
            <button type="button" onClick={() => setDisabling(false)} className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100">
              Annuleren
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
