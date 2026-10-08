"use client";

import { useEffect, useRef } from "react";

export default function Tabs({ tabs, active, onChange }) {
  const listRef = useRef(null);
  // Op smalle schermen scrolt de tabbalk; houd het actieve tabblad in beeld.
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    if (el && listRef.current.scrollWidth > listRef.current.clientWidth) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);
  return (
    <div ref={listRef} role="tablist" className="flex gap-4 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium ${
              isActive
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
