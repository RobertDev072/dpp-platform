"use client";

import { useEffect } from "react";

// Meldt een QR-scan van het publieke paspoort. De pagina zelf wordt aan de rand
// gecachet, dus de scan wordt apart gemeld (POST /api/scan/<id>, via de Cloudflare
// Worker). Alleen wat waarschijnlijk een echte scan is, wordt gemeld - een webbezoek is
// technisch niet van een camera-scan te onderscheiden, daarom sluiten we uit wat
// aantoonbaar géén scan is:
//   - links vanuit de VeriPasso-app (?src=app, of verwijzer app.veripasso.com);
//   - verversen en terug/vooruit (Navigation Timing: reload / back_forward);
//   - geautomatiseerde browsers (navigator.webdriver);
//   - prerender en tabbladen op de achtergrond (pas melden als de pagina zichtbaar is).
// Er wordt niets op het apparaat opgeslagen (geen cookie, geen localStorage). De Worker
// en de server tellen daarnaast één scan per apparaat per paspoort per 30 minuten en
// weren bots. Zie docs/scans.md.
const APP_HOSTS = ["app.veripasso.com", "localhost"];

function isInternalVisit() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("src") === "app") return true;
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (APP_HOSTS.includes(host) && host !== window.location.hostname) return true;
    }
  } catch {
    // ongeldige verwijzer: niet intern
  }
  return false;
}

function isRepeatNavigation() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    return nav ? nav.type === "reload" || nav.type === "back_forward" : false;
  } catch {
    return false;
  }
}

function send(publicId) {
  const url = `/api/scan/${encodeURIComponent(publicId)}`;
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
  } catch {
    // val terug op fetch
  }
  fetch(url, { method: "POST", keepalive: true, credentials: "omit" }).catch(() => {});
}

export default function ScanBeacon({ publicId }) {
  useEffect(() => {
    if (navigator.webdriver || isInternalVisit() || isRepeatNavigation()) return;
    // Interne marker niet laten staan: een gedeelde of later verversde URL zonder ?src=app
    // is weer een gewone (externe) link.
    if (new URLSearchParams(window.location.search).has("src")) {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        // niet kritiek
      }
    }
    if (document.visibilityState === "visible" && !document.prerendering) {
      send(publicId);
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !document.prerendering) {
        document.removeEventListener("visibilitychange", onVisible);
        document.removeEventListener("prerenderingchange", onVisible);
        send(publicId);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("prerenderingchange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("prerenderingchange", onVisible);
    };
  }, [publicId]);
  return null;
}
