"use client";

import { useState } from "react";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { homeHrefForRole } from "@/lib/nav";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaCodeLength, setMfaCodeLength] = useState(null);
  const [continuationToken, setContinuationToken] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function goToApp(user) {
    window.location.href = homeHrefForRole(user.role);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await api.post("/api/auth/login", { email, password });
      if (result.mustChangePassword) {
        // Tijdelijk wachtwoord geverifieerd: eerst een eigen wachtwoord instellen.
        setMustChangePassword(true);
      } else if (result.mfaRequired) {
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

  async function handleChangePasswordSubmit(event) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 12) {
      setError("Het nieuwe wachtwoord moet minimaal 12 tekens zijn.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("De wachtwoorden komen niet overeen.");
      return;
    }
    if (newPassword === password) {
      setError("Kies een ander wachtwoord dan het tijdelijke wachtwoord.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post("/api/auth/change-password", {
        email,
        currentPassword: password,
        newPassword
      });
      goToApp(result);
    } catch (err) {
      setError(err.fieldErrors?.newPassword?.[0] || err.message);
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

        {mustChangePassword && (
          <form className="mt-6 space-y-4" onSubmit={handleChangePasswordSubmit}>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Je bent ingelogd met een tijdelijk wachtwoord. Stel nu direct je eigen
              wachtwoord in om verder te gaan.
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Nieuw wachtwoord <span className="text-red-500">*</span>
              <input
                type="password"
                required
                autoFocus
                minLength={12}
                autoComplete="new-password"
                placeholder="Minimaal 12 tekens"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            <p className="text-xs text-slate-500">
              Gebruik minimaal 12 tekens met hoofdletters, kleine letters, cijfers en leestekens.
            </p>

            <label className="block text-sm font-medium text-slate-700">
              Bevestig nieuw wachtwoord <span className="text-red-500">*</span>
              <input
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="Herhaal je nieuwe wachtwoord"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Wachtwoord instellen en inloggen"}
            </button>
          </form>
        )}

        {!continuationToken && !mustChangePassword && (
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

        {continuationToken && !mustChangePassword && (
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

        {/* De oude "Inloggen met bedrijfsaccount"-knop (Microsofts gehoste pagina,
            inclusief diens "Account aanmaken") is bewust verwijderd: accounts
            ontstaan uitsluitend via uitnodiging of een beheerder. */}
      </div>
    </div>
  );
}
