"use client";

import { useRef, useState } from "react";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { homeHrefForRole } from "@/lib/nav";
import { validateLogin, loginErrorMessage } from "@/lib/loginMessages";

const INPUT =
  "mt-1.5 block w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-[#1476FF] focus:outline-none focus:ring-2 focus:ring-[#1476FF]/25";
const BUTTON =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#72E600] px-5 py-3 text-[15px] font-semibold text-[#06162A] shadow-[0_12px_28px_-12px_rgba(114,230,0,0.85)] transition hover:bg-[#66d000] disabled:cursor-not-allowed disabled:opacity-60";

// Melding met titel en (optioneel) wat je kunt doen. role="alert": schermlezers lezen hem voor.
function Alert({ message, tone = "error" }) {
  if (!message) return null;
  const styles =
    tone === "info" ? "border-blue-200 bg-blue-50 text-blue-900" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border p-3.5 text-sm ${styles}`}>
      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {tone === "error" ? <path d="M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" /> : <path d="M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />}
      </svg>
      <div className="space-y-0.5">
        <p className="font-semibold">{message.title}</p>
        {message.hint && <p className="opacity-90">{message.hint}</p>}
      </div>
    </div>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#06162A]/30 border-t-[#06162A]" />;
}

// Linkerkant: merk en wat VeriPasso doet (op mobiel verborgen).
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#0a2342] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_80%_60%,rgba(20,118,255,0.45),transparent_70%),radial-gradient(40%_40%_at_10%_100%,rgba(114,230,0,0.16),transparent_70%)]" />
      <a href="https://www.veripasso.com/" className="relative" aria-label="VeriPasso, naar de website">
        <Logo background="dark" className="h-9" />
      </a>
      <div className="relative max-w-md space-y-6">
        <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight">
          Elk product zijn eigen <span className="text-[#72E600]">paspoort.</span>
        </h1>
        <p className="text-lg text-[#b9cde8]">Beheer je productgegevens, documenten en QR-codes op één plek, volgens de Europese regels.</p>
        <ul className="space-y-2.5 text-sm font-medium">
          {["Vaste QR-code die altijd werkt", "Elke wijziging als vaste versie bewaard", "Gegevens in de EU"].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <svg viewBox="0 0 16 16" className="h-4 w-4 flex-none" fill="none" stroke="#72E600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-[#a4b4c9]">© 2026 VeriPasso, een platform van Robertdev.nl</p>
    </aside>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Tweestapsverificatie: ticket na een geldig wachtwoord; code uit de app of herstelcode.
  const [mfaTicket, setMfaTicket] = useState("");
  const [mfaRequiredForChange, setMfaRequiredForChange] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  // "Onthoud deze computer 30 dagen": standaard aan (op een gedeelde computer uitzetten).
  const [rememberDevice, setRememberDevice] = useState(true);
  // Lokveld tegen bots (onzichtbaar; mensen laten het leeg).
  const [website, setWebsite] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [badField, setBadField] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  function goToApp(user) {
    window.location.href = homeHrefForRole(user.role);
  }

  function fail(message, field = null) {
    setError(message);
    setBadField(field);
    if (field === "email") emailRef.current?.focus();
    if (field === "password") passwordRef.current?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBadField(null);
    const invalid = validateLogin({ email, password });
    if (invalid) return fail(invalid, invalid.field);
    setSubmitting(true);
    try {
      const result = await api.post("/api/auth/login", { email: email.trim(), password, ...(website ? { website } : {}) });
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
      fail(loginErrorMessage(err), err.code === "INVALID_CREDENTIALS" ? "password" : null);
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
    setError(null);
    if (!mfaCode.trim()) return fail({ title: useRecoveryCode ? "Vul je herstelcode in." : "Vul de code uit je app in.", hint: null });
    setSubmitting(true);
    try {
      const result = await api.post("/api/auth/mfa/verify", { ticket: mfaTicket, ...secondFactorBody(), rememberDevice });
      goToApp(result);
    } catch (err) {
      if (err.code === "MFA_TICKET_INVALID") {
        setMfaTicket("");
        setMfaCode("");
      }
      fail(loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePasswordSubmit(event) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 12) return fail({ title: "Het nieuwe wachtwoord moet minimaal 12 tekens zijn.", hint: null });
    if (newPassword !== confirmPassword) return fail({ title: "De wachtwoorden komen niet overeen.", hint: "Typ hetzelfde wachtwoord twee keer." });
    if (newPassword === password) return fail({ title: "Kies een ander wachtwoord dan het tijdelijke wachtwoord.", hint: null });

    setSubmitting(true);
    try {
      const result = await api.post("/api/auth/change-password", {
        email: email.trim(),
        currentPassword: password,
        newPassword,
        ...(mfaRequiredForChange ? (useRecoveryCode ? { recoveryCode: mfaCode.trim() } : { mfaCode: mfaCode.trim() }) : {})
      });
      goToApp(result);
    } catch (err) {
      const field = err.fieldErrors?.newPassword?.[0];
      fail(field ? { title: field, hint: null } : loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const codeField = (autoFocus) => (
    <>
      <label className="block text-sm font-medium text-slate-700">
        {useRecoveryCode ? "Herstelcode" : "Code uit je authenticator-app"}
        <input
          type="text"
          required
          autoFocus={autoFocus}
          inputMode={useRecoveryCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={useRecoveryCode ? "XXXXX-XXXXX" : "123456"}
          value={mfaCode}
          onChange={(event) => setMfaCode(event.target.value)}
          className={`${INPUT} border-slate-300 tracking-[0.3em]`}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setUseRecoveryCode((v) => !v);
          setMfaCode("");
        }}
        className="text-sm font-medium text-[#1476FF] hover:underline"
      >
        {useRecoveryCode ? "Code uit de app gebruiken" : "Telefoon kwijt? Gebruik een herstelcode"}
      </button>
    </>
  );

  return (
    <div className="grid min-h-screen bg-[#f5f8fc] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <BrandPanel />

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <a href="https://www.veripasso.com/" className="lg:hidden" aria-label="VeriPasso, naar de website">
          <Logo className="h-8" />
        </a>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {mustChangePassword && (
            <form className="space-y-5" onSubmit={handleChangePasswordSubmit} noValidate>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-[#06162A]">Kies je eigen wachtwoord</h2>
                <p className="mt-2 text-slate-600">Je bent ingelogd met een tijdelijk wachtwoord. Stel nu je eigen wachtwoord in om verder te gaan.</p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Nieuw wachtwoord
                <input type="password" required autoFocus minLength={12} autoComplete="new-password" placeholder="Minimaal 12 tekens" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={`${INPUT} border-slate-300`} />
              </label>
              <p className="-mt-3 text-xs text-slate-500">Gebruik minimaal 12 tekens met hoofdletters, kleine letters, cijfers en leestekens.</p>
              <label className="block text-sm font-medium text-slate-700">
                Herhaal nieuw wachtwoord
                <input type="password" required minLength={12} autoComplete="new-password" placeholder="Nog een keer" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={`${INPUT} border-slate-300`} />
              </label>
              {mfaRequiredForChange && codeField(false)}
              <Alert message={error} />
              <button type="submit" disabled={submitting} className={BUTTON}>
                {submitting && <Spinner />}
                {submitting ? "Bezig…" : "Wachtwoord instellen en inloggen"}
              </button>
            </form>
          )}

          {!mustChangePassword && mfaTicket && (
            <form className="space-y-5" onSubmit={handleMfaSubmit} noValidate>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-[#06162A]">Nog één stap</h2>
                <p className="mt-2 text-slate-600">Tweestapsverificatie staat aan voor dit account. Vul de code in die je authenticator-app nu toont.</p>
              </div>
              {codeField(true)}
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#1476FF]"
                />
                <span>
                  <span className="font-medium text-slate-900">Onthoud deze computer 30 dagen</span>
                  <span className="block text-slate-500">Dan vragen we hier alleen je wachtwoord. Niet aanvinken op een gedeelde computer.</span>
                </span>
              </label>
              <Alert message={error} />
              <button type="submit" disabled={submitting} className={BUTTON}>
                {submitting && <Spinner />}
                {submitting ? "Bezig…" : "Verifiëren en inloggen"}
              </button>
            </form>
          )}

          {!mustChangePassword && !mfaTicket && (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-[#06162A]">Welkom terug</h2>
                <p className="mt-2 text-slate-600">Log in om je productpaspoorten te beheren.</p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                E-mailadres
                <input
                  ref={emailRef}
                  type="email"
                  autoFocus
                  autoComplete="username"
                  placeholder="naam@bedrijf.nl"
                  value={email}
                  aria-invalid={badField === "email" || undefined}
                  onChange={(event) => setEmail(event.target.value)}
                  className={`${INPUT} ${badField === "email" ? "border-red-400" : "border-slate-300"}`}
                />
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Wachtwoord
                  </label>
                  <a href="/wachtwoord-vergeten" className="text-sm font-medium text-[#1476FF] hover:underline">
                    Wachtwoord vergeten?
                  </a>
                </div>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Je wachtwoord"
                    value={password}
                    aria-invalid={badField === "password" || undefined}
                    onChange={(event) => setPassword(event.target.value)}
                    className={`${INPUT} pr-24 ${badField === "password" ? "border-red-400" : "border-slate-300"}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {showPassword ? "Verbergen" : "Tonen"}
                  </button>
                </div>
              </div>

              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Website (laat leeg)
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                </label>
              </div>

              <Alert message={error} />

              <button type="submit" disabled={submitting} className={BUTTON}>
                {submitting && <Spinner />}
                {submitting ? "Bezig met inloggen…" : "Inloggen"}
              </button>

              <p className="text-center text-sm text-slate-500">
                Nog geen account? Accounts maakt de beheerder van je bedrijf aan.{" "}
                <a href="https://www.veripasso.com/#contact" className="font-medium text-[#1476FF] hover:underline">
                  Contact
                </a>
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
