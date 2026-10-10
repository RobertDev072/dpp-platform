"use client";

import { useState } from "react";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { homeHrefForRole } from "@/lib/nav";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Tweestapsverificatie: ticket na een geldig wachtwoord; code uit de app of herstelcode.
  const [mfaTicket, setMfaTicket] = useState("");
  const [mfaRequiredForChange, setMfaRequiredForChange] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
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
        // Tijdelijk wachtwoord geverifieerd: eerst een eigen wachtwoord instellen
        // (met MFA ook de code uit de app).
        setMfaRequiredForChange(Boolean(result.mfaRequired));
        setMustChangePassword(true);
      } else if (result.mfaRequired) {
        setMfaTicket(result.mfaTicket);
      } else {
        goToApp(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function secondFactorBody() {
    const value = mfaCode.trim();
    return useRecoveryCode ? { recoveryCode: value } : { code: value };
  }

  async function handleMfaSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.post("/api/auth/mfa/verify", { ticket: mfaTicket, ...secondFactorBody() });
      goToApp(result);
    } catch (err) {
      if (err.code === "MFA_TICKET_INVALID") {
        setMfaTicket("");
        setMfaCode("");
      }
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
        newPassword,
        ...(mfaRequiredForChange
          ? useRecoveryCode
            ? { recoveryCode: mfaCode.trim() }
            : { mfaCode: mfaCode.trim() }
          : {})
      });
      goToApp(result);
    } catch (err) {
      setError(err.fieldErrors?.newPassword?.[0] || err.message);
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

            {mfaRequiredForChange && (
              <>
            <label className="block text-sm font-medium text-slate-700">
              {useRecoveryCode ? "Herstelcode" : "Code uit je authenticator-app"} <span className="text-red-500">*</span>
              <input
                type="text"
                required
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                placeholder={useRecoveryCode ? "XXXXX-XXXXX" : "123456"}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setUseRecoveryCode((v) => !v);
                setMfaCode("");
              }}
              className="text-xs text-blue-600 hover:underline"
            >
              {useRecoveryCode ? "Code uit de app gebruiken" : "Telefoon kwijt? Gebruik een herstelcode"}
            </button>
              </>
            )}

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

        {!mustChangePassword && mfaTicket && (
          <form className="mt-6 space-y-4" onSubmit={handleMfaSubmit}>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Tweestapsverificatie staat aan voor dit account. Vul de code in die je
              authenticator-app nu toont.
            </div>
            <label className="block text-sm font-medium text-slate-700">
              {useRecoveryCode ? "Herstelcode" : "Code uit je authenticator-app"} <span className="text-red-500">*</span>
              <input
                type="text"
                required
                autoFocus
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                placeholder={useRecoveryCode ? "XXXXX-XXXXX" : "123456"}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setUseRecoveryCode((v) => !v);
                setMfaCode("");
              }}
              className="text-xs text-blue-600 hover:underline"
            >
              {useRecoveryCode ? "Code uit de app gebruiken" : "Telefoon kwijt? Gebruik een herstelcode"}
            </button>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Verifiëren en inloggen"}
            </button>
          </form>
        )}

        {!mustChangePassword && !mfaTicket && (
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

        {/* De oude "Inloggen met bedrijfsaccount"-knop (Microsofts gehoste pagina,
            inclusief diens "Account aanmaken") is bewust verwijderd: accounts
            ontstaan uitsluitend via uitnodiging of een beheerder. */}
      </div>
    </div>
  );
}
