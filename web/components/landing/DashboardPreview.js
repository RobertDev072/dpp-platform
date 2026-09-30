"use client";

import { useEffect, useState } from "react";
import useInView from "./useInView";
import { VeriPassoIcon } from "./VeriPassoLogo";

const STATS = [
  { label: "Klantbedrijven", value: 9 },
  { label: "Actieve bedrijven", value: 9 },
  { label: "Actieve gebruikers", value: 17 },
  { label: "Producten (concept)", value: 10 },
  { label: "Gepubliceerde DPP's", value: 1 },
  { label: "Gearchiveerd", value: 0 },
  { label: "QR-scans", value: 0 },
  { label: "Openstaande uitnodigingen", value: 0 }
];

const NAV_ITEMS = ["Overzicht", "Partners", "Klantbedrijven", "Alle gebruikers", "Abonnementen", "Auditlog"];

const BLUE_LINE = "M0,70 C40,20 80,20 120,50 C160,80 200,90 240,55 C280,20 320,15 360,45 C400,75 440,85 480,55 C520,25 560,20 600,50 C640,80 660,75 700,60";
const GREEN_LINE = "M0,90 C40,80 80,95 120,85 C160,75 200,60 240,70 C280,80 320,90 360,75 C400,60 440,55 480,68 C520,80 560,85 600,70 C640,58 660,55 700,65";

function useCountUp(target, active, duration = 1100) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    if (target === 0) {
      setValue(0);
      return undefined;
    }

    let raf;
    let start = null;

    const step = (timestamp) => {
      if (start === null) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      setValue(Math.round(progress * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);

  return value;
}

function StatTile({ label, value, active }) {
  const count = useCountUp(value, active);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
      <p className="text-xl font-semibold text-white">{count}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

export default function DashboardPreview() {
  const [ref, inView] = useInView({ threshold: 0.2 });

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#06162A] shadow-2xl"
    >
      <div className="flex">
        <aside className="hidden w-40 flex-col gap-1 border-r border-white/10 bg-[#050f1e] p-3 sm:flex">
          <div className="mb-2 flex items-center gap-1.5 px-1">
            <VeriPassoIcon className="h-4 w-4" />
            <span className="text-xs font-semibold text-white">VeriPasso</span>
          </div>
          {NAV_ITEMS.map((item, index) => (
            <div
              key={item}
              className={`rounded-md px-2 py-1.5 text-[11px] ${
                index === 0 ? "bg-[#1476FF] text-white" : "text-slate-400"
              }`}
            >
              {item}
            </div>
          ))}
        </aside>

        <div className="flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Overzicht</h4>
            <span className="text-[11px] text-slate-500">naam@uwbedrijf.nl</span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATS.map((stat) => (
              <StatTile key={stat.label} label={stat.label} value={stat.value} active={inView} />
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-300">Productactiviteit</span>
              <span className="text-[10px] text-slate-500">Afgelopen 30 dagen</span>
            </div>
            <svg viewBox="0 0 700 100" className="h-20 w-full" preserveAspectRatio="none">
              <path
                d={BLUE_LINE}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength="1"
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: inView ? 0 : 1,
                  transition: "stroke-dashoffset 1.6s ease"
                }}
              />
              <path
                d={GREEN_LINE}
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength="1"
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: inView ? 0 : 1,
                  transition: "stroke-dashoffset 1.6s ease 0.2s"
                }}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
