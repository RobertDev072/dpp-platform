"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { AlertIcon, BellIcon, CheckCircleIcon, ErrorIcon, InfoIcon } from "@/components/ui/icons";

const SEVERITY = {
  error: { Icon: ErrorIcon, className: "bg-red-50 text-red-600" },
  warning: { Icon: AlertIcon, className: "bg-amber-50 text-amber-600" },
  info: { Icon: InfoIcon, className: "bg-blue-50 text-blue-600" },
  success: { Icon: CheckCircleIcon, className: "bg-emerald-50 text-emerald-600" }
};

const STORAGE_KEY = "veripasso.notifications.seen";

function readSeen() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSeen(ids) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Geen opslag beschikbaar (privévenster): dan blijft de teller gewoon staan.
  }
}

// Meldingencentrum achter het bel-icoon. Meldingen worden live berekend op de
// server; "gelezen" onthoudt de browser per melding-id (een id verandert zodra het
// aantal verandert, dus nieuwe situaties verschijnen weer als ongelezen).
export default function NotificationCenter() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => new Set());
  const ref = useRef(null);
  const pathname = usePathname();

  const load = useCallback(() => {
    api
      .get("/api/dashboard/notifications")
      .then((data) => setItems(data.items || []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    setSeen(readSeen());
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = (items || []).filter((item) => !seen.has(item.id)).length;

  function markAllRead() {
    const next = new Set([...seen, ...(items || []).map((i) => i.id)]);
    setSeen(next);
    writeSeen(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Meldingen (${unread} ongelezen)` : "Meldingen"}
        title="Meldingen"
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <BellIcon size={20} />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Meldingen" className="absolute right-0 top-full z-50 mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Meldingen</p>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-emerald-700 hover:underline">
                Alles gelezen
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {items === null ? (
              <p className="px-4 py-3 text-sm text-slate-500">Laden…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <CheckCircleIcon size={24} className="mx-auto text-emerald-500" />
                <p className="mt-2 text-sm text-slate-600">Geen meldingen. Alles is bijgewerkt.</p>
              </div>
            ) : (
              <ul>
                {items.map((item) => {
                  const sev = SEVERITY[item.severity] || SEVERITY.info;
                  const body = (
                    <>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${sev.className}`}>
                        <sev.Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${seen.has(item.id) ? "text-slate-600" : "font-medium text-slate-900"}`}>{item.title}</span>
                        {item.description && <span className="block text-xs text-slate-500">{item.description}</span>}
                      </span>
                      {!seen.has(item.id) && <span aria-label="ongelezen" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.href ? (
                        <Link
                          href={item.href}
                          onClick={() => {
                            const next = new Set([...seen, item.id]);
                            setSeen(next);
                            writeSeen(next);
                          }}
                          className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
