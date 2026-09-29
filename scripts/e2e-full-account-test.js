// Volledige end-to-end-test van het login- en accountsysteem tegen de LIVE omgeving.
// Controleert per stap zowel de VeriPasso-API/database als Microsoft Entra (Graph).
// Maakt eigen testdata aan en ruimt die aan het eind volledig op; raakt nooit
// bestaande echte accounts. Gebruik: node scripts/e2e-full-account-test.js
require("dotenv").config();
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("../tests/helpers/fixtures");
const { getPool, sql } = require("../src/config/db");
const { getDaemonConfidentialClient } = require("../src/services/msalClients");

const BASE = process.env.E2E_BASE_URL || "https://dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net";
const j = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function report(nr, wat, geslaagd, detail = "", db = "-", entra = "-") {
  results.push({ nr, wat, geslaagd: geslaagd ? "✔" : "✘", detail, db, entra });
  console.log(`${geslaagd ? "✔" : "✘"} ${nr}. ${wat}${detail ? " — " + detail : ""}`);
}

async function graphToken() {
  const client = await getDaemonConfidentialClient();
  const t = await client.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  return t.accessToken;
}
async function graphGetUser(objectId) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${objectId}?$select=id,accountEnabled,displayName`, {
    headers: { Authorization: `Bearer ${await graphToken()}` }
  });
  return r.ok ? await r.json() : { notFound: r.status === 404, status: r.status };
}
async function graphDeleteUser(objectId) {
  await fetch(`https://graph.microsoft.com/v1.0/users/${objectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await graphToken()}` }
  }).catch(() => {});
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? j(body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await r.json().catch(() => ({}));
  const cookies = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  return { status: r.status, data, cookie: cookies || null };
}

async function dbUser(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id).query(
    "SELECT id, email, role, status, company_id, entra_object_id, must_change_password FROM dbo.Users WHERE id = @id"
  );
  return r.recordset[0] || null;
}

