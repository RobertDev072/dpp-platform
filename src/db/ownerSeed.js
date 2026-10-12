const { getPool, sql } = require("../config/db");
const { hashPassword } = require("../utils/password");

const MIN_PASSWORD_LENGTH = 12;

// Maakt of actualiseert het Platform Owner-account. Gebruikt door
// scripts/seed-system-owner.js (lokaal, uit .env) en door de interne taak "seed-owner"
// op AWS Lambda (gegevens uit de aanroep, nooit uit de repository).
async function seedSystemOwner({ email, password, firstName = null, lastName = null }) {
  if (!email || !password) {
    throw new Error("E-mail en wachtwoord van de Platform Owner zijn verplicht.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Het wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens lang zijn.`);
  }

  const pool = await getPool();
  const passwordHash = await hashPassword(password);
  const existing = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query("SELECT id FROM dbo.Users WHERE lower(email) = lower(@email)");

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input("email", sql.NVarChar(256), email)
      .input("passwordHash", sql.NVarChar(255), passwordHash)
      .input("firstName", sql.NVarChar(100), firstName)
      .input("lastName", sql.NVarChar(100), lastName)
      .query(`
        UPDATE dbo.Users
        SET password_hash = @passwordHash,
            first_name = @firstName,
            last_name = @lastName,
            role = 'platform_owner',
            status = 'active',
            updated_at = now()
        WHERE lower(email) = lower(@email)
      `);
    return { created: false, email };
  }

  await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .input("passwordHash", sql.NVarChar(255), passwordHash)
    .input("firstName", sql.NVarChar(100), firstName)
    .input("lastName", sql.NVarChar(100), lastName)
    .query(`
      INSERT INTO dbo.Users (company_id, email, password_hash, first_name, last_name, role, status)
      VALUES (NULL, @email, @passwordHash, @firstName, @lastName, 'platform_owner', 'active')
    `);
  return { created: true, email };
}

module.exports = { seedSystemOwner };
