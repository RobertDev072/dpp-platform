"use client";

import { useState } from "react";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaCodeLength, setMfaCodeLength] = useState(null);
  const [continuationToken, setContinuationToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function goToApp(user) {
    window.location.href = user.role === "platform_owner" ? "/admin" : "/company";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await api.post("/api/auth/login", { email, password });
      if (result.mfaRequired) {
        setContinuationToken(result.continuationToken);
        setMfaCodeLength(result.codeLength || null);
      } else {
        goToApp(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await api.post("/api/auth/login/mfa", { continuationToken, code: mfaCode });
      goToApp(result);
    } catch (err) {
      if (err.code === "EXPIRED") {
        setContinuationToken("");
        setMfaCode("");
        setError("Deze verificatiecode is verlopen. Log opnieuw in om een nieuwe code te ontvangen.");
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex justify-center">
          <Logo />
        </div>

        {!continuationToken && (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              E-mail <span className="text-red-500">*</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="username"
                placeholder="naam@bedrijf.nl"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Wachtwoord <span className="text-red-500">*</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Je wachtwoord"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Inloggen"}
            </button>

            <a href="/wachtwoord-vergeten" className="block text-center text-sm text-blue-600 hover:underline">
              Wachtwoord vergeten?
            </a>
          </form>
        )}

        {continuationToken && (
          <form className="mt-6 space-y-4" onSubmit={handleMfaSubmit}>
            <p className="text-sm text-slate-600">
              Voer de {mfaCodeLength ? `${mfaCodeLength}-cijferige ` : ""}verificatiecode in die naar je
              e-mailadres is gestuurd. Controleer ook je spam-map.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Verificatiecode <span className="text-red-500">*</span>
              <input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={mfaCodeLength ? "0".repeat(mfaCodeLength) : "Bijv. 12345678"}
                maxLength={mfaCodeLength || undefined}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Bevestigen"}
            </button>
          </form>
        )}

        {!continuationToken && (
          <>
            <p className="my-4 text-center text-sm text-slate-400">of</p>
            <a
              href="/auth/login"
              className="block w-full rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Inloggen met bedrijfsaccount
            </a>
            <p className="mt-2 text-center text-xs text-slate-400">
              Voor accounts die door een beheerder zijn aangemaakt — geen eigen Microsoft-account nodig.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
