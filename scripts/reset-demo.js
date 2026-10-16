// Database leegmaken voor een presentatie en drie demo-accounts aanmaken:
//   Partner Admin  → partner "Demo Partner"
//   Company Admin  → klantbedrijf "Demo Klant BV" (klant van Demo Partner)
//   Medewerker     → zelfde klantbedrijf
//
// Blijft staan: de Platform Owner(s), plannen, migratiestatus, systeemmetingen en de
// instellingsregel dbo.scanrollup.
// Alles anders gaat weg: bedrijven, gebruikers, producten, documenten, paspoortversies,
// scans, uitnodigingen, auditlog en sessies van andere gebruikers.
// Foto's, documenten en noodkopieën in R2 worden NIET verwijderd (alleen de verwijzingen).
//
// Zonder --ja-alles-wissen toont het script alleen wat er verwijderd zou worden.
// Maak altijd eerst een back-up (deploy/backup.sh). Op de server:
//
//   docker compose exec app node scripts/reset-demo.js                    (proef)
//   docker compose exec app node scripts/reset-demo.js --ja-alles-wissen  (echt)
//
// E-mailadressen aanpassen: DEMO_PARTNER_EMAIL, DEMO_ADMIN_EMAIL, DEMO_USER_EMAIL
// (meegeven met `docker compose exec -e NAAM=waarde app ...`). VeriPasso verstuurt geen
// e-mail, dus de adressen hoeven niet te bestaan. De wachtwoorden worden willekeurig
// gemaakt en één keer op het scherm getoond.
require("dotenv").config();
const { getPool, close } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");
const { generateTempPassword } = require("../src/utils/tempPassword");

const CONFIRMED = process.argv.includes("--ja-alles-wissen");

const ACCOUNTS = [
  { key: "partner", role: "partner_admin", email: process.env.DEMO_PARTNER_EMAIL || "partner@demo.veripasso.com", firstName: "Demo", lastName: "Partner Admin" },
  { key: "admin", role: "company_admin", email: process.env.DEMO_ADMIN_EMAIL || "beheer@demo.veripasso.com", firstName: "Demo", lastName: "Bedrijfsbeheerder" },
  { key: "user", role: "company_user", email: process.env.DEMO_USER_EMAIL || "medewerker@demo.veripasso.com", firstName: "Demo", lastName: "Medewerker" }
];

// Volgorde: eerst wat naar andere tabellen verwijst. (Met session_replication_role =
// replica worden foreign keys en de append-only-trigger van passportversions overgeslagen;
// de volgorde houdt het ook zonder dat netjes.)
const WIPE_TABLES = [
  "scanevents",
  "scandaily",
  "passportsnapshotqueue",
  "passportsnapshots",
  "edgecachepurges",
  "passportversions",
  "documents",
  "productparts",
  "productbatches",
  "productsustainability",
  "productcompliance",
  "productimports",
  "printprofiles",
  "products",
  "companyadmininvites",
  "auditlogs"
];

async function counts(client) {
  const result = {};
  for (const table of WIPE_TABLES) {
    result[table] = Number((await client.query(`SELECT count(*)::int AS n FROM dbo.${table}`)).rows[0].n);
  }
  result.companies = Number((await client.query("SELECT count(*)::int AS n FROM dbo.companies")).rows[0].n);
  result["users (behalve Platform Owner)"] = Number(
    (await client.query("SELECT count(*)::int AS n FROM dbo.users WHERE role <> 'platform_owner'")).rows[0].n
  );
  return result;
}

async function run() {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const owners = (await client.query("SELECT email FROM dbo.users WHERE role = 'platform_owner'")).rows;
    if (!owners.length) throw new Error("Geen Platform Owner gevonden; maak die eerst aan (scripts/seed-system-owner.js).");

    console.log("Blijft staan: Platform Owner " + owners.map((o) => o.email).join(", ") + ", plannen, migraties.");
    console.log("Wordt verwijderd:");
    for (const [table, n] of Object.entries(await counts(client))) console.log(`  ${table.padEnd(32)} ${n}`);

    if (!CONFIRMED) {
      console.log("\nProef: er is niets gewijzigd. Echt uitvoeren: node scripts/reset-demo.js --ja-alles-wissen");
      return;
    }

    const passwords = {};
    const hashes = {};
    for (const account of ACCOUNTS) {
      passwords[account.key] = generateTempPassword(16);
      hashes[account.key] = await hashPassword(passwords[account.key]);
    }

    await client.query("BEGIN");
    // Superuser nodig (de database-gebruiker in deploy/compose.yaml is dat).
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of WIPE_TABLES) await client.query(`DELETE FROM dbo.${table}`);
    await client.query(
      "DELETE FROM dbo.sessions WHERE user_id NOT IN (SELECT id FROM dbo.users WHERE role = 'platform_owner')"
    );
    await client.query("DELETE FROM dbo.users WHERE role <> 'platform_owner'");
    await client.query("UPDATE dbo.users SET company_id = NULL WHERE role = 'platform_owner'");
    await client.query("DELETE FROM dbo.companies");
    await client.query("SET LOCAL session_replication_role = origin");

    // Plan "Demo" (hergebruikt als het al bestaat).
    let plan = (await client.query("SELECT id FROM dbo.plans WHERE name = 'Demo' ORDER BY id LIMIT 1")).rows[0];
    if (!plan) {
      plan = (
        await client.query(
          "INSERT INTO dbo.plans (name, max_users, max_products, partner_assignable) VALUES ('Demo', 10, 100, true) RETURNING id"
        )
      ).rows[0];
    }

    const partner = (
      await client.query(
        `INSERT INTO dbo.companies (name, slug, status, kind) VALUES ('Demo Partner', 'demo-partner', 'active', 'partner') RETURNING id`
      )
    ).rows[0];
    const customer = (
      await client.query(
        `INSERT INTO dbo.companies (name, slug, status, kind, partner_id, plan_id, license_start, license_end)
         VALUES ('Demo Klant BV', 'demo-klant', 'active', 'customer', $1, $2, current_date, current_date + interval '1 year')
         RETURNING id`,
        [partner.id, plan.id]
      )
    ).rows[0];

    const companyFor = { partner: partner.id, admin: customer.id, user: customer.id };
    for (const account of ACCOUNTS) {
      await client.query(
        `INSERT INTO dbo.users (company_id, email, password_hash, first_name, last_name, role, status, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', false)`,
        [companyFor[account.key], account.email, hashes[account.key], account.firstName, account.lastName, account.role]
      );
    }
    await client.query("COMMIT");

    console.log("\n✅ Database leeggemaakt en demo-accounts aangemaakt (inloggen op https://app.veripasso.com/login):\n");
    for (const account of ACCOUNTS) {
      console.log(`  ${account.lastName.padEnd(18)} ${account.email.padEnd(34)} ${passwords[account.key]}`);
    }
    console.log("\nBewaar deze wachtwoorden nu; ze worden niet opnieuw getoond.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

run()
  .then(() => close())
  .catch(async (error) => {
    console.error("❌ Mislukt, er is niets gewijzigd:", error.message);
    await close();
    process.exit(1);
  });
