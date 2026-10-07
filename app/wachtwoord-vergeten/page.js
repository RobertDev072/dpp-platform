"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const isFirstSetup = searchParams.get("setup") === "1";

  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [continuationToken, setContinuationToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetToEmailStep(message) {
    setStep("email");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setContinuationToken("");
    setError(message);
  }

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.post("/api/password-reset/start", { email });
      // Ook voor een onbekend e-mailadres volgt bewust dezelfde stap, om niet te
      // verklappen welke adressen wel/niet bestaan.
      setContinuationToken(result.continuationToken || "");
      setCodeLength(result.codeLength || null);
      setStep("code");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.post("/api/password-reset/verify-code", { continuationToken, code });
      setContinuationToken(result.continuationToken);
      setStep("password");
    } catch (err) {
      if (err.code === "EXPIRED") {
        resetToEmailStep("Deze code is verlopen. Vul je e-mailadres opnieuw in om een nieuwe code te ontvangen.");
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("De twee wachtwoorden komen niet overeen. Controleer beide velden.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post("/api/password-reset/submit", { continuationToken, password, code, email });
      if (result.status === "completed") {
        setStep("done");
      } else {
        setError("Het wachtwoord wordt nog verwerkt. Wacht een paar seconden en probeer in te loggen.");
      }
    } catch (err) {
      if (err.code === "EXPIRED") {
        resetToEmailStep("Deze aanvraag is verlopen. Vul je e-mailadres opnieuw in om opnieuw te beginnen.");
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

        <h1 className="mt-6 text-center text-lg font-semibold text-slate-900">
          {isFirstSetup ? "Stel je wachtwoord in" : "Wachtwoord vergeten"}
        </h1>

        {step === "email" && (
          <form className="mt-6 space-y-4" onSubmit={handleEmailSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              E-mailadres <span className="text-red-500">*</span>
              <input
                type="email"
                required
                placeholder="naam@bedrijf.nl"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Verstuur code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="mt-6 space-y-4" onSubmit={handleCodeSubmit}>
            <p className="text-sm text-slate-600">
              Als <span className="font-medium">{email}</span> bekend is, is er zojuist een{" "}
              {codeLength ? `${codeLength}-cijferige` : ""} code naartoe gestuurd. Controleer ook je
              spam-map.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Verificatiecode <span className="text-red-500">*</span>
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={codeLength ? "0".repeat(codeLength) : "Bijv. 12345678"}
                maxLength={codeLength || undefined}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Bezig..." : "Code bevestigen"}
            </button>
          </form>
        )}

        {step === "password" && (
          <form className="mt-6 space-y-4" onSubmit={handlePasswordSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              Nieuw wachtwoord <span className="text-red-500">*</span>
              <input
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="Minimaal 12 tekens"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <span className="mt-1 block text-xs font-normal text-slate-400">
                Gebruik minimaal 12 tekens, en combineer bij voorkeur hoofdletters, kleine letters,
                cijfers en een symbool.
              </span>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Bevestig wachtwoord <span className="text-red-500">*</span>
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
              {submitting ? "Bezig..." : "Wachtwoord wijzigen"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-slate-600">Je wachtwoord is gewijzigd. Je kunt nu inloggen.</p>
            <a
              href="/login"
              className="block w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Naar inloggen
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-500">
          Laden...
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
