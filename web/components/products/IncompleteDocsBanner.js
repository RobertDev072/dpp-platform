"use client";

import { useState } from "react";

// Amberkleurige waarschuwing wanneer producten verplichte documentatie missen.
// Wegklikbaar per sessie; "Bekijk producten" zet het doc=incompleet-filter.

export default function IncompleteDocsBanner({ count, onView }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !count) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-amber-500"
      >
        <path
          d="M10.3 4.3 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M12 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="16.75" r="1" fill="currentColor" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {count} {count === 1 ? "product mist" : "producten missen"} verplichte documentatie
        </p>
        <p className="mt-0.5 text-amber-700">
          Deze producten zijn nog niet volledig conform de DPP-vereisten.
        </p>
        <button
          type="button"
          onClick={onView}
          className="mt-1.5 font-medium text-amber-800 underline-offset-2 hover:underline"
        >
          Bekijk producten →
        </button>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Melding sluiten"
        className="shrink-0 rounded-lg p-1 leading-none text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
