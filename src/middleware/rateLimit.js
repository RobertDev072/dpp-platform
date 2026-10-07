const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { PostgresRateLimitStore } = require("./rateLimitStore");

// Brute-force-bescherming op de publieke auth-endpoints. Geslaagde logins tellen
// niet mee (skipSuccessfulRequests), zodat normale gebruikers hier nooit tegenaan
// lopen - alleen herhaald falen wordt geremd. Tellers staan in Postgres (gedeeld
// over alle Vercel-instances); is de database onbereikbaar, dan laat de limiter het
// verzoek door (passOnStoreError) - de login zelf faalt dan toch al.
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
  store: new PostgresRateLimitStore("loginIpLimiter"),
  passOnStoreError: true,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests("Te veel mislukte inlogpogingen vanaf dit adres. Probeer het over 15 minuten opnieuw.")
});

const loginEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  store: new PostgresRateLimitStore("loginEmailLimiter"),
  passOnStoreError: true,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  handler: tooManyRequests("Te veel mislukte inlogpogingen voor dit e-mailadres. Probeer het over 15 minuten opnieuw.")
});

const resetLimiter = rateLimit({
  windowMs: WINDOW_MS,
  store: new PostgresRateLimitStore("resetLimiter"),
  passOnStoreError: true,
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
  store: new PostgresRateLimitStore("partnerResetLimiter"),
  passOnStoreError: true,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user-${req.user.id}` : ipKeyGenerator(req.ip)),
  handler: tooManyRequests("Te veel wachtwoordresets in korte tijd. Probeer het over 15 minuten opnieuw.")
});

module.exports = { loginIpLimiter, loginEmailLimiter, resetLimiter, partnerResetLimiter };
