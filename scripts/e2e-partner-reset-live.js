// Live E2E-test van de partner-wachtwoordreset, uitsluitend met tijdelijke
// testaccounts (@example.com) die na afloop volledig worden opgeruimd (DB + Entra).
// Flow: partner (lokaal bcrypt-testaccount) -> klant aanmaken -> invite -> activatie
// (maakt echt Entra-account) -> reset #1 -> gedwongen wijziging -> login -> reset #2
// -> sessie ingetrokken -> gedwongen wijziging -> login. Draaien met:
//   NODE_EXTRA_CA_CERTS=... node scripts/e2e-partner-reset-live.js

const { getPool, sql } = require("../src/config/db");
const { createTestCompany, createTestUser, cleanupTestData } = require("../tests/helpers/fixtures");
const graphClient = require("../src/services/graphClient");

const BASE = process.env.LIVE_BASE_URL || "https://dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net";

const results = [];
function report(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, path, { cookie, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : null };
}

// Login met beperkte retries: de e-mail-rate-limiter op live telt mislukte
// pogingen (5/15min), dus we wachten ruim en proberen hooguit een paar keer
// (Entra-propagatie van een net gezet wachtwoord kan tientallen seconden duren).
async function loginWithRetry(email, password, { attempts = 3, waitMs = 45000 } = {}) {
  await sleep(waitMs);
  for (let i = 1; i <= attempts; i++) {
    const res = await api("POST", "/api/auth/login", { body: { email, password } });
    if (res.status === 200) return res;
    if (res.status === 429) throw new Error("Rate limit geraakt tijdens login-retries");
    if (i < attempts) await sleep(25000);
  }
  return api("POST", "/api/auth/login", { body: { email, password } });
}

