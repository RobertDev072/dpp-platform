const crypto = require("crypto");

// Kleine, kortlevende, ondertekende tokens (HMAC-SHA256) voor stappen in een flow
// zonder serverstatus, zoals "wachtwoord vergeten": de server kan controleren dat
// een token door hemzelf is uitgegeven, voor welk doel en tot wanneer, zonder iets
// op te slaan. Geen geheimen in de payload: die is alleen ondertekend, niet versleuteld.

let devSecret;

function secret() {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("COOKIE_SECRET ontbreekt (vereist in productie).");
  }
  // Lokaal/tests: per proces een willekeurige sleutel.
  devSecret = devSecret || crypto.randomBytes(32).toString("hex");
  return devSecret;
}

function hmac(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

function signToken(purpose, payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, purpose, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${hmac(body)}`;
}

// Geeft de payload terug, of null bij een ongeldig/verlopen token of verkeerd doel.
function verifyToken(token, purpose) {
  if (typeof token !== "string") return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = hmac(body);
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.purpose !== purpose || typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return null;
  }
  return payload;
}

module.exports = { signToken, verifyToken };
