// Basis security-headers voor alle responses. De CSP staat geen inline scripts/styles toe:
// alle JS/CSS komt uit /public als los bestand, en DOM-updates gaan via textContent.
function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
}

// Voor API-responses met gevoelige, eenmalig getoonde data (tijdelijke wachtwoorden,
// uitnodigingslinks): nooit laten cachen door browser of proxy.
function noStore(req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

module.exports = { securityHeaders, noStore };
