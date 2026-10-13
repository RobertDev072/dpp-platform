"use client";

import { useEffect } from "react";

// Meldt een scan van het publieke paspoort. Nodig omdat de pagina zelf aan de rand
// gecachet wordt: niet elke weergave bereikt de server. sendBeacon is licht, blokkeert
// de pagina niet en werkt ook als de bezoeker direct wegnavigeert.
// Eigen pad (/api/scan/), zodat alleen dit verzoek via de Cloudflare Worker loopt.
//
// Eén scan per apparaat per paspoort per 30 minuten: refreshen, terugnavigeren of een
// nieuw tabblad telt niet opnieuw. Het tijdstip staat alleen in deze browser
// (localStorage, geen cookie). De Worker en de server passen dezelfde regel toe als
// vangnet, voor het geval de browser geen opslag toestaat.
const WINDOW_MS = 30 * 60 * 1000;

function alreadyCounted(publicId) {
  try {
    const key = `vp-scan:${String(publicId).toLowerCase()}`;
    const last = Number(window.localStorage.getItem(key));
    const now = Date.now();
    if (last && now - last < WINDOW_MS) return true;
    window.localStorage.setItem(key, String(now));
  } catch {
    // Geen opslag (privévenster, geblokkeerd): de server bewaakt de 30 minuten.
  }
  return false;
}

export default function ScanBeacon({ publicId }) {
  useEffect(() => {
    if (alreadyCounted(publicId)) return;
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
