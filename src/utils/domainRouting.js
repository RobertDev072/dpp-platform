// Domeinverdeling: elk domein heeft één rol, verkeer naar de verkeerde plek wordt
// doorgestuurd. Wordt toegepast in proxy.js (Next.js) vóór elke pagina.
//
//   SITE_DOMAINS (bijv. veripasso.com,www.veripasso.com): landingspagina; de eerste met
//                 "www." (of anders de eerste) is het vaste adres
//   APP_DOMAIN   (app.veripasso.com): de SaaS
//   QR_DOMAIN    (qr.veripasso.com): QR-scans en paspoorten (permanent, staat op elke code)
//
// Zonder APP_DOMAIN/QR_DOMAIN (lokaal ontwikkelen) gebeurt er niets: alles op één adres.
// Altijd en op elk domein toegestaan: /api/* (de pagina's roepen de API relatief aan),
// /_next/*, /brand/*, favicon/icon/robots.

const APP_PREFIXES = ["/login", "/admin", "/company", "/partner", "/activate", "/wachtwoord-vergeten"];
const SHARED_PREFIXES = ["/api/", "/_next/", "/brand/"];
// Op het QR-domein thuis: paspoorten, GS1 Digital Links (/01/{gtin}...) en de
// DPP-vocabulaire waar dictionaryReference-links naar wijzen.
const QR_PREFIXES = ["/p", "/01", "/vocab"];
const SHARED_FILES = ["/favicon.ico", "/icon.png", "/robots.txt"];

function readDomainConfig(env = process.env) {
  const list = (value) => (value || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const siteDomains = list(env.SITE_DOMAINS);
  return {
    siteDomains,
    canonicalSiteDomain: siteDomains.find((d) => d.startsWith("www.")) || siteDomains[0] || null,
    appDomain: (env.APP_DOMAIN || "").trim().toLowerCase() || null,
    qrDomain: (env.QR_DOMAIN || "").trim().toLowerCase() || null
  };
}

function startsWithAny(path, prefixes) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

// Geeft null (doorlaten) of { status, location } terug. host zonder poort, path zonder
// query; search inclusief "?" (of leeg).
function routeDomain({ host, path, search = "" }, config) {
  const { siteDomains, canonicalSiteDomain: site, appDomain: app, qrDomain: qr } = config;
  if (!app || !qr) return null;
  const h = String(host || "").toLowerCase().replace(/:\d+$/, "");
  const to = (status, targetHost, targetPath) => ({ status, location: `https://${targetHost}${targetPath}${search}` });
  const home = site || app;

  if (SHARED_PREFIXES.some((p) => path.startsWith(p)) || SHARED_FILES.includes(path)) return null;

  // Hoofddomein zonder www -> één vast adres voor de landingspagina.
  if (site && siteDomains.includes(h) && h !== site) return to(301, site, path);

  // Paspoorten horen op het QR-domein (gedrukte codes wijzen daar altijd al naar).
  if (startsWithAny(path, QR_PREFIXES) && h !== qr) return to(301, qr, path);

  if (site && h === site) {
    return startsWithAny(path, APP_PREFIXES) ? to(302, app, path) : null;
  }
  if (h === app) {
    return path === "/" ? to(302, app, "/login") : null;
  }
  if (h === qr) {
    if (startsWithAny(path, QR_PREFIXES)) return null;
    if (startsWithAny(path, APP_PREFIXES)) return to(302, app, path);
    return to(302, home, path === "/" && home === app ? "/login" : path);
  }
  // Onbekende host (bijv. het IP-adres van de server): doorlaten.
  return null;
}

module.exports = { readDomainConfig, routeDomain, APP_PREFIXES };
