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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [continuationToken, setContinuationToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.post("/api/password-reset/start", { email });
      // continuationToken is null als het e-mailadres onbekend is bij Entra - bewust
      // dezelfde stap tonen, om niet te verklappen welke adressen wel/niet bestaan.
      setContinuationToken(result.continuationToken || "");
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
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Wachtwoorden komen niet overeen");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post("/api/password-reset/submit", { continuationToken, password, code });
      if (result.status === "completed") {
        setStep("done");
      } else {
        setError("Het wachtwoord wordt nog verwerkt, probeer over een moment opnieuw in te loggen.");
      }
    } catch (err) {
      setError(err.message);
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
              E-mailadres
              <input
                type="email"
                required
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
              Verstuur code
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="mt-6 space-y-4" onSubmit={handleCodeSubmit}>
            <p className="text-sm text-slate-600">
              Als {email} bekend is, is er een code naar dit e-mailadres gestuurd.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Code
              <input
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              Code bevestigen
            </button>
          </form>
        )}

        {step === "password" && (
          <form className="mt-6 space-y-4" onSubmit={handlePasswordSubmit}>
            <label className="block text-sm font-medium text-slate-700">
              Nieuw wachtwoord
              <input
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Bevestig wachtwoord
              <input
                type="password"
                required
                minLength={12}
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
              Wachtwoord wijzigen
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-slate-600">Je wachtwoord is gewijzigd.</p>
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
