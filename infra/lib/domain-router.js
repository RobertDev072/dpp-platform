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
// /_next/* en /brand/* (bestanden van de pagina's), /products/* (productfoto's uit S3),
// favicon/icon. Nooit toegestaan: /api/internal/* (alleen voor directe Lambda-aanroepen).
//
// Paspoorten (/p/*) worden 5 minuten aan de rand gecachet met de Accept-header in de
// cachesleutel. Browsers sturen allemaal een net andere Accept; die wordt hier omgezet
// naar "text/html", zodat ze één cache-ingang delen. Systemen die JSON, JSON-LD of XML
// vragen (zelfde regel als de rewrite in next.config.mjs) houden hun eigen Accept.

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

function notFound() {
  return { statusCode: 404, statusDescription: "Not Found", headers: { "cache-control": { value: "no-store" } } };
}

function normalizeAccept(request) {
  var accept = (request.headers.accept && request.headers.accept.value || "").toLowerCase();
  var machine = accept.indexOf("text/html") === -1 && /application\\/(?:ld\\+json|json|xml)/.test(accept);
  if (!machine) request.headers.accept = { value: "text/html" };
}

function handler(event) {
  var request = event.request;
  var host = (request.headers.host && request.headers.host.value || "").toLowerCase();
  var uri = request.uri;
  var qs = request.querystring;
  var home = CANONICAL_SITE || APP;

  if (uri === "/api/internal" || uri.indexOf("/api/internal/") === 0) return notFound();

  // Gedeelde onderdelen: overal laten passeren.
  if (uri.indexOf("/api/") === 0 || uri.indexOf("/_next/") === 0 || uri.indexOf("/brand/") === 0 ||
      uri.indexOf("/products/") === 0 || uri === "/favicon.ico" || uri === "/icon.png" || uri === "/robots.txt") {
    return request;
  }

  // Hoofddomein zonder www -> één vast adres voor de landingspagina.
  if (CANONICAL_SITE && SITE.indexOf(host) !== -1 && host !== CANONICAL_SITE) {
    return redirect(301, CANONICAL_SITE, uri, qs);
  }

  // Paspoorten horen op het QR-domein (gedrukte codes wijzen daar altijd al naar).
  if (uri.indexOf("/p/") === 0 && host !== QR) {
    return redirect(301, QR, uri, qs);
  }

  if (CANONICAL_SITE && host === CANONICAL_SITE) {
    if (startsWithAny(uri, APP_PREFIXES)) return redirect(302, APP, uri, qs);
    return request;
  }

  if (host === APP) {
    if (uri === "/") return redirect(302, APP, "/login", qs);
    return request;
  }

  if (host === QR) {
    if (uri.indexOf("/p/") === 0) {
      normalizeAccept(request);
      return request;
    }
    if (startsWithAny(uri, APP_PREFIXES)) return redirect(302, APP, uri, qs);
    return redirect(302, home, uri === "/" ? (home === APP ? "/login" : "/") : uri, qs);
  }

  return request;
}
`;
}

module.exports = { buildRouterCode, APP_PREFIXES };
