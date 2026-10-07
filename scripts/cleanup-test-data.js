// Veegt achtergebleven testdata op: bedrijven met slug test-<hex>, gebruikers met
// e-mail test-<hex>@example.com of *@example.com uit de e2e-scripts, hun producten/
// documenten, en de bijbehorende accounts in Supabase Auth.
//
// Gebruik: node scripts/cleanup-test-data.js           (droog: toont wat weg zou gaan)
//          node scripts/cleanup-test-data.js --apply   (echt opruimen)
require("dotenv").config();
const { query, queryRows, closePool } = require("../src/config/db");
const { isSupabaseConfigured, getSupabaseAdmin } = require("../src/config/supabase");

const APPLY = process.argv.includes("--apply");
const EMAIL_PATTERNS = ["test-%@example.com", "e2e-%@example.com"];
const SLUG_PATTERNS = ["test-%", "e2e-%"];

async function cleanupSupabaseAuthTestAccounts() {
  if (!isSupabaseConfigured()) {
    console.log("Supabase-veegronde overgeslagen: Supabase niet geconfigureerd.");
    return;
  }
  const admin = getSupabaseAdmin().auth.admin;
  let removed = 0;
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.log("Supabase-veegronde mislukt:", error.message);
      return;
    }
    const testUsers = data.users.filter((u) => /^(test|e2e)-[^@]*@example\.com$/i.test(u.email || ""));
    for (const u of testUsers) {
      console.log(`  Supabase Auth: ${u.email}${APPLY ? " verwijderd" : " (zou verwijderd worden)"}`);
      if (APPLY) {
        await admin.deleteUser(u.id);
        removed += 1;
      }
    }
    if (data.users.length < 200) break;
  }
  console.log(`Supabase-veegronde klaar: ${removed} testaccount(s) verwijderd`);
}

async function cleanupDatabase() {
  const users = await queryRows(`SELECT id, email FROM users WHERE email ILIKE ANY($1)`, [EMAIL_PATTERNS]);
  const companies = await queryRows(`SELECT id, slug FROM companies WHERE slug ILIKE ANY($1)`, [SLUG_PATTERNS]);
  console.log(`Database: ${users.length} testgebruiker(s), ${companies.length} testbedrij(f/ven)`);
  if (!APPLY) return;

  const userIds = users.map((u) => u.id);
  const companyIds = companies.map((c) => c.id);

  if (userIds.length) {
    await query(`DELETE FROM sessions WHERE user_id = ANY($1::int[]) OR impersonator_user_id = ANY($1::int[])`, [userIds]);
    await query(`DELETE FROM company_admin_invites WHERE invited_by = ANY($1::int[])`, [userIds]);
    await query(`DELETE FROM audit_logs WHERE user_id = ANY($1::int[]) OR impersonator_user_id = ANY($1::int[])`, [userIds]);
    await query(`UPDATE products SET created_by = NULL WHERE created_by = ANY($1::int[])`, [userIds]);
  }
  if (companyIds.length) {
    const productFilter = "product_id IN (SELECT id FROM products WHERE company_id = ANY($1::int[]))";
    for (const table of ["scan_events", "documents", "product_parts", "product_batches", "product_sustainability", "product_compliance"]) {
      await query(`DELETE FROM ${table} WHERE ${productFilter}`, [companyIds]);
    }
    await query(`DELETE FROM products WHERE company_id = ANY($1::int[])`, [companyIds]);
    await query(`DELETE FROM company_admin_invites WHERE company_id = ANY($1::int[])`, [companyIds]);
    await query(`DELETE FROM audit_logs WHERE company_id = ANY($1::int[])`, [companyIds]);
    await query(`UPDATE companies SET partner_id = NULL WHERE partner_id = ANY($1::int[])`, [companyIds]);
    await query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ANY($1::int[]))`, [companyIds]);
    await query(`DELETE FROM users WHERE company_id = ANY($1::int[])`, [companyIds]);
  }
  if (userIds.length) {
    await query(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
  }
  if (companyIds.length) {
    await query(`DELETE FROM companies WHERE id = ANY($1::int[])`, [companyIds]);
  }
  console.log("Database opgeschoond.");
}

(async () => {
  if (!APPLY) console.log("Droge run - voeg --apply toe om echt op te ruimen.\n");
  await cleanupDatabase();
  await cleanupSupabaseAuthTestAccounts();
})()
  .catch((error) => {
    console.error("❌ Opruimen mislukt:", error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
