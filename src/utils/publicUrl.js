// Basis-URL voor links die buiten de app belanden (QR-codes, activatielinks).
// In productie altijd PUBLIC_BASE_URL zetten: de Host-header van een request is door de
// client te beïnvloeden en mag niet bepalen waar een geprinte QR-code naartoe wijst.
function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { getPublicBaseUrl };
