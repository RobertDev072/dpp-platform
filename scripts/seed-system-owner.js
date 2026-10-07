const { queryOne, query, closePool } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");

const MIN_PASSWORD_LENGTH = 12;

// Het Platform Owner-account is bewust een lokaal (bcrypt) account en géén Supabase
// Auth-account: zo blijft inloggen als break-glass werken, ook als Supabase Auth
// verkeerd geconfigureerd of onbereikbaar is.
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

  const passwordHash = await hashPassword(password);
  const existing = await queryOne("SELECT id FROM users WHERE email = $1", [email]);

  if (existing) {
    await query(
      `UPDATE users
       SET password_hash = $2, first_name = $3, last_name = $4,
           role = 'platform_owner', status = 'active', must_change_password = FALSE,
           updated_at = now()
       WHERE email = $1`,
      [email, passwordHash, firstName, lastName]
    );
    console.log(`✅ Bestaande Platform Owner bijgewerkt: ${email}`);
    return;
  }

  await query(
    `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, status)
     VALUES (NULL, $1, $2, $3, $4, 'platform_owner', 'active')`,
    [email, passwordHash, firstName, lastName]
  );

  console.log(`✅ Platform Owner aangemaakt: ${email}`);
}

seedSystemOwner()
  .then(() => closePool())
  .catch(async (error) => {
    console.error("❌ Seed mislukt:");
    console.error(error.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
