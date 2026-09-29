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

module.exports = { loginIpLimiter, loginEmailLimiter, mfaLimiter, resetLimiter };
