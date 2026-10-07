// Einde van de Entra-overgangsfase: geeft elk actief account dat nog GEEN lokaal
// wachtwoord heeft (nooit ingelogd sinds de migratie) een tijdelijk wachtwoord met
// gedwongen wijziging bij de eerste login.
//
// Gebruik:
//   node scripts/issue-temp-passwords.js            -> alleen tonen wie het betreft (droog)
//   node scripts/issue-temp-passwords.js --apply    -> echt uitvoeren
//
// Met --apply komen e-mailadres + tijdelijk wachtwoord in temp-passwords-<datum>.csv
// (staat in .gitignore). Deel ze via een veilig kanaal en verwijder het bestand daarna.
// Wachtwoorden komen nooit in de console, database of auditlog.
const fs = require("fs");
const path = require("path");
const { getPool, close } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");
const { generateTempPassword } = require("../src/utils/tempPassword");
const { logAudit } = require("../src/utils/auditLog");

async function run() {
  const apply = process.argv.includes("--apply");
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT u.id, u.email, u.role, u.company_id, c.name AS company_name
    FROM dbo.Users u
    LEFT JOIN dbo.Companies c ON c.id = u.company_id
    WHERE u.password_hash IS NULL AND u.status = 'active'
    ORDER BY c.name NULLS FIRST, u.email
  `);
  const users = result.recordset;

  console.log(`${users.length} actief account(s) zonder lokaal wachtwoord.`);
  for (const user of users) {
    console.log(`  - ${user.email} (${user.role}${user.company_name ? `, ${user.company_name}` : ""})`);
  }
  if (!apply || users.length === 0) {
    if (!apply && users.length) console.log("\nDroog gedraaid. Voeg --apply toe om tijdelijke wachtwoorden uit te geven.");
    return;
  }

  const lines = ["email;bedrijf;tijdelijk_wachtwoord"];
  for (const user of users) {
    const tempPassword = generateTempPassword();
    await pool
      .request()
      .input("id", user.id)
      .input("hash", await hashPassword(tempPassword))
      .query(`
        UPDATE dbo.Users
        SET password_hash = @hash, must_change_password = true, updated_at = now()
        WHERE id = @id AND password_hash IS NULL
      `);
    await logAudit({
      companyId: user.company_id,
      userId: null,
      action: "reset_password",
      entityType: "User",
      entityId: user.id,
      metadata: { via: "script", reason: "einde Entra-overgangsfase" }
    });
    lines.push(`${user.email};${(user.company_name || "").replace(/;/g, ",")};${tempPassword}`);
  }

  const file = path.join(process.cwd(), `temp-passwords-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  console.log(`\n✅ ${users.length} tijdelijk(e) wachtwoord(en) uitgegeven. Zie ${file}`);
}

run()
  .then(() => close())
  .catch(async (error) => {
    console.error("❌ Mislukt:", error.message);
    await close();
    process.exit(1);
  });
