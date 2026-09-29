// Twee bewust gescheiden basis-URL's:
// - APP_BASE_URL: login-/activatie-/applicatielinks (mag ooit wijzigen).
// - QR_BASE_URL: permanente publieke product-/QR-links - geprinte QR-codes bevatten
//   deze URL voorgoed, dus deze mag alleen wijzigen naar een adres dat blijvend
//   wordt doorverwezen.
// Zonder envvar valt beide terug op de request-host (met trust proxy geeft
// req.protocol dan correct https achter Azure's TLS-terminatie).

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

module.exports = { getAppBaseUrl, getQrBaseUrl };
