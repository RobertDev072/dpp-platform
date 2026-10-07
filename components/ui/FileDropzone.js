"use client";

import { useRef, useState } from "react";

// Sleep-en-neerzetzone met klikbare fallback ("Bestand kiezen").
export default function FileDropzone({ accept, onFile, title = "Sleep je bestand hierheen", hint, disabled = false, buttonLabel = "Bestand kiezen" }) {
  const inputRef = useRef(null);
  const [active, setActive] = useState(false);

  function pick(file) {
    if (file && !disabled) onFile(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setActive(false);
        pick(event.dataTransfer?.files?.[0]);
      }}
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        active ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600" aria-hidden="true">
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <p className="mt-3 text-sm font-medium text-slate-800">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
