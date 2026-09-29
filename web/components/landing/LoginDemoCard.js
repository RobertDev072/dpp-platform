"use client";

import { useEffect, useState } from "react";
import useInView from "./useInView";
import { VeriPassoIcon } from "./VeriPassoLogo";

const EMAIL = "inkoop@uwbedrijf.nl";
const PASSWORD_LENGTH = 10;

export default function LoginDemoCard({ className = "" }) {
  const [ref, inView] = useInView();
  const [email, setEmail] = useState("");
  const [passwordDots, setPasswordDots] = useState(0);
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    if (!inView) return undefined;

    let cancelled = false;
    const timers = [];
    const wait = (fn, delay) => timers.push(setTimeout(fn, delay));

    function typeEmail(index) {
      if (cancelled) return;
      setEmail(EMAIL.slice(0, index));
      if (index < EMAIL.length) {
        wait(() => typeEmail(index + 1), 45);
      } else {
        wait(() => typePassword(1), 350);
      }
    }

    function typePassword(count) {
      if (cancelled) return;
      setPasswordDots(count);
      if (count < PASSWORD_LENGTH) {
        wait(() => typePassword(count + 1), 70);
      } else {
        wait(() => setPhase("loading"), 400);
        wait(() => setPhase("done"), 1900);
      }
    }

    setPhase("typing");
    wait(() => typeEmail(1), 500);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [inView]);

  const showEmailCursor = phase === "typing" && email.length < EMAIL.length;
  const showPasswordCursor =
    phase === "typing" && email.length === EMAIL.length && passwordDots < PASSWORD_LENGTH;

  return (
    <div
      ref={ref}
      className={`w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl ${className}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <VeriPassoIcon className="h-4 w-4" />
        <span className="text-sm font-semibold text-slate-900">Inloggen</span>
      </div>

      <label className="block text-[11px] font-medium text-slate-500">E-mailadres</label>
      <div className="mb-2 mt-1 flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700">
        <span>{email}</span>
        {showEmailCursor && (
          <span className="ml-0.5 inline-block h-3.5 w-px animate-blink-cursor bg-slate-500" />
        )}
      </div>

      <label className="block text-[11px] font-medium text-slate-500">Wachtwoord</label>
      <div className="mb-3 mt-1 flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs tracking-widest text-slate-700">
        <span>{"•".repeat(passwordDots)}</span>
        {showPasswordCursor && (
          <span className="ml-0.5 inline-block h-3.5 w-px animate-blink-cursor bg-slate-500" />
        )}
      </div>

      <div
        className={`flex h-8 items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors ${
          phase === "done" ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
        }`}
      >
        {phase === "loading" && (
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
          />
        )}
        <span>
          {phase === "loading"
            ? "Bezig met inloggen…"
            : phase === "done"
              ? "Ingelogd ✓"
              : "Inloggen"}
        </span>
      </div>
    </div>
  );
}
