"use client";

import { COMPLETENESS_ITEMS } from "@/lib/completeness";
import { QR_STATUS_LABELS } from "@/components/ui/StatusBadge";
import { AlertIcon, CheckIcon, ChevronRightIcon } from "@/components/ui/icons";

function tone(pct) {
  if (pct >= 100) return { bar: "bg-emerald-500", text: "text-emerald-700" };
  if (pct >= 70) return { bar: "bg-blue-500", text: "text-blue-700" };
  return { bar: "bg-amber-500", text: "text-amber-700" };
}

// Score + checklist. Een ontbrekend onderdeel is een knop die direct naar de juiste
// sectie van de editor springt (onNavigate(tab, field)).
export default function ProductCompleteness({ completeness = 0, checks = {}, qrStatus, onNavigate }) {
  const pct = Math.max(0, Math.min(100, Math.round(completeness)));
  const t = tone(pct);
  const missing = COMPLETENESS_ITEMS.filter((item) => !checks[item.key]).length;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className={`text-2xl font-semibold tabular-nums ${t.text}`}>{pct}%</p>
        <p className="text-xs text-slate-500">{missing === 0 ? "Paspoort compleet" : `${missing} ${missing === 1 ? "onderdeel ontbreekt" : "onderdelen ontbreken"}`}</p>
      </div>
      <div role="progressbar" aria-label="Compleetheid" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 space-y-1">
        {COMPLETENESS_ITEMS.map((item) => {
          const ok = Boolean(checks[item.key]);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onNavigate?.(item.tab, item.field)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${ok ? "text-slate-600" : "font-medium text-slate-900"}`}
              >
                {ok ? <CheckIcon size={16} className="text-emerald-600" /> : <AlertIcon size={16} className="text-amber-500" />}
                <span className="flex-1">{item.label}</span>
                {!ok && (
                  <>
                    <span className="text-xs font-normal text-amber-700">aanvullen</span>
                    <ChevronRightIcon size={14} className="text-slate-400" />
                  </>
                )}
              </button>
            </li>
          );
        })}
        {qrStatus && (
          <li>
            <button
              type="button"
              onClick={() => onNavigate?.("qr")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {qrStatus === "active" ? <CheckIcon size={16} className="text-emerald-600" /> : <AlertIcon size={16} className="text-slate-400" />}
              <span className="flex-1">QR-code</span>
              <span className="text-xs">{QR_STATUS_LABELS[qrStatus]}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
