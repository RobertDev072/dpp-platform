"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Bevestiging voor destructieve of ingrijpende acties. Gebruik via de hook:
//   const [confirm, dialog] = useConfirm();
//   if (await confirm({ title, description, confirmLabel, tone: "danger" })) { ... }
//   ...en render {dialog} ergens in de component.
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setState(options);
      }),
    []
  );

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(null);
  }, []);

  const dialog = state ? <ConfirmDialog {...state} onConfirm={() => close(true)} onCancel={() => close(false)} /> : null;
  return [confirm, dialog];
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel = "Bevestigen",
  cancelLabel = "Annuleren",
  tone = "primary",
  onConfirm,
  onCancel
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const confirmClasses =
    tone === "danger" ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500" : "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? "confirm-description" : undefined}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {description && (
          <div id="confirm-description" className="mt-2 text-sm text-slate-600">
            {description}
          </div>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
