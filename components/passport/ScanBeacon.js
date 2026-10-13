"use client";

import { useEffect } from "react";

// Meldt één scan per weergave van het publieke paspoort. Nodig omdat de pagina zelf
// aan de rand gecachet wordt: niet elke weergave bereikt de server. sendBeacon is
// licht, blokkeert de pagina niet en werkt ook als de bezoeker direct wegnavigeert.
// Eigen pad (/api/scan/), zodat alleen dit verzoek via de Cloudflare Worker loopt.
export default function ScanBeacon({ publicId }) {
  useEffect(() => {
    const url = `/api/scan/${encodeURIComponent(publicId)}`;
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    } catch {
      // val terug op fetch
    }
    fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, [publicId]);
  return null;
}
