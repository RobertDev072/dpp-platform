"use client";

import { useId, useRef, useState } from "react";
import { FileIcon, UploadIcon, XIcon } from "./icons";

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

// Sleep-en-neerzet of klik om te kiezen. Controleert extensie en grootte vóór de
// upload; de server controleert daarna opnieuw (extensie, inhoud en grootte).
export default function FileDropzone({
  accept,
  extensions = [],
  maxSizeMb,
  onFile,
  file,
  onClear,
  disabled = false,
  error,
  label = "Sleep een bestand hierheen",
  hint,
  compact = false
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState("");
  const errorId = useId();

  function pick(candidate) {
    if (!candidate) return;
    const ext = candidate.name.toLowerCase().split(".").pop();
    if (extensions.length && !extensions.includes(ext)) {
      setLocalError(`Dit bestandstype wordt niet ondersteund. Kies een ${extensions.map((e) => `.${e}`).join(", ")}-bestand.`);
      return;
    }
    if (maxSizeMb && candidate.size > maxSizeMb * 1024 * 1024) {
      setLocalError(`Het bestand is te groot (${formatSize(candidate.size)}; maximaal ${maxSizeMb} MB).`);
      return;
    }
    setLocalError("");
    onFile(candidate);
  }

  const shownError = localError || error;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (!disabled) pick(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${compact ? "px-4 py-5" : "px-6 py-10"} ${
          dragActive ? "border-emerald-500 bg-emerald-50" : shownError ? "border-red-300 bg-red-50/40" : "border-slate-300 bg-slate-50/60"
        } ${disabled ? "opacity-60" : ""}`}
      >
        {file ? (
          <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left">
            <FileIcon size={20} className="text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
              <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
            </div>
            {onClear && !disabled && (
              <button type="button" onClick={onClear} aria-label="Bestand verwijderen" title="Bestand verwijderen" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <XIcon size={16} />
              </button>
            )}
          </div>
        ) : (
          <>
            <span aria-hidden="true" className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm">
              <UploadIcon size={20} />
            </span>
            <p className="text-sm font-medium text-slate-700">{label}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              of{" "}
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="font-medium text-emerald-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                kies een bestand
              </button>
            </p>
            {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-describedby={shownError ? errorId : undefined}
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {shownError && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-red-600">
          {shownError}
        </p>
      )}
    </div>
  );
}
