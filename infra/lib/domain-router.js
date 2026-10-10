// Domeinverdeling aan de rand (CloudFront Function, viewer-request). Elk domein heeft één
// rol; verkeer naar de verkeerde plek wordt doorgestuurd. De app zelf hoeft de
// domeinnaam niet te kennen (CloudFront stuurt de Host-header niet door, vanwege de
// versleutelde interne verbinding met origin-certificaat).
//
//   siteDomains (bijv. veripasso.com, www.veripasso.com): landingspagina
//   appDomain   (app.veripasso.com): de SaaS
//   qrDomain    (qr.veripasso.com): QR-scans en paspoorten (permanent, staat op elke code)
//
// Altijd en op elk domein toegestaan: /api/* (de pagina's roepen de API relatief aan),
// /_next/* en /brand/* (bestanden van de pagina's), favicon/icon.

const APP_PREFIXES = ["/login", "/admin", "/company", "/partner", "/activate", "/wachtwoord-vergeten"];

function buildRouterCode({ siteDomains, canonicalSiteDomain, appDomain, qrDomain }) {
  // Pure ES5.1-compatibele code voor cloudfront-js-2.0; configuratie wordt ingebakken.
  return `
var SITE = ${JSON.stringify(siteDomains)};
var CANONICAL_SITE = ${JSON.stringify(canonicalSiteDomain)};
var APP = ${JSON.stringify(appDomain)};
var QR = ${JSON.stringify(qrDomain)};
var APP_PREFIXES = ${JSON.stringify(APP_PREFIXES)};

function startsWithAny(uri, prefixes) {
  for (var i = 0; i < prefixes.length; i++) {
    var p = prefixes[i];
    if (uri === p || uri.indexOf(p + "/") === 0) return true;
  }
  return false;
}

function queryString(qs) {
  var parts = [];
  for (var key in qs) {
    var v = qs[key];
    if (v.multiValue) {
      for (var j = 0; j < v.multiValue.length; j++) parts.push(key + "=" + v.multiValue[j].value);
    } else {
      parts.push(v.value === "" ? key : key + "=" + v.value);
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function redirect(status, host, uri, qs) {
  return {
    statusCode: status,
    statusDescription: status === 301 ? "Moved Permanently" : "Found",
    headers: {
      location: { value: "https://" + host + uri + queryString(qs) },
      "cache-control": { value: status === 301 ? "max-age=3600" : "no-store" }
    }
  };
}

function handler(event) {
  var request = event.request;
  var host = (request.headers.host && request.headers.host.value || "").toLowerCase();
  var uri = request.uri;
  var qs = request.querystring;

  // Gedeelde onderdelen: overal laten passeren.
  if (uri.indexOf("/api/") === 0 || uri.indexOf("/_next/") === 0 || uri.indexOf("/brand/") === 0 ||
      uri === "/favicon.ico" || uri === "/icon.png" || uri === "/robots.txt") {
    return request;
  }

  // Hoofddomein zonder www -> één vast adres voor de landingspagina.
  if (SITE.indexOf(host) !== -1 && host !== CANONICAL_SITE) {
    return redirect(301, CANONICAL_SITE, uri, qs);
  }

  // Paspoorten horen op het QR-domein (gedrukte codes wijzen daar altijd al naar).
  if (uri.indexOf("/p/") === 0 && host !== QR) {
    return redirect(301, QR, uri, qs);
  }

  if (host === CANONICAL_SITE) {
    if (startsWithAny(uri, APP_PREFIXES)) return redirect(302, APP, uri, qs);
    return request;
  }

  if (host === APP) {
    if (uri === "/") return redirect(302, APP, "/login", qs);
    return request;
  }

  if (host === QR) {
    if (uri.indexOf("/p/") === 0) return request;
    if (startsWithAny(uri, APP_PREFIXES)) return redirect(302, APP, uri, qs);
    return redirect(302, CANONICAL_SITE, uri === "/" ? "/" : uri, qs);
  }

  return request;
}
`;
}

module.exports = { buildRouterCode, APP_PREFIXES };
