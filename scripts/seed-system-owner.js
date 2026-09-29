const { getPool, sql } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");

const MIN_PASSWORD_LENGTH = 12;

async function seedSystemOwner() {
  const email = process.env.SYSTEM_OWNER_EMAIL;
  const password = process.env.SYSTEM_OWNER_PASSWORD;
  const firstName = process.env.SYSTEM_OWNER_FIRST_NAME || null;
  const lastName = process.env.SYSTEM_OWNER_LAST_NAME || null;

  if (!email || !password) {
    throw new Error(
      "Zet SYSTEM_OWNER_EMAIL en SYSTEM_OWNER_PASSWORD in je .env voordat je dit script draait. " +
        "Er wordt bewust geen wachtwoord in de repository opgeslagen."
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SYSTEM_OWNER_PASSWORD moet minimaal ${MIN_PASSWORD_LENGTH} tekens lang zijn.`);
  }

  const pool = await getPool();
  const passwordHash = await hashPassword(password);

  const existing = await pool
    .request()
    .input("email", sql.NVarChar(256), email)
    .query("SELECT id FROM dbo.Users WHERE email = @email");

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
            updated_at = SYSUTCDATETIME()
        WHERE email = @email
      `);
    console.log(`✅ Bestaande System Owner bijgewerkt: ${email}`);
    return;
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

  console.log(`✅ System Owner aangemaakt: ${email}`);
}

seedSystemOwner()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Seed mislukt:");
    console.error(error.message);
    process.exit(1);
  });
