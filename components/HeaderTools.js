"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

// Globale zoekfunctie en meldingen in de header. Alle data komt van de server,
// die tenant en rol bepaalt op basis van de sessie (nooit op basis van de client).

const DISMISS_KEY = "veripasso:dismissed-notifications";

function readDismissed() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeDismissed(set) {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-200)));
  } catch {
    // Opslag niet beschikbaar (privévenster): alleen voor deze sessie verbergen.
  }
}

function useClickOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    function handle(event) {
      if (ref.current && !ref.current.contains(event.target)) close();
    }
    function handleKey(event) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, open, close]);
}

const SEVERITY_DOT = { danger: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500", success: "bg-emerald-500" };

export function NotificationsMenu({ pathname }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const ref = useRef(null);
  const close = useRef(() => setOpen(false)).current;
  useClickOutside(ref, open, close);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  // Eén request per paginawissel is genoeg; geen polling.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/workspace/notifications")
      .then((data) => !cancelled && setItems(data.items || []))
      .catch(() => !cancelled && setItems([]));
    setOpen(false);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const visible = (items || []).filter((item) => !dismissed.has(item.id));

  function dismiss(id) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissed(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        title="Meldingen"
        aria-label={visible.length ? `Meldingen (${visible.length} nieuw)` : "Meldingen"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 3Z" />
          <path d="M8.5 15.5a1.6 1.6 0 0 0 3 0" />
        </svg>
        {visible.length > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {visible.length > 9 ? "9+" : visible.length}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Meldingen" className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Meldingen</p>
            {visible.length > 1 && (
              <button
                type="button"
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
                onClick={() => {
                  const next = new Set(dismissed);
                  visible.forEach((i) => next.add(i.id));
                  setDismissed(next);
                  writeDismissed(next);
                }}
              >
                Alles gelezen
              </button>
            )}
          </div>
          {items === null ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Laden…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Geen nieuwe meldingen. Alles is bijgewerkt.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {visible.map((item) => (
                <li key={item.id} className="flex gap-3 px-4 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[item.severity] || SEVERITY_DOT.info}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                    <div className="mt-1.5 flex gap-3 text-xs">
                      {item.href && (
                        <Link href={item.href} onClick={() => setOpen(false)} className="font-medium text-emerald-700 hover:underline">
                          Bekijken
                        </Link>
                      )}
                      <button type="button" onClick={() => dismiss(item.id)} className="text-slate-500 hover:text-slate-700">
                        Verbergen
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const close = useRef(() => setOpen(false)).current;
  useClickOutside(ref, open, close);

  // Sneltoets: "/" of Ctrl/Cmd+K focust de zoekbalk.
  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable;
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounce: één request na 250 ms stilte.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResult(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/api/workspace/search?q=${encodeURIComponent(term)}`)
        .then((data) => !cancelled && setResult(data))
        .catch(() => !cancelled && setResult({ groups: [] }))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const flat = (result?.groups || []).flatMap((g) => g.items);

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      <label className="sr-only" htmlFor="global-search">
        Zoeken
      </label>
      <div className="relative">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          ref={inputRef}
          id="global-search"
          type="search"
          value={q}
          autoComplete="off"
          placeholder="Zoeken…  (/)"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && flat[0]) {
              setOpen(false);
              router.push(flat[0].href);
            }
          }}
          className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {loading && !result ? (
            <p className="px-4 py-4 text-sm text-slate-500">Zoeken…</p>
          ) : !result || result.groups.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">Niets gevonden voor &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {result.groups.map((group) => (
                <div key={group.type} className="py-1">
                  <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-slate-400">{group.label}</p>
                  {group.items.map((item) => (
                    <Link
                      key={`${group.type}-${item.id}`}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-1.5 hover:bg-slate-50"
                    >
                      <span className="block truncate text-sm text-slate-900">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
