"use client";

import { useEffect } from "react";

// Meldt één scan per weergave van het publieke paspoort. Nodig omdat de pagina zelf
// door CloudFront gecachet wordt: niet elke weergave bereikt de server. sendBeacon is
// licht, blokkeert de pagina niet en werkt ook als de bezoeker direct wegnavigeert.
export default function ScanBeacon({ publicId }) {
  useEffect(() => {
    const url = `/api/public/products/${encodeURIComponent(publicId)}/scan`;
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    } catch {
      // val terug op fetch
    }
    fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, [publicId]);
  return null;
}
