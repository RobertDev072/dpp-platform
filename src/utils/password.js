const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

// Geen echt wachtwoord: alleen gebruikt om de bcrypt-kosten te betalen wanneer een
// e-mailadres niet bestaat, zodat login-timing niet verraadt of een account bestaat.
const DUMMY_HASH = "$2b$12$UuEyVMDC7NLcf7g5xe6TGOWWDccFVrxzQwcOvEvW3aTtcP6tkWUdu";

function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

function verifyPassword(plainTextPassword, passwordHash) {
  return bcrypt.compare(plainTextPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
