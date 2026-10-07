"use client";

import { useEffect, useState } from "react";
import { computeLayout } from "@/src/services/printLayout";
import { labelBoxes, labelLines, SAMPLE_ITEM } from "@/lib/print/labelLayout";

// Schaalbare voorvertoning van één pagina: alle labelposities, en het eerste
// label (en eventueel meer) ingevuld met een (voorbeeld)product. Zelfde layout-
// functies als de PDF-generator.
function QrPattern({ url, x, y, size, settings }) {
  const [modules, setModules] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((mod) => {
      const QRCode = mod.default || mod;
      const qr = QRCode.create(url, { errorCorrectionLevel: settings.qr.errorCorrection });
      if (!cancelled) setModules(qr.modules);
    });
    return () => {
      cancelled = true;
    };
  }, [url, settings.qr.errorCorrection]);

  const quiet = settings.qr.quietZoneModules;
  if (!modules) return <rect x={x} y={y} width={size} height={size} fill="#e2e8f0" />;
  const count = modules.size;
  const m = size / (count + 2 * quiet);
  const rects = [];
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (modules.data[r * count + c]) {
        rects.push(<rect key={`${r}-${c}`} x={x + (quiet + c) * m} y={y + (quiet + r) * m} width={m + 0.01} height={m + 0.01} />);
      }
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill={settings.qr.background} />
      <g fill={settings.qr.color}>{rects}</g>
    </g>
  );
}

function Label({ settings, layout, origin, item, boxes }) {
  const PT_TO_MM = 25.4 / 72;
  const lines = labelLines(settings, item);
  let cursor = boxes.text ? boxes.text.y : 0;
  return (
    <g transform={`translate(${origin.x} ${origin.y})`}>
      <rect width={layout.labelWidth} height={layout.labelHeight} rx="1" fill="#fff" stroke="#94a3b8" strokeWidth="0.25" strokeDasharray="1 0.8" />
      {boxes.qr && <QrPattern url={item.qr_url || SAMPLE_ITEM.qr_url} x={boxes.qr.x} y={boxes.qr.y} size={boxes.qr.size} settings={settings} />}
      {boxes.caption && (
        <text x={boxes.caption.x + boxes.caption.w / 2} y={boxes.caption.y + 2.2} fontSize={boxes.fontSmall * 0.85 * PT_TO_MM} textAnchor="middle" fill="#475569">
          {settings.qr.caption}
        </text>
      )}
      {boxes.text &&
        lines.map((line, index) => {
          const size = (line.bold && line.wrap ? boxes.fontName : boxes.fontSmall) * PT_TO_MM;
          cursor += size * 1.2;
          if (cursor > boxes.text.y + boxes.text.h + 0.5) return null;
          return (
            <text
              key={index}
              x={boxes.center ? boxes.text.x + boxes.text.w / 2 : boxes.text.x}
              y={cursor - size * 0.25}
              fontSize={size}
              fontWeight={line.bold ? 700 : 400}
              textAnchor={boxes.center ? "middle" : "start"}
              fill={line.bold ? "#0f172a" : "#475569"}
              style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
            >
              {line.text.length > 60 ? `${line.text.slice(0, 57)}...` : line.text}
            </text>
          );
        })}
    </g>
  );
}

export default function PrintPreview({ settings, items, maxFilled = 3, className = "" }) {
  const layout = computeLayout(settings);
  const boxes = labelBoxes(settings, layout.labelWidth, layout.labelHeight);
  const filled = (items && items.length ? items : [SAMPLE_ITEM]).slice(0, maxFilled);
  return (
    <svg
      viewBox={`0 0 ${layout.page.width} ${layout.page.height}`}
      className={`h-auto w-full rounded border border-slate-300 bg-white shadow-sm ${className}`}
      role="img"
      aria-label={`Voorvertoning: ${layout.perPage} labels per pagina van ${layout.labelWidth.toFixed(1)} × ${layout.labelHeight.toFixed(1)} mm`}
    >
      <rect width={layout.page.width} height={layout.page.height} fill="#fff" />
      {layout.positions.map((origin, index) =>
        index < filled.length ? (
          <Label key={index} settings={settings} layout={layout} origin={origin} item={filled[index]} boxes={boxes} />
        ) : (
          <rect
            key={index}
            x={origin.x}
            y={origin.y}
            width={layout.labelWidth}
            height={layout.labelHeight}
            rx="1"
            fill="#f8fafc"
            stroke="#cbd5e1"
            strokeWidth="0.25"
            strokeDasharray="1 0.8"
          />
        )
      )}
    </svg>
  );
}
