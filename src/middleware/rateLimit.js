const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Brute-force-bescherming op de publieke auth-endpoints. Geslaagde logins tellen
// niet mee (skipSuccessfulRequests), zodat normale gebruikers hier nooit tegenaan
// lopen - alleen herhaald falen wordt geremd.
const WINDOW_MS = 15 * 60 * 1000;

function tooManyRequests(message) {
  return (req, res) => {
    res.status(429).json({ error: { message, code: "RATE_LIMITED" } });
  };
}

function emailKey(req) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  // ipKeyGenerator groepeert IPv6-adressen per subnet, anders zou een IPv6-gebruiker
  // met adres-rotatie de limiet omzeilen.
  return email || ipKeyGenerator(req.ip);
}

const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests("Te veel mislukte inlogpogingen vanaf dit adres. Probeer het over 15 minuten opnieuw.")
});

const loginEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  handler: tooManyRequests("Te veel mislukte inlogpogingen voor dit e-mailadres. Probeer het over 15 minuten opnieuw.")
});

const mfaLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests("Te veel verificatiepogingen. Probeer het over 15 minuten opnieuw.")
});

const resetLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests("Te veel aanvragen. Probeer het over 15 minuten opnieuw.")
});

// Wachtwoordresets door een Partner Admin: geteld per ingelogde partner (niet per
// IP) en álle pogingen tellen mee - ook geweigerde (404-probing is hier juist het
// misbruik dat we willen remmen).
const partnerResetLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user-${req.user.id}` : ipKeyGenerator(req.ip)),
  handler: tooManyRequests("Te veel wachtwoordresets in korte tijd. Probeer het over 15 minuten opnieuw.")
});

// Zware bewerkingen (import-upload, label-PDF's, QR-ZIP's): per ingelogde gebruiker
// geremd, zodat één account de functie niet kan blijven belasten. Ruim genoeg voor
// normaal gebruik (10.000 labels = 20 PDF-delen).
const heavyWorkLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user-${req.user.id}` : ipKeyGenerator(req.ip)),
  handler: tooManyRequests("Te veel exports of imports in korte tijd. Probeer het over 15 minuten opnieuw.")
});

// Publieke paspoort-API (QR-scans, machineleesbare DPP): ruim per IP-adres, zodat
// echte scans nooit geremd worden maar één scraper de dienst niet kan belasten.
// Interne aanroepen van de paspoortpagina (server-side, via loopback) tellen niet
// mee: die zijn al per bezoeker begrensd door de WAF-regel op CloudFront.
const PUBLIC_WINDOW_MS = 60 * 1000;
function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
const publicApiLimiter = rateLimit({
  windowMs: PUBLIC_WINDOW_MS,
  limit: Number(process.env.PUBLIC_RATE_LIMIT_PER_MINUTE) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopback(req.ip),
  handler: tooManyRequests("Te veel aanvragen vanaf dit adres. Probeer het over een minuut opnieuw.")
});

module.exports = {
  loginIpLimiter,
  loginEmailLimiter,
  mfaLimiter,
  resetLimiter,
  partnerResetLimiter,
  heavyWorkLimiter,
  publicApiLimiter
};
