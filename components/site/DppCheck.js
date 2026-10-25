"use client";

import { useState } from "react";
import { CATEGORIES, BATTERY_TYPES, ROLES, evaluate } from "@/lib/dppCheck";

const TEXT = {
  nl: {
    step: "Vraag",
    of: "van",
    q: {
      category: "Wat voor product verkoop je?",
      batteryType: "Om welk type batterij gaat het?",
      role: "Wat is jouw rol?",
      eu: "Verkoop je in de Europese Unie?"
    },
    yes: "Ja",
    no: "Nee",
    back: "Vorige",
    restart: "Opnieuw beginnen",
    result: "Jouw uitkomst",
    todo: "Wat kun je nu doen?",
    basis: "Grondslag",
    disclaimer: "Indicatie op basis van de Europese regels (stand oktober 2026). Geen juridisch advies.",
    cta: "Vraag een demo aan",
    ctaText: "Met VeriPasso maak je in één dag je eerste paspoort met een vaste QR-code.",
    levels: { required: "Verplicht", expected: "Verwacht", none: "Geen verplichting" }
  },
  en: {
    step: "Question",
    of: "of",
    q: {
      category: "What kind of product do you sell?",
      batteryType: "What type of battery is it?",
      role: "What is your role?",
      eu: "Do you sell in the European Union?"
    },
    yes: "Yes",
    no: "No",
    back: "Back",
    restart: "Start again",
    result: "Your result",
    todo: "What can you do now?",
    basis: "Legal basis",
    disclaimer: "Indication based on EU rules (as of October 2026). Not legal advice.",
    cta: "Request a demo",
    ctaText: "With VeriPasso your first passport with a permanent QR code is live within a day.",
    levels: { required: "Mandatory", expected: "Expected", none: "No obligation" }
  }
};

const LEVEL_STYLE = {
  required: "bg-[#ffe9e3] text-[#a3300f]",
  expected: "bg-[#fff4d6] text-[#7a5600]",
  none: "bg-[#e6f7d6] text-[#2f6b00]"
};

function Option({ label, onClick, selected }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`site-card w-full cursor-pointer px-5 py-4 text-left text-[1.0625rem] font-semibold hover:border-[var(--blue)] ${selected ? "!border-[var(--blue)] ring-2 ring-[var(--blue)]/30" : ""}`}
    >
      {label}
    </button>
  );
}

export default function DppCheck({ lang = "nl" }) {
  const t = TEXT[lang];
  const [answers, setAnswers] = useState({});
  const [history, setHistory] = useState([]);

  const steps = ["category", ...(answers.category === "battery" ? ["batteryType"] : []), "role", "eu"];
  const current = steps.find((s) => (s === "eu" ? answers.sellsInEu === undefined : answers[s] === undefined));
  const result = current ? null : evaluate(answers, lang);

  const answer = (patch) => {
    setHistory((h) => [...h, answers]);
    setAnswers((a) => ({ ...a, ...patch }));
  };
  const back = () => {
    setAnswers(history[history.length - 1] || {});
    setHistory((h) => h.slice(0, -1));
  };
  const restart = () => { setAnswers({}); setHistory([]); };

  const index = current ? steps.indexOf(current) : steps.length;
  const progress = Math.round((index / steps.length) * 100);

  return (
    <div className="rounded-3xl border border-[var(--line)] bg-white p-5 shadow-[0_30px_60px_-40px_rgba(10,35,66,.5)] sm:p-8">
      <div className="h-2 overflow-hidden rounded-full bg-[#e8eef8]" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--lime)] transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {current && (
        <div className="mt-6" aria-live="polite">
          <p className="text-sm font-semibold text-[var(--muted)]">{t.step} {index + 1} {t.of} {steps.length}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{t.q[current]}</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {current === "category" && CATEGORIES.map((c) => (
              <Option key={c.id} label={c[lang]} selected={answers.category === c.id} onClick={() => answer({ category: c.id })} />
            ))}
            {current === "batteryType" && BATTERY_TYPES.map((b) => (
              <Option key={b.id} label={b[lang]} onClick={() => answer({ batteryType: b.id })} />
            ))}
            {current === "role" && ROLES.map((r) => (
              <Option key={r.id} label={r[lang]} onClick={() => answer({ role: r.id })} />
            ))}
            {current === "eu" && (
              <>
                <Option label={t.yes} onClick={() => answer({ sellsInEu: true })} />
                <Option label={t.no} onClick={() => answer({ sellsInEu: false })} />
              </>
            )}
          </div>
          {history.length > 0 && (
            <button type="button" onClick={back} className="mt-6 cursor-pointer text-sm font-semibold text-[var(--blue)]">← {t.back}</button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-6" aria-live="polite">
          <p className="text-sm font-semibold text-[var(--muted)]">{t.result}</p>
          <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-bold ${LEVEL_STYLE[result.level]}`}>{t.levels[result.level]}</span>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">{result.title}</h2>
          <p className="mt-3 text-lg text-[#1d2b40]">{result.text}</p>
          {result.actions.length > 0 && (
            <>
              <h3 className="mt-6 font-semibold">{t.todo}</h3>
              <ul className="mt-2 space-y-2">
                {result.actions.map((a) => (
                  <li key={a} className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--lime)]" aria-hidden="true" />{a}</li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-6 text-sm text-[var(--muted)]">{t.basis}: {result.legal}. {t.disclaimer}</p>
          <div className="site-hero mt-6 rounded-2xl p-6">
            <p className="text-white/85">{t.ctaText}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a className="site-btn" href="/#start">{t.cta}</a>
              <button type="button" onClick={restart} className="site-btn-ghost cursor-pointer bg-transparent text-white">{t.restart}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
