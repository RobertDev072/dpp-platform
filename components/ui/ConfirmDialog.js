"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";

// Bevestiging voor (destructieve) acties. Gebruik als component, of via de hook:
//   const confirm = useConfirm();
//   if (await confirm({ title: "Archiveren?", tone: "danger", confirmLabel: "Archiveren" })) { ... }
export default function ConfirmDialog({ open, title, description, confirmLabel = "Bevestigen", cancelLabel = "Annuleren", tone = "default", loading = false, onConfirm, onCancel, children }) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={loading ? undefined : onCancel}
      dismissable={!loading}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "accent"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children || <p className="text-sm text-slate-600">Weet je het zeker?</p>}
    </Modal>
  );
}

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setState(options || {});
      }),
    []
  );

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(state)}
        title={state?.title || "Weet je het zeker?"}
        confirmLabel={state?.confirmLabel}
        tone={state?.tone}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      >
        {state?.message ? <p className="text-sm text-slate-600">{state.message}</p> : undefined}
      </ConfirmDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    // Buiten de provider (zou niet moeten): val terug op de browserdialoog.
    return async (options) => window.confirm(options?.message || options?.title || "Weet je het zeker?");
  }
  return confirm;
}
