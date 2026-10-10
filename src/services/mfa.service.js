// Tweestapsverificatie met TOTP (RFC 6238, HMAC-SHA1, 6 cijfers, 30 s), compatibel
// met gangbare authenticator-apps. Geen externe dependency: alleen node:crypto.
//
// - Het geheim staat AES-256-GCM-versleuteld in de database. Sleutel:
//   MFA_ENCRYPTION_KEY (op AWS uit Secrets Manager). Lokaal valt die terug op een
//   van COOKIE_SECRET afgeleide sleutel (HKDF), zodat ontwikkelen zonder extra
//   configuratie werkt. Let op: wie lokaal COOKIE_SECRET wijzigt zonder
//   MFA_ENCRYPTION_KEY, maakt bestaande lokale MFA-koppelingen onbruikbaar.
// - Tussen "wachtwoord klopt" en "code klopt" bestaat geen sessie, alleen een
//   kortlevend, ondertekend ticket (5 minuten).
// - Herstelcodes: 10 eenmalige codes, alleen als SHA-256-hash opgeslagen.

const crypto = require("crypto");

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // ±1 tijdstap voor klokverschil
const TICKET_TTL_MS = 5 * 60 * 1000;
const ISSUER = "VeriPasso";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, "0");
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

// Geeft de gebruikte tijdstap terug bij een geldige code, anders null. Codes van een
// stap ≤ lastStep worden geweigerd (geen hergebruik).
function verifyTotp(secretBase32, code, { lastStep = null, now = Date.now() } = {}) {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const step = currentStep(now);
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const candidate = step + offset;
    if (lastStep != null && candidate <= Number(lastStep)) continue;
    const expected = hotp(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return candidate;
  }
  return null;
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUri(secretBase32, accountName) {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// --- sleutels ---------------------------------------------------------------------

function deriveKey(info) {
  const base = process.env.COOKIE_SECRET;
  if (!base) throw new Error("COOKIE_SECRET ontbreekt (nodig voor MFA-tickets)");
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(base), Buffer.alloc(0), Buffer.from(info), 32));
}

function encryptionKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  return deriveKey("veripasso-mfa-secret-v1");
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptSecret(stored) {
  const [version, iv, tag, data] = String(stored || "").split(":");
  if (version !== "v1") throw new Error("Onbekend formaat MFA-geheim");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

// --- tickets (tussenstap bij inloggen) ------------------------------------------------

function sign(payload) {
  return crypto.createHmac("sha256", deriveKey("veripasso-mfa-ticket-v1")).update(payload).digest("base64url");
}

function createTicket(userId, now = Date.now()) {
  const payload = `${userId}.${now + TICKET_TTL_MS}.${crypto.randomBytes(8).toString("hex")}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

// Geeft het user-id terug bij een geldig, niet-verlopen ticket, anders null.
function readTicket(ticket, now = Date.now()) {
  const [encoded, signature] = String(ticket || "").split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = sign(payload);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return null;
  }
  const [userId, expiresAt] = payload.split(".");
  if (!(Number(expiresAt) > now)) return null;
  const id = Number(userId);
  return Number.isInteger(id) ? id : null;
}

// --- herstelcodes ---------------------------------------------------------------------

function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code).toUpperCase().replace(/[^A-Z2-7]/g, "")).digest("hex");
}

function generateRecoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

module.exports = {
  generateSecret,
  otpauthUri,
  verifyTotp,
  hotp,
  base32Decode,
  base32Encode,
  currentStep,
  encryptSecret,
  decryptSecret,
  createTicket,
  readTicket,
  generateRecoveryCodes,
  hashRecoveryCode
};
