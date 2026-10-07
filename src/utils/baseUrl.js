// Twee bewust gescheiden basis-URL's:
// - APP_BASE_URL: login-/activatie-/applicatielinks (mag ooit wijzigen).
// - QR_BASE_URL: permanente publieke product-/QR-links - geprinte QR-codes bevatten
//   deze URL voorgoed, dus deze mag alleen wijzigen naar een adres dat blijvend
//   wordt doorverwezen. Productie: https://qr.veripasso.com (domein wijst naar Vercel).
// Zonder envvar valt beide terug op de request-host (met trust proxy geeft
// req.protocol dan correct https achter de TLS-terminatie van Vercel).

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function requestOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function getAppBaseUrl(req) {
  const configured = process.env.APP_BASE_URL;
  return configured ? stripTrailingSlash(configured) : requestOrigin(req);
}

function getQrBaseUrl(req) {
  const configured = process.env.QR_BASE_URL;
  return configured ? stripTrailingSlash(configured) : requestOrigin(req);
}

// De URL die in een QR-code komt. De public_id staat in HOOFDLETTERS: zo gaf Azure SQL
// (UNIQUEIDENTIFIER) hem terug, dus alle QR-codes die vóór de migratie zijn
// gedownload/geprint bevatten hoofdletters. Door dat formaat aan te houden levert een
// opnieuw gedownloade QR-code exact dezelfde URL (en dus hetzelfde QR-beeld) op als
// de al geprinte. De lookup is hoofdletterongevoelig (uuid-type in Postgres).
function getPassportUrl(req, publicId) {
  return `${getQrBaseUrl(req)}/p/${String(publicId).toUpperCase()}`;
}

module.exports = { getAppBaseUrl, getQrBaseUrl, getPassportUrl };
