const crypto = require("crypto");

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function randomChar(charset) {
  const index = crypto.randomInt(0, charset.length);
  return charset[index];
}

// Genereert een tijdelijk wachtwoord dat voldoet aan Entra's complexiteitseisen
// (hoofdletter, kleine letter, cijfer, symbool). Wordt nooit opgeslagen in DPP zelf —
// alleen doorgegeven aan Graph en één keer teruggegeven aan de admin die het aanmaakt.
function generateTempPassword(length = 16) {
  const required = [randomChar(LOWER), randomChar(UPPER), randomChar(DIGITS), randomChar(SYMBOLS)];
  const rest = Array.from({ length: length - required.length }, () => randomChar(ALL));
  const chars = [...required, ...rest];

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

module.exports = { generateTempPassword };