async function main() {
  const stamp = Date.now();
  const companyA = await createTestCompany("E2E Volledig A");
  const companyB = await createTestCompany("E2E Volledig B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const productB = await createTestProduct({ companyId: companyB, name: "E2E Product B" });
  const extraIds = [];
  let targetId = null;
  let targetEntraId = null;

  try {
    const adminLogin = await call("/api/auth/login", { method: "POST", body: { email: adminA.email, password: adminA.password } });
    const adminCookie = adminLogin.cookie;
    const ownerLogin = await call("/api/auth/login", { method: "POST", body: { email: owner.email, password: owner.password } });
    const ownerCookie = ownerLogin.cookie;

    // ---- 1. Nieuw account aanmaken ----
    const email = `e2e-volledig-${stamp}@example.com`;
    const create = await call("/api/users", { method: "POST", cookie: adminCookie, body: { email, role: "company_user", firstName: "E2E", lastName: "Volledig" } });
    targetId = create.data.id;
    targetEntraId = create.data.entra_object_id;
    const row1 = targetId ? await dbUser(targetId) : null;
    const g1 = targetEntraId ? await graphGetUser(targetEntraId) : { notFound: true };
    report(1, "Nieuw account aanmaken", create.status === 201 && Boolean(create.data.tempPassword) && Boolean(targetEntraId),
      `status ${create.status}`,
      row1 ? `rij ok, bedrijf ${row1.company_id === companyA ? "juist" : "FOUT"}, must_change=${row1.must_change_password}` : "GEEN RIJ",
      g1.id ? `bestaat, enabled=${g1.accountEnabled}` : "NIET GEVONDEN");
    const tempPassword = create.data.tempPassword;

    await sleep(5000);

    // ---- 2. Inloggen met tijdelijk wachtwoord ----
    const l1 = await call("/api/auth/login", { method: "POST", body: { email, password: tempPassword } });
    report(2, "Inloggen met tijdelijk wachtwoord", l1.status === 200 && l1.data.mustChangePassword === true && !l1.cookie,
      `status ${l1.status}, mustChangePassword=${l1.data.mustChangePassword}, sessie=${l1.cookie ? "JA (fout!)" : "nee (goed)"}`);

    // ---- 3. Verplicht nieuw wachtwoord instellen ----
    const nw1 = `E2eVolledig${stamp}!a`;
    const ch = await call("/api/auth/change-password", { method: "POST", body: { email, currentPassword: tempPassword, newPassword: nw1 } });
    const row3 = await dbUser(targetId);
    report(3, "Verplicht nieuw wachtwoord instellen", ch.status === 200 && Boolean(ch.cookie) && row3.must_change_password === false,
      `status ${ch.status}, direct ingelogd=${Boolean(ch.cookie)}`,
      `must_change=${row3.must_change_password}`);

    // ---- 4. Opnieuw inloggen met het nieuwe wachtwoord ----
    await sleep(5000);
    const l2 = await call("/api/auth/login", { method: "POST", body: { email, password: nw1 } });
    report(4, "Opnieuw inloggen met nieuw wachtwoord", l2.status === 200 && l2.data.email === email && !l2.data.mustChangePassword,
      `status ${l2.status}`);

    // ---- 5. Wachtwoord vergeten (SSPR) — veilige, deterministische delen ----
    const s1 = await call("/api/password-reset/start", { method: "POST", body: { email } });
    const s2 = await call("/api/password-reset/start", { method: "POST", body: { email: `bestaat-niet-${stamp}@example.com` } });
    const s3 = await call("/api/password-reset/verify-code", { method: "POST", body: { continuationToken: "nep-token", code: "000000" } });
    report(5, "Wachtwoord vergeten (SSPR)",
      s1.status === 200 && Boolean(s1.data.continuationToken) && s2.status === 200 && s2.data.continuationToken === null && s3.status === 400,
      `start bekend=${s1.status}/${s1.data.continuationToken ? "code verstuurd" : "GEEN TOKEN"}, onbekend lekt niet=${s2.data.continuationToken === null}, foute code nette 400=${s3.status === 400}`,
      "-", "OTP-mail echt verstuurd door Entra");

    // ---- 6. Wachtwoord resetten door beheerder ----
    const reset = await call(`/api/users/${targetId}/reset-password`, { method: "POST", cookie: adminCookie });
    const row6 = await dbUser(targetId);
    report(6, "Reset door beheerder", reset.status === 200 && Boolean(reset.data.tempPassword) && row6.must_change_password === true,
      `status ${reset.status}`, `must_change=${row6.must_change_password}`);
    await sleep(6000);
    const l3 = await call("/api/auth/login", { method: "POST", body: { email, password: reset.data.tempPassword } });
    const nw2 = `E2eVolledig${stamp}!b`;
    const ch2 = await call("/api/auth/change-password", { method: "POST", body: { email, currentPassword: reset.data.tempPassword, newPassword: nw2 } });
    report("6b", "Reset-wachtwoord afmaken (wijzigen + ingelogd)", l3.data.mustChangePassword === true && ch2.status === 200, `login=${l3.status}, wijzigen=${ch2.status}`);

    // ---- 7. Account blokkeren ----
    const block = await call(`/api/users/${targetId}`, { method: "PATCH", cookie: adminCookie, body: { status: "blocked" } });
    await sleep(6000);
    const row7 = await dbUser(targetId);
    const g7 = await graphGetUser(targetEntraId);
    report(7, "Account blokkeren", block.status === 200 && row7.status === "blocked" && g7.accountEnabled === false,
      `status ${block.status}`, `status=${row7.status}`, `enabled=${g7.accountEnabled}`);

    // ---- 8. Geblokkeerd account kan niet inloggen ----
    const l4 = await call("/api/auth/login", { method: "POST", body: { email, password: nw2 } });
    report(8, "Geblokkeerd account kan niet inloggen", l4.status === 401, `status ${l4.status}`);

    // ---- 9. Geblokkeerd account herstellen ----
    const restore = await call(`/api/users/${targetId}`, { method: "PATCH", cookie: adminCookie, body: { status: "active" } });
    await sleep(15000);
    const row9 = await dbUser(targetId);
    const g9 = await graphGetUser(targetEntraId);
    let l5 = await call("/api/auth/login", { method: "POST", body: { email, password: nw2 } });
    if (l5.status !== 200) { await sleep(20000); l5 = await call("/api/auth/login", { method: "POST", body: { email, password: nw2 } }); }
    report(9, "Geblokkeerd account herstellen + weer inloggen", restore.status === 200 && row9.status === "active" && g9.accountEnabled === true && l5.status === 200,
      `herstel ${restore.status}, login ${l5.status}`, `status=${row9.status}`, `enabled=${g9.accountEnabled}`);

    // ---- 10. Account verwijderen ----
    const del = await call(`/api/users/${targetId}`, { method: "PATCH", cookie: adminCookie, body: { status: "deleted" } });
    await sleep(6000);
    const row10 = await dbUser(targetId);
    const g10 = await graphGetUser(targetEntraId);
    report(10, "Account verwijderen (soft delete + Entra weg)", del.status === 200 && row10.status === "deleted" && g10.notFound === true,
      `status ${del.status}`, `status=${row10.status} (rij blijft voor audit)`, g10.notFound ? "verwijderd uit tenant" : `NOG AANWEZIG (${g10.status || "?"})`);

    // ---- 11. Verwijderd account kan niet meer inloggen ----
    const l6 = await call("/api/auth/login", { method: "POST", body: { email, password: nw2 } });
    report(11, "Verwijderd account kan niet inloggen", l6.status === 401, `status ${l6.status}`);

    // ---- 12. Rollen en bedrijfsrechten ----
    const cross = await call(`/api/products/${productB}`, { cookie: adminCookie });
    const adminBLogin = await call("/api/auth/login", { method: "POST", body: { email: adminB.email, password: adminB.password } });
    const ownProduct = await call(`/api/products/${productB}`, { cookie: adminBLogin.cookie });
    const medewerker = await call("/api/users", { method: "POST", cookie: adminCookie, body: { email: `e2e-med-${stamp}@example.com`, role: "company_user" } });
    if (medewerker.data.id) { extraIds.push(medewerker.data.id); if (medewerker.data.entra_object_id) await graphDeleteUser(medewerker.data.entra_object_id); }
    const medLoginBlocked = await call("/api/admin/companies", { cookie: adminCookie });
    const ownerSees = await call("/api/users", { cookie: ownerCookie });
    const lastAdmin = await call(`/api/users/${adminA.id}`, { method: "PATCH", cookie: ownerCookie, body: { status: "blocked" } });
    const ok12 =
      cross.status === 404 &&
      ownProduct.status === 200 &&
      medLoginBlocked.status === 403 &&
      ownerSees.status === 200 && Array.isArray(ownerSees.data) && ownerSees.data.some((u) => u.id === adminA.id) && ownerSees.data.some((u) => u.id === adminB.id) &&
      lastAdmin.status === 409;
    report(12, "Rollen en bedrijfsrechten",
      ok12,
      `cross-tenant=404? ${cross.status === 404} | eigen product=200? ${ownProduct.status === 200} | admin geen platformbeheer (403)? ${medLoginBlocked.status === 403} | owner ziet alles? ${ownerSees.status === 200} | laatste-admin-guard 409? ${lastAdmin.status === 409}`);
  } finally {
    // ---- Opruimen: alleen eigen testdata ----
    const pool = await getPool();
    const ids = [targetId, ...extraIds].filter(Boolean);
    for (const id of ids) {
      await pool.request().input("uid", sql.Int, id).query("DELETE FROM dbo.Sessions WHERE user_id = @uid");
      await pool.request().input("uid", sql.Int, id).query("DELETE FROM dbo.AuditLogs WHERE user_id = @uid");
      await pool.request().input("uid", sql.Int, id).query("DELETE FROM dbo.Users WHERE id = @uid");
    }
    if (targetEntraId) await graphDeleteUser(targetEntraId);
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id, owner.id], productIds: [productB] });
    await sql.close();
    console.log("\nTestdata opgeruimd (echte accounts onaangeroerd).");
    console.log("\n=== EINDRAPPORT ===");
    console.table(results);
  }
}

main().catch((e) => { console.error("TESTRUN GEFAALD:", e.message); process.exit(1); });
