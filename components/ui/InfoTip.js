"use client";

import { useState } from "react";

// Kleine uitleg achter een ⓘ. Opent met een klik (ook op telefoons, waar geen hover is);
// de tekst verschijnt direct onder het label.
export default function InfoTip({ text, label = "Uitleg" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={label}
        title={text}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 align-middle text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
      >
        i
      </button>
      {open && <span className="mt-1 block text-xs font-normal text-slate-500">{text}</span>}
    </>
  );
}
