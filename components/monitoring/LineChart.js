"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Handgeschreven inline-SVG-lijngrafiek voor het observability-dashboard.
// Bewuste keuzes (volgen de dashboardrichtlijnen):
// - Max. 2 series; bij 2 series een verplichte legenda met vaste serieskleuren.
// - Y-as begint altijd bij 0; rustige hairline-gridlijnen (1px, effen).
// - Aslabels en waarden in gedempte tekstkleur, nooit in de serieskleur.
// - Hover/focus: verticale crosshair die naar het dichtstbijzijnde meetpunt
//   snapt + één tooltip met de waarde(n) van álle series op dat tijdstip.
// - Gaten (null-waarden) breken de lijn: geen nepdata tussen echte metingen.

const PAD = { top: 10, right: 12, bottom: 24, left: 64 };

function niceCeil(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  if (frac <= 1) return base;
  if (frac <= 2) return 2 * base;
  if (frac <= 2.5) return 2.5 * base;
  if (frac <= 5) return 5 * base;
  return 10 * base;
}

export default function LineChart({
  timestamps,
  series, // [{ name, color, values: [number|null] }] — zelfde lengte als timestamps
  height = 210,
  label,
  formatValue = (v) => String(v),
  formatTimeShort = (iso) => String(iso),
  formatTimeLong = (iso) => String(iso)
}) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    setWidth(el.clientWidth || 0);
    return () => observer.disconnect();
  }, []);

  const n = timestamps.length;

  const maxValue = useMemo(() => {
    let max = 0;
    for (const s of series) {
      for (const v of s.values) {
        if (v != null && v > max) max = v;
      }
    }
    return max;
  }, [series]);

  const yMax = niceCeil(maxValue || 1);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);

  const xFor = (i) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => PAD.top + plotH - (Math.max(0, v) / yMax) * plotH;

  // Lijnpad per serie; null-waarden tillen de "pen" op zodat gaten zichtbaar blijven.
  function pathFor(values) {
    let d = "";
    let penDown = false;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v == null) {
        penDown = false;
        continue;
      }
      d += `${penDown ? " L" : " M"}${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`;
      penDown = true;
    }
    return d;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const xTickIndices = useMemo(() => {
    if (n <= 4) return timestamps.map((_, i) => i);
    const raw = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
    return [...new Set(raw)];
  }, [n, timestamps]);

  function moveTo(clientX, rect) {
    const x = clientX - rect.left;
    const ratio = plotW > 0 ? (x - PAD.left) / plotW : 0;
    const idx = Math.round(ratio * (n - 1));
    setHoverIndex(Math.max(0, Math.min(n - 1, idx)));
  }

  function handlePointerMove(event) {
    moveTo(event.clientX, event.currentTarget.getBoundingClientRect());
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setHoverIndex((prev) => {
        const base = prev == null ? n - 1 : prev;
        return Math.max(0, Math.min(n - 1, base + delta));
      });
    }
  }

  if (n < 2) return null;

  const hoverX = hoverIndex != null ? xFor(hoverIndex) : null;
  const tooltipOnLeft = hoverX != null && width > 0 && hoverX > width * 0.6;

  return (
    <div ref={containerRef} className="relative">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4">
          {series.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {width > 0 && (
        <svg
          width="100%"
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="block touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
          onFocus={() => setHoverIndex((prev) => (prev == null ? n - 1 : prev))}
          onBlur={() => setHoverIndex(null)}
          onKeyDown={handleKeyDown}
        >
          {/* Gridlijnen + y-aslabels (gedempt, tabular-nums) */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke={tick === 0 ? "#cbd5e1" : "#e2e8f0"}
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yFor(tick) + 3}
                textAnchor="end"
                fontSize="10"
                fill="#94a3b8"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}

          {/* X-aslabels */}
          {xTickIndices.map((i) => (
            <text
              key={i}
              x={xFor(i)}
              y={PAD.top + plotH + 16}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="10"
              fill="#94a3b8"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatTimeShort(timestamps[i])}
            </text>
          ))}

          {/* Crosshair (onder de lijnen zodat de series leesbaar blijven) */}
          {hoverX != null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="#94a3b8"
              strokeWidth="1"
            />
          )}

          {/* Series: dunne lijnen (2px), ronde joins */}
          {series.map((s) => (
            <path
              key={s.name}
              d={pathFor(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Hoverpunten met 2px surface-ring */}
          {hoverIndex != null &&
            series.map((s) =>
              s.values[hoverIndex] != null ? (
                <circle
                  key={s.name}
                  cx={xFor(hoverIndex)}
                  cy={yFor(s.values[hoverIndex])}
                  r="4"
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              ) : null
            )}
        </svg>
      )}

      {/* Tooltip: waarde eerst (vet), seriesnaam erachter; tijdstip erboven. */}
      {hoverIndex != null && hoverX != null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[8rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            top: PAD.top + (series.length > 1 ? 22 : 0),
            left: tooltipOnLeft ? hoverX - 10 : hoverX + 10,
            transform: tooltipOnLeft ? "translateX(-100%)" : undefined
          }}
        >
          <div className="mb-1 text-slate-500">{formatTimeLong(timestamps[hoverIndex])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 py-0.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="font-semibold tabular-nums text-slate-900">
                {s.values[hoverIndex] != null ? formatValue(s.values[hoverIndex]) : "—"}
              </span>
              {series.length > 1 && <span className="text-slate-500">{s.name}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
