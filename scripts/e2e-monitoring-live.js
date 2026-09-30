// Fase 7-productietest van het monitoringdashboard, uitsluitend met tijdelijke
// testaccounts (opgeruimd na afloop). Controleert live: deploy geland, publieke
// health kaal, alle owner-endpoints 200 zonder gevoelige sleutels, snapshot met
// echte blob-meting (Managed Identity), en de volledige autorisatiematrix.
//   NODE_EXTRA_CA_CERTS=... node scripts/e2e-monitoring-live.js

const { getPool, sql } = require("../src/config/db");
const { createTestCompany, createTestUser, cleanupTestData } = require("../tests/helpers/fixtures");

const BASE = process.env.LIVE_BASE_URL || "https://dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net";

const results = [];
function report(step, ok, detail) {
  results.push({ step, ok });
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { cookie, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : null, raw: text };
}

const MONITOR_PATHS = [
  "/api/admin/system/health", "/api/admin/system/overview", "/api/admin/system/performance?period=1h",
  "/api/admin/system/database", "/api/admin/system/growth?range=30d", "/api/admin/system/storage",
  "/api/admin/system/usage", "/api/admin/system/errors", "/api/admin/system/infra"
];

function hasSensitiveKeys(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([k, v]) => /secret|password|connection[_-]?string|authorization/i.test(k) || hasSensitiveKeys(v)
    );
  }
  return false;
}

(async () => {
  const cleanup = { companyIds: [], userIds: [] };
  try {
    const pool = await getPool();

    // --- Deploy-detector: nieuwe publieke health bestaat alleen in de nieuwe code ---
    let live = false;
    for (let i = 1; i <= 40; i++) {
      try {
        const probe = await api("GET", "/api/health", {});
        if (probe.status === 200 && probe.data === "OK") { live = true; break; }
        console.log(`   deploy-check ${i}: status ${probe.status}, 20s wachten...`);
      } catch (e) {
        console.log(`   deploy-check ${i}: ${e.message}, 20s wachten...`);
      }
      await sleep(20000);
    }
    report("Deploy live: publieke /api/health antwoordt kaal 'OK'", live);
    if (!live) throw new Error("Deploy niet live binnen de wachttijd");

    // --- Tijdelijke accounts voor de autorisatiematrix ---
    const partnerCo = await createTestCompany("Mon Live Partner");
    const klantCo = await createTestCompany("Mon Live Klant");
    cleanup.companyIds.push(partnerCo, klantCo);
    await pool.request().input("id", sql.Int, partnerCo).query("UPDATE dbo.Companies SET kind = 'partner' WHERE id = @id");

    const owner = await createTestUser({ companyId: null, role: "platform_owner" });
    const partner = await createTestUser({ companyId: partnerCo, role: "partner_admin" });
    const admin = await createTestUser({ companyId: klantCo, role: "company_admin" });
    const medewerker = await createTestUser({ companyId: klantCo, role: "company_user" });
    cleanup.userIds.push(owner.id, partner.id, admin.id, medewerker.id);

    // --- Autorisatiematrix ---
    const anon = await api("GET", "/api/admin/system/overview", {});
    report("Zonder sessie: 401", anon.status === 401, `status ${anon.status}`);

    for (const [label, user] of [["Partner Admin", partner], ["Bedrijfsbeheerder", admin], ["Medewerker", medewerker]]) {
      const login = await api("POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
      const res = await api("GET", "/api/admin/system/overview", { cookie: login.cookie });
      report(`${label}: 403 op monitoring`, res.status === 403, `status ${res.status}`);
    }

    // --- Platform Owner: alle endpoints ---
    const ownerLogin = await api("POST", "/api/auth/login", { body: { email: owner.email, password: owner.password } });
    report("Tijdelijke owner kan live inloggen", ownerLogin.status === 200);
    const cookie = ownerLogin.cookie;

    let allOk = true;
    let sensitive = false;
    for (const path of MONITOR_PATHS) {
      const res = await api("GET", path, { cookie });
      if (res.status !== 200) { allOk = false; console.log(`   ${path} -> ${res.status}`); }
      if (hasSensitiveKeys(res.data)) { sensitive = true; console.log(`   verdachte sleutel in ${path}`); }
    }
    report("Alle 9 monitoring-endpoints geven 200 voor de owner", allOk);
    report("Geen gevoelige sleutels in enige monitoringrespons", !sensitive);

    // --- Handmatige snapshot op Azure (met Managed Identity => echte blob-meting) ---
    const snap = await api("POST", "/api/admin/system/snapshot", { cookie });
    report("Handmatige snapshot op productie geslaagd", snap.status === 201, `status ${snap.status}`);

    const storage = await api("GET", "/api/admin/system/storage", { cookie });
    const blobOk = storage.data?.blob?.available === true;
    report(
      "Blob Storage daadwerkelijk gemeten (Managed Identity)",
      blobOk,
      blobOk ? `${storage.data.blob.totalCount} blobs, ${storage.data.blob.totalBytes} bytes` : JSON.stringify(storage.data?.blob)
    );

    const db = await api("GET", "/api/admin/system/database", { cookie });
    report("Databasesectie: grootte en capaciteit aanwezig", db.data?.sizeBytes > 0 && db.data?.maxBytes > 0,
      `${db.data?.sizeBytes} / ${db.data?.maxBytes} bytes`);
    report("Databaseperformance (DMV's) beschikbaar op productie", db.data?.performance?.available === true,
      db.data?.performance?.available ? `${db.data.performance.activeSessions} sessies` : db.data?.performance?.reason);

    const infra = await api("GET", "/api/admin/system/infra", { cookie });
    report("Deployment-info met commit aanwezig", Boolean(infra.data?.build?.commit), JSON.stringify(infra.data?.build));

    const overview = await api("GET", "/api/admin/system/overview", { cookie });
    report("Platformstatus berekend", ["ok", "degraded", "down"].includes(overview.data?.health?.overall),
      `overall=${overview.data?.health?.overall}, requestsToday=${overview.data?.kpis?.requestsToday}`);

    // --- Dashboardpagina serveert ---
    const page = await api("GET", "/admin/systeemstatus", {});
    report("Pagina /admin/systeemstatus geeft 200", page.status === 200, `status ${page.status}`);
  } catch (error) {
    report("Onverwachte fout", false, error.message);
  } finally {
    try {
      await cleanupTestData(cleanup);
      report("Cleanup: alle tijdelijke testaccounts verwijderd", true);
    } catch (error) {
      report("Cleanup: alle tijdelijke testaccounts verwijderd", false, error.message);
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== Resultaat: ${results.length - failed.length}/${results.length} stappen geslaagd ===`);
    process.exit(failed.length ? 1 : 0);
  }
})();