(async () => {
  const pool = await getPool();
  const cleanup = { companyIds: [], userIds: [] };
  let entraObjectId = null;
  let adminEmail = null;

  try {
    // --- Setup: tijdelijke partner + partner_admin (lokaal wachtwoord) in de DB ---
    const partnerCo = await createTestCompany("E2E Reset Partner");
    cleanup.companyIds.push(partnerCo);
    await pool.request().input("id", sql.Int, partnerCo).query("UPDATE dbo.Companies SET kind = 'partner' WHERE id = @id");
    const partner = await createTestUser({ companyId: partnerCo, role: "partner_admin" });
    cleanup.userIds.push(partner.id);
    report("Setup: tijdelijk partnerbedrijf + Partner Admin aangemaakt", true, `bedrijf ${partnerCo}`);

    const login = await api("POST", "/api/auth/login", { body: { email: partner.email, password: partner.password } });
    report("Partner kan live inloggen", login.status === 200, `status ${login.status}`);
    const partnerCookie = login.cookie;

    // --- Plan kiezen (partner_assignable) ---
    const plans = await api("GET", "/api/partner/plans", { cookie: partnerCookie });
    if (plans.status !== 200 || !plans.data.length) throw new Error(`Geen partner-toewijsbaar plan beschikbaar (status ${plans.status})`);
    const planId = plans.data[0].id;

    // --- Klant aanmaken via live API ---
    const klant = await api("POST", "/api/partner/customers", {
      cookie: partnerCookie,
      body: { name: `E2E Reset Klant ${Date.now()}`, slug: `e2e-reset-${Date.now()}`, planId }
    });
    report("Partner maakt klantbedrijf aan (live)", klant.status === 201, `status ${klant.status}`);
    const klantId = klant.data.id;
    cleanup.companyIds.push(klantId);

    // --- Wachten tot de nieuwe code live is (adminlijst-route bestaat pas na deploy) ---
    let live = false;
    for (let i = 1; i <= 40; i++) {
      const probe = await api("GET", `/api/partner/customers/${klantId}/admins`, { cookie: partnerCookie });
      if (probe.status === 200) { live = true; break; }
      console.log(`   deploy-check ${i}: nog oude code (status ${probe.status}), 20s wachten...`);
      await sleep(20000);
    }
    report("Nieuwe code live (adminlijst-route antwoordt 200)", live);
    if (!live) throw new Error("Deploy niet live binnen de wachttijd");

    // --- Invite + activatie (maakt een echt Entra-account) ---
    adminEmail = `e2e-reset-admin-${Date.now()}@example.com`;
    const invite = await api("POST", `/api/partner/customers/${klantId}/invites`, {
      cookie: partnerCookie,
      body: { email: adminEmail, firstName: "E2E", lastName: "Resetadmin" }
    });
    report("Partner verstuurt eerste-admin-uitnodiging", invite.status === 201, `status ${invite.status}`);
    const token = invite.data.activationUrl.split("token=")[1];

    const accept = await api("POST", `/api/invites/${token}/accept`, { body: {} });
    report("Uitnodiging geactiveerd (Entra-account aangemaakt)", accept.status === 201, `status ${accept.status}`);

    const adminRow = await pool.request().input("email", sql.NVarChar(256), adminEmail)
      .query("SELECT id, entra_object_id FROM dbo.Users WHERE email = @email");
    const adminId = adminRow.recordset[0].id;
    entraObjectId = adminRow.recordset[0].entra_object_id;
    cleanup.userIds.push(adminId);

    // --- Reset #1: eerste bruikbare wachtwoord voor de nieuwe admin ---
    const reset1 = await api("POST", `/api/partner/customers/${klantId}/admins/${adminId}/reset-password`, { cookie: partnerCookie });
    report("Reset #1 geeft een tijdelijk wachtwoord", reset1.status === 200 && !!reset1.data.tempPassword, `status ${reset1.status}`);
    const temp1 = reset1.data.tempPassword;

    const metTemp1 = await loginWithRetry(adminEmail, temp1);
    report("Login met tijdelijk wachtwoord dwingt wijziging af", metTemp1.status === 200 && metTemp1.data.mustChangePassword === true,
      JSON.stringify(metTemp1.data));

    const nieuwWachtwoord = `E2E-Nieuw-${Date.now()}-Wachtwoord!`;
    const wijzig = await api("POST", "/api/auth/change-password", {
      body: { email: adminEmail, currentPassword: temp1, newPassword: nieuwWachtwoord }
    });
    report("Gedwongen wachtwoordwijziging geslaagd", wijzig.status === 200, `status ${wijzig.status}`);

    const nieuweLogin = await loginWithRetry(adminEmail, nieuwWachtwoord, { attempts: 3, waitMs: 20000 });
    report("Login met het nieuwe eigen wachtwoord werkt", nieuweLogin.status === 200 && !nieuweLogin.data.mustChangePassword,
      `status ${nieuweLogin.status}`);
    const adminCookie = nieuweLogin.cookie;

    const meVoor = await api("GET", "/api/auth/me", { cookie: adminCookie });
    report("Admin-sessie is actief vóór reset #2", meVoor.status === 200);

    // --- Reset #2: bewijst sessie-intrekking + dat het oude wachtwoord sterft ---
    const reset2 = await api("POST", `/api/partner/customers/${klantId}/admins/${adminId}/reset-password`, { cookie: partnerCookie });
    report("Reset #2 geeft een nieuw tijdelijk wachtwoord", reset2.status === 200 && !!reset2.data.tempPassword, `status ${reset2.status}`);
    const temp2 = reset2.data.tempPassword;

    const meNa = await api("GET", "/api/auth/me", { cookie: adminCookie });
    report("Lopende sessie is ingetrokken na reset", meNa.status === 401, `status ${meNa.status}`);

    const metTemp2 = await loginWithRetry(adminEmail, temp2);
    report("Nieuw tijdelijk wachtwoord werkt en dwingt opnieuw wijziging af",
      metTemp2.status === 200 && metTemp2.data.mustChangePassword === true, JSON.stringify(metTemp2.data));

    // --- Audit-controle: actor, doelwit, bedrijf, resultaat; nooit het wachtwoord ---
    const audit = await pool.request()
      .input("entityId", sql.NVarChar(50), String(adminId))
      .input("actorId", sql.Int, partner.id)
      .query(`
        SELECT metadata, company_id FROM dbo.AuditLogs
        WHERE action = 'reset_password' AND entity_type = 'User' AND entity_id = @entityId AND user_id = @actorId
      `);
    const rows = audit.recordset;
    const zonderWachtwoord = rows.every((r) => !r.metadata.includes(temp1) && !r.metadata.includes(temp2));
    report("Audit bevat beide resets (partner, klant, resultaat) zonder wachtwoorden",
      rows.length >= 2 && rows.every((r) => r.company_id === klantId) && zonderWachtwoord,
      `${rows.length} regels`);
  } catch (error) {
    report("Onverwachte fout", false, error.message);
  } finally {
    // --- Opruimen: Entra eerst, dan DB (invites/audit/sessies gaan mee via fixtures) ---
    try {
      if (entraObjectId) {
        await graphClient.deleteEntraUser(entraObjectId);
        report("Cleanup: Entra-testaccount verwijderd", true, adminEmail);
      }
    } catch (error) {
      report("Cleanup: Entra-testaccount verwijderd", false, error.message);
    }
    try {
      await cleanupTestData(cleanup);
      report("Cleanup: alle test-DB-rijen verwijderd", true, `bedrijven ${cleanup.companyIds.join(",")}`);
    } catch (error) {
      report("Cleanup: alle test-DB-rijen verwijderd", false, error.message);
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== Resultaat: ${results.length - failed.length}/${results.length} stappen geslaagd ===`);
    process.exit(failed.length ? 1 : 0);
  }
})();
