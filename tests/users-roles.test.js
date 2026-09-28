const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
const { verifyPassword } = require("../src/utils/password");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const { isEntraLoginConfigured } = require("../src/config/entra");
const graphClient = require("../src/services/graphClient");

const FORBIDDEN_KEYS = ["entra_object_id", "entra_subject_id", "password_hash", "has_password", "company_status"];

function uniqueEmail(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex")}@example.com`;
}

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

function assertNoSecrets(value) {
  const rows = Array.isArray(value) ? value : [value];
  for (const row of rows) {
    for (const key of FORBIDDEN_KEYS) {
      assert.ok(!(key in row), `response mag geen ${key} bevatten`);
    }
  }
}

async function sessionCount(pool, userId) {
  const result = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query("SELECT COUNT(*) AS n FROM dbo.Sessions WHERE user_id = @userId");
  return result.recordset[0].n;
}

async function auditRows(pool, entityId, action) {
  const result = await pool
    .request()
    .input("entityId", sql.NVarChar(50), String(entityId))
    .input("action", sql.NVarChar(100), action)
    .query(`
      SELECT user_id, company_id, metadata FROM dbo.AuditLogs
      WHERE entity_type = 'User' AND entity_id = @entityId AND action = @action
      ORDER BY id
    `);
  return result.recordset;
}

async function setMaxUsers(pool, companyId, maxUsers) {
  await pool
    .request()
    .input("id", sql.Int, companyId)
    .input("maxUsers", sql.Int, maxUsers)
    .query("UPDATE dbo.Companies SET max_users = @maxUsers WHERE id = @id");
}

test("users: rollen, tenant-grenzen en seat-limit in gebruikersbeheer", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const cleanup = { companyIds: [], userIds: [] };

  // Direct registreren (vóór de setup), zodat een halverwege mislukte setup het
  // testproces niet laat hangen op een open server/pool.
  t.after(async () => {
    await cleanupTestData(cleanup);
    await stopTestServer(server);
    await sql.close();
  });

  const companyA = await createTestCompany("Users Roles A");
  const companyB = await createTestCompany("Users Roles B");
  const suspendedCompany = await createTestCompany("Users Roles Suspended");
  // Users van deze companies (ook via de API aangemaakte) ruimt cleanupTestData zelf op.
  cleanup.companyIds.push(companyA, companyB, suspendedCompany);
  await pool
    .request()
    .input("id", sql.Int, suspendedCompany)
    .query("UPDATE dbo.Companies SET status = 'suspended' WHERE id = @id");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminA2 = await createTestUser({ companyId: companyA, role: "company_admin" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const userB = await createTestUser({ companyId: companyB, role: "company_user" });
  cleanup.userIds.push(owner.id);

  const ownerCookie = await login(baseUrl, owner);
  const adminACookie = await login(baseUrl, adminA);
  const created = {};

  await t.test("gebruikers zonder beheerrechten krijgen 403", async () => {
    const viewerCookie = await login(baseUrl, viewerA);
    const list = await request(baseUrl, "GET", "/api/users", { cookie: viewerCookie });
    assert.equal(list.status, 403);
    const create = await request(baseUrl, "POST", "/api/users", {
      cookie: viewerCookie,
      body: { email: uniqueEmail("viewer-poging"), role: "viewer" }
    });
    assert.equal(create.status, 403);
  });

  await t.test("company admin maakt product_manager, compliance_manager, viewer en company_user aan", async () => {
    for (const role of ["product_manager", "compliance_manager", "viewer", "company_user"]) {
      const res = await request(baseUrl, "POST", "/api/users", {
        cookie: adminACookie,
        body: { email: uniqueEmail(role), password: "GeldigWachtwoord123!", role, firstName: "Test", lastName: role }
      });
      assert.equal(res.status, 201, `aanmaken van ${role} moet lukken`);
      assert.equal(res.data.role, role);
      assert.equal(res.data.company_id, companyA);
      assert.equal(res.data.status, "active");
      assert.equal(res.data.identity, "local");
      assert.ok(res.data.company_name.startsWith("Users Roles A"));
      // Wachtwoord zelf opgegeven: er is geen tijdelijk wachtwoord om te tonen.
      assert.equal(res.data.tempPassword, undefined);
      assertNoSecrets(res.data);
      created[role] = res.data;
    }
  });

  await t.test("company admin kan geen company_admin of system_owner aanmaken", async () => {
    for (const role of ["company_admin", "system_owner"]) {
      const res = await request(baseUrl, "POST", "/api/users", {
        cookie: adminACookie,
        body: { email: uniqueEmail(`escalatie-${role}`), password: "GeldigWachtwoord123!", role }
      });
      assert.equal(res.status, 403, `${role} aanmaken moet 403 geven`);
    }
  });

  await t.test("company admin kan geen companyId van een andere company meegeven", async () => {
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: uniqueEmail("andere-company"), password: "GeldigWachtwoord123!", role: "viewer", companyId: companyB }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.company_id, companyA, "companyId uit de body wordt genegeerd");

    const inB = await pool
      .request()
      .input("companyId", sql.Int, companyB)
      .input("email", sql.NVarChar(256), res.data.email)
      .query("SELECT COUNT(*) AS n FROM dbo.Users WHERE company_id = @companyId AND email = @email");
    assert.equal(inB.recordset[0].n, 0);
  });

  await t.test("e-mailadres is uniek, hoofdletterongevoelig (409 EMAIL_IN_USE)", async () => {
    const res = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: created.viewer.email.toUpperCase(), password: "GeldigWachtwoord123!", role: "viewer" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "EMAIL_IN_USE");
  });

  await t.test("tijdelijk wachtwoord wordt één keer getoond en alleen als bcrypt-hash opgeslagen", async () => {
    const email = uniqueEmail("temp");
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminACookie },
      body: JSON.stringify({ email, role: "company_user" })
    });
    const data = await response.json();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(typeof data.tempPassword, "string");
    assert.ok(data.tempPassword.length >= 12);

    const row = (
      await pool.request().input("id", sql.Int, data.id).query("SELECT password_hash FROM dbo.Users WHERE id = @id")
    ).recordset[0];
    assert.ok(row.password_hash.startsWith("$2"), "alleen een bcrypt-hash in de database");
    assert.ok(!row.password_hash.includes(data.tempPassword));
    assert.ok(await verifyPassword(data.tempPassword, row.password_hash));

    const audit = await auditRows(pool, data.id, "create");
    assert.equal(audit.length, 1);
    assert.ok(!audit[0].metadata.includes(data.tempPassword), "tijdelijk wachtwoord nooit in de audit log");
    assert.deepEqual(JSON.parse(audit[0].metadata), { via: "local", role: "company_user", status: "active" });

    const again = await request(baseUrl, "GET", `/api/users/${data.id}`, { cookie: adminACookie });
    assert.equal(again.status, 200);
    assert.equal(again.data.tempPassword, undefined);
    assertNoSecrets(again.data);

    const loginRes = await request(baseUrl, "POST", "/api/auth/login", { body: { email, password: data.tempPassword } });
    assert.equal(loginRes.status, 200);
    created.tempUser = { ...data, password: data.tempPassword };
  });

  await t.test("lijst en detail bevatten nooit Entra-ids of wachtwoordhashes", async () => {
    await pool
      .request()
      .input("id", sql.Int, created.viewer.id)
      .query("UPDATE dbo.Users SET entra_object_id = CONCAT('fake-object-', id) WHERE id = @id");

    const list = await request(baseUrl, "GET", "/api/users", { cookie: adminACookie });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data));
    assertNoSecrets(list.data);
    const viewerRow = list.data.find((u) => u.id === created.viewer.id);
    assert.equal(viewerRow.identity, "entra");
    assert.ok("last_login_at" in viewerRow);
    assert.ok("company_name" in viewerRow);
    assert.ok(!JSON.stringify(list.data).includes("fake-object-"));

    const detail = await request(baseUrl, "GET", `/api/users/${created.viewer.id}`, { cookie: adminACookie });
    assert.equal(detail.status, 200);
    assertNoSecrets(detail.data);
  });

  await t.test("company admin ziet en wijzigt geen users van een andere company (404)", async () => {
    const list = await request(baseUrl, "GET", `/api/users?companyId=${companyB}`, { cookie: adminACookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.length > 0);
    assert.ok(list.data.every((u) => u.company_id === companyA), "companyId-filter geldt alleen voor de SO");

    const get = await request(baseUrl, "GET", `/api/users/${userB.id}`, { cookie: adminACookie });
    assert.equal(get.status, 404);
    const patch = await request(baseUrl, "PATCH", `/api/users/${userB.id}`, {
      cookie: adminACookie,
      body: { firstName: "Gehackt" }
    });
    assert.equal(patch.status, 404);
    const reset = await request(baseUrl, "POST", `/api/users/${userB.id}/reset-password`, { cookie: adminACookie });
    assert.equal(reset.status, 404);
    const ownerGet = await request(baseUrl, "GET", `/api/users/${owner.id}`, { cookie: adminACookie });
    assert.equal(ownerGet.status, 404, "system_owner is voor een company admin onvindbaar");
    const invalid = await request(baseUrl, "GET", "/api/users/abc", { cookie: adminACookie });
    assert.equal(invalid.status, 404);

    const row = (
      await pool.request().input("id", sql.Int, userB.id).query("SELECT first_name FROM dbo.Users WHERE id = @id")
    ).recordset[0];
    assert.equal(row.first_name, null);
  });

  await t.test("company admin kan een andere company_admin niet wijzigen of resetten (403)", async () => {
    const patch = await request(baseUrl, "PATCH", `/api/users/${adminA2.id}`, {
      cookie: adminACookie,
      body: { status: "inactive" }
    });
    assert.equal(patch.status, 403);
    const rename = await request(baseUrl, "PATCH", `/api/users/${adminA2.id}`, {
      cookie: adminACookie,
      body: { firstName: "Anders" }
    });
    assert.equal(rename.status, 403);
    const reset = await request(baseUrl, "POST", `/api/users/${adminA2.id}/reset-password`, { cookie: adminACookie });
    assert.equal(reset.status, 403);
  });

  await t.test("company admin kan geen company_admin- of system_owner-rol toekennen", async () => {
    for (const role of ["company_admin", "system_owner"]) {
      const res = await request(baseUrl, "PATCH", `/api/users/${created.company_user.id}`, {
        cookie: adminACookie,
        body: { role }
      });
      assert.equal(res.status, 403, `rol ${role} toekennen moet 403 geven`);
    }
  });

  await t.test("niemand kan de eigen rol of status wijzigen (CANNOT_MODIFY_SELF)", async () => {
    const status = await request(baseUrl, "PATCH", `/api/users/${adminA.id}`, {
      cookie: adminACookie,
      body: { status: "inactive" }
    });
    assert.equal(status.status, 400);
    assert.equal(status.data.error.code, "CANNOT_MODIFY_SELF");

    const role = await request(baseUrl, "PATCH", `/api/users/${adminA.id}`, {
      cookie: adminACookie,
      body: { role: "viewer" }
    });
    assert.equal(role.status, 400);
    assert.equal(role.data.error.code, "CANNOT_MODIFY_SELF");

    const reset = await request(baseUrl, "POST", `/api/users/${adminA.id}/reset-password`, { cookie: adminACookie });
    assert.equal(reset.status, 400);
    assert.equal(reset.data.error.code, "CANNOT_MODIFY_SELF");

    const ownerSelf = await request(baseUrl, "PATCH", `/api/users/${owner.id}`, {
      cookie: ownerCookie,
      body: { status: "blocked" }
    });
    assert.equal(ownerSelf.status, 400);
    assert.equal(ownerSelf.data.error.code, "CANNOT_MODIFY_SELF");

    // Eigen naam aanpassen mag wel.
    const rename = await request(baseUrl, "PATCH", `/api/users/${adminA.id}`, {
      cookie: adminACookie,
      body: { firstName: "Admin" }
    });
    assert.equal(rename.status, 200);
    assert.equal(rename.data.first_name, "Admin");
  });

  await t.test("PATCH accepteert geen velden buiten firstName/lastName/role/status", async () => {
    const res = await request(baseUrl, "PATCH", `/api/users/${created.company_user.id}`, {
      cookie: adminACookie,
      body: { companyId: companyB, email: "overname@example.com" }
    });
    assert.equal(res.status, 400);
  });

  await t.test("rolwijziging trekt sessies in en schrijft een role_change-audit", async () => {
    const target = created.company_user;
    const targetCookie = await login(baseUrl, { email: target.email, password: "GeldigWachtwoord123!" });
    assert.ok((await sessionCount(pool, target.id)) > 0);

    const res = await request(baseUrl, "PATCH", `/api/users/${target.id}`, {
      cookie: adminACookie,
      body: { role: "product_manager" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.role, "product_manager");
    assertNoSecrets(res.data);

    assert.equal(await sessionCount(pool, target.id), 0);
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: targetCookie });
    assert.equal(me.status, 401, "oude sessie mag niet doorwerken met oude rechten");

    const audit = await auditRows(pool, target.id, "role_change");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].user_id, adminA.id);
    assert.equal(audit[0].company_id, companyA);
    assert.deepEqual(JSON.parse(audit[0].metadata), { from: "company_user", to: "product_manager" });
  });

  await t.test("blokkeren en deactiveren trekken de sessies van de gebruiker in", async () => {
    const blockTarget = created.compliance_manager;
    await login(baseUrl, { email: blockTarget.email, password: "GeldigWachtwoord123!" });
    assert.ok((await sessionCount(pool, blockTarget.id)) > 0);

    const blocked = await request(baseUrl, "PATCH", `/api/users/${blockTarget.id}`, {
      cookie: adminACookie,
      body: { status: "blocked" }
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.data.status, "blocked");
    assert.equal(await sessionCount(pool, blockTarget.id), 0);
    const blockAudit = await auditRows(pool, blockTarget.id, "block");
    assert.deepEqual(JSON.parse(blockAudit[0].metadata), { from: "active", to: "blocked" });

    const deactivateTarget = created.tempUser;
    await login(baseUrl, deactivateTarget);
    assert.ok((await sessionCount(pool, deactivateTarget.id)) > 0);

    const deactivated = await request(baseUrl, "PATCH", `/api/users/${deactivateTarget.id}`, {
      cookie: adminACookie,
      body: { status: "inactive" }
    });
    assert.equal(deactivated.status, 200);
    assert.equal(await sessionCount(pool, deactivateTarget.id), 0);
    assert.equal((await auditRows(pool, deactivateTarget.id, "deactivate")).length, 1);

    const loginAgain = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: deactivateTarget.email, password: deactivateTarget.password }
    });
    assert.equal(loginAgain.status, 401);
  });

  await t.test("heractiveren respecteert de seat-limit (409 LICENSE_LIMIT_REACHED)", async () => {
    const active = (
      await pool
        .request()
        .input("companyId", sql.Int, companyA)
        .query("SELECT COUNT(*) AS n FROM dbo.Users WHERE company_id = @companyId AND status = 'active'")
    ).recordset[0].n;
    await setMaxUsers(pool, companyA, active);

    // Een inactieve gebruiker aanmaken neemt geen seat in en mag dus ook als het vol zit.
    const inactiveNew = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: uniqueEmail("inactief"), password: "GeldigWachtwoord123!", role: "viewer", status: "inactive" }
    });
    assert.equal(inactiveNew.status, 201);

    const activeNew = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: uniqueEmail("vol"), password: "GeldigWachtwoord123!", role: "viewer" }
    });
    assert.equal(activeNew.status, 409);
    assert.equal(activeNew.data.error.code, "LICENSE_LIMIT_REACHED");

    const reactivate = await request(baseUrl, "PATCH", `/api/users/${created.compliance_manager.id}`, {
      cookie: adminACookie,
      body: { status: "active" }
    });
    assert.equal(reactivate.status, 409);
    assert.equal(reactivate.data.error.code, "LICENSE_LIMIT_REACHED");
    const stillBlocked = await request(baseUrl, "GET", `/api/users/${created.compliance_manager.id}`, {
      cookie: adminACookie
    });
    assert.equal(stillBlocked.data.status, "blocked");

    await setMaxUsers(pool, companyA, active + 1);
    const retry = await request(baseUrl, "PATCH", `/api/users/${created.compliance_manager.id}`, {
      cookie: adminACookie,
      body: { status: "active" }
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.status, "active");
    const audit = await auditRows(pool, created.compliance_manager.id, "activate");
    assert.deepEqual(JSON.parse(audit[0].metadata), { from: "blocked", to: "active" });

    await setMaxUsers(pool, companyA, null);
  });

  await t.test("wachtwoord-reset (lokaal): nieuw tijdelijk wachtwoord, sessies weg, audit", async () => {
    const target = created.product_manager;
    const oldPassword = "GeldigWachtwoord123!";
    await login(baseUrl, { email: target.email, password: oldPassword });

    const response = await fetch(`${baseUrl}/api/users/${target.id}/reset-password`, {
      method: "POST",
      headers: { Cookie: adminACookie }
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(data), ["tempPassword"]);

    assert.equal(await sessionCount(pool, target.id), 0);
    const oldLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: target.email, password: oldPassword }
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: target.email, password: data.tempPassword }
    });
    assert.equal(newLogin.status, 200);

    const audit = await auditRows(pool, target.id, "reset_password");
    assert.equal(audit.length, 1);
    assert.ok(!audit[0].metadata.includes(data.tempPassword));
  });

  await t.test("reset van een Entra-account zonder Graph-object wordt geweigerd", async () => {
    const pure = await createTestUser({ companyId: companyA, role: "viewer" });
    await pool
      .request()
      .input("id", sql.Int, pure.id)
      .input("sub", sql.NVarChar(255), crypto.randomBytes(16).toString("hex"))
      .query("UPDATE dbo.Users SET entra_subject_id = @sub, password_hash = NULL WHERE id = @id");

    const res = await request(baseUrl, "POST", `/api/users/${pure.id}/reset-password`, { cookie: adminACookie });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "RESET_NOT_SUPPORTED");
    const row = (
      await pool.request().input("id", sql.Int, pure.id).query("SELECT password_hash FROM dbo.Users WHERE id = @id")
    ).recordset[0];
    assert.equal(row.password_hash, null, "geen lokaal wachtwoord naast Entra (zou MFA omzeilen)");
  });

  await t.test("system owner beheert gebruikers van elke company binnen de regels", async () => {
    const needsCompany = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { email: uniqueEmail("zonder-company"), password: "GeldigWachtwoord123!", role: "viewer" }
    });
    assert.equal(needsCompany.status, 400);

    // Ook de System Owner maakt geen nieuwe system_owner aan via gebruikersbeheer.
    const newOwner = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { email: uniqueEmail("so-owner"), password: "GeldigWachtwoord123!", role: "system_owner" }
    });
    assert.equal(newOwner.status, 400);
    assert.equal(newOwner.data.error.code, "ROLE_NOT_ALLOWED");

    const inactiveCompany = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: {
        email: uniqueEmail("suspended"),
        password: "GeldigWachtwoord123!",
        role: "viewer",
        companyId: suspendedCompany
      }
    });
    assert.equal(inactiveCompany.status, 409);
    assert.equal(inactiveCompany.data.error.code, "COMPANY_INACTIVE");

    const newAdmin = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { email: uniqueEmail("so-admin"), password: "GeldigWachtwoord123!", role: "company_admin", companyId: companyB }
    });
    assert.equal(newAdmin.status, 201);
    assert.equal(newAdmin.data.company_id, companyB);

    const listB = await request(baseUrl, "GET", `/api/users?companyId=${companyB}&role=company_admin`, {
      cookie: ownerCookie
    });
    assert.equal(listB.status, 200);
    assert.ok(listB.data.length >= 2);
    assert.ok(listB.data.every((u) => u.company_id === companyB && u.role === "company_admin"));
    assertNoSecrets(listB.data);

    const badFilter = await request(baseUrl, "GET", "/api/users?role=superuser", { cookie: ownerCookie });
    assert.equal(badFilter.status, 400);

    const demote = await request(baseUrl, "PATCH", `/api/users/${adminA2.id}`, {
      cookie: ownerCookie,
      body: { role: "product_manager" }
    });
    assert.equal(demote.status, 200);
    assert.equal(demote.data.role, "product_manager");

    const promote = await request(baseUrl, "PATCH", `/api/users/${adminA2.id}`, {
      cookie: ownerCookie,
      body: { role: "system_owner" }
    });
    assert.equal(promote.status, 400);

    const otherOwner = await createTestUser({ companyId: null, role: "system_owner" });
    cleanup.userIds.push(otherOwner.id);
    const demoteOwner = await request(baseUrl, "PATCH", `/api/users/${otherOwner.id}`, {
      cookie: ownerCookie,
      body: { role: "company_admin" }
    });
    assert.equal(demoteOwner.status, 400);

    // Ook status en wachtwoord van een andere System Owner blijven buiten bereik: anders
    // neemt één overgenomen SO-sessie via een reset de andere SO-accounts blijvend over of
    // sluit ze buiten. Voor- en achternaam mogen wel.
    const otherOwnerCookie = await login(baseUrl, otherOwner);
    const resetOwner = await request(baseUrl, "POST", `/api/users/${otherOwner.id}/reset-password`, {
      cookie: ownerCookie
    });
    assert.equal(resetOwner.status, 400);
    assert.equal(resetOwner.data.error.code, "ROLE_NOT_ALLOWED");
    assert.equal(resetOwner.data.tempPassword, undefined);

    for (const status of ["blocked", "inactive"]) {
      const res = await request(baseUrl, "PATCH", `/api/users/${otherOwner.id}`, {
        cookie: ownerCookie,
        body: { status }
      });
      assert.equal(res.status, 400, `status ${status} voor een andere SO hoort geweigerd te worden`);
      assert.equal(res.data.error.code, "ROLE_NOT_ALLOWED");
    }

    const otherOwnerMe = await request(baseUrl, "GET", "/api/auth/me", { cookie: otherOwnerCookie });
    assert.equal(otherOwnerMe.status, 200, "sessies van de andere SO blijven geldig");
    await login(baseUrl, otherOwner); // het eigen wachtwoord werkt nog
    assert.equal((await auditRows(pool, otherOwner.id, "reset_password")).length, 0);
    assert.equal((await auditRows(pool, otherOwner.id, "block")).length, 0);

    const renameOwner = await request(baseUrl, "PATCH", `/api/users/${otherOwner.id}`, {
      cookie: ownerCookie,
      body: { firstName: "Tweede" }
    });
    assert.equal(renameOwner.status, 200);
    assert.equal(renameOwner.data.first_name, "Tweede");
    assert.equal(renameOwner.data.status, "active");
    assert.equal(renameOwner.data.role, "system_owner");
  });

  // Gefaseerde Entra-setup: eerst alleen de login-vars (de loginpagina staat dan al in
  // Entra-modus), Graph later. isEntra*Configured leest process.env bij elke aanroep, dus
  // de env tijdelijk zetten is genoeg; st.after zet alles terug.
  await t.test("Entra-modus: geen lokale wachtwoorden meer (aanmaken 503, reset 409)", async (st) => {
    if (isEntraLoginConfigured()) {
      st.skip("echte Entra-config aanwezig; deze test draait alleen zonder");
      return;
    }
    const loginVars = {
      ENTRA_TENANT_NAME: "dpptest",
      ENTRA_TENANT_ID: crypto.randomUUID(),
      ENTRA_WEB_CLIENT_ID: crypto.randomUUID(),
      ENTRA_WEB_CLIENT_SECRET: crypto.randomBytes(16).toString("hex"),
      ENTRA_REDIRECT_URI: "http://127.0.0.1/auth/redirect",
      ENTRA_POST_LOGOUT_REDIRECT_URI: "http://127.0.0.1/login.html",
      COOKIE_SECRET: crypto.randomBytes(32).toString("hex")
    };
    const graphVars = {
      ENTRA_GRAPH_CLIENT_ID: crypto.randomUUID(),
      ENTRA_GRAPH_CLIENT_SECRET: crypto.randomBytes(16).toString("hex")
    };
    const saved = Object.fromEntries(
      [...Object.keys(loginVars), ...Object.keys(graphVars)].map((name) => [name, process.env[name]])
    );
    // Graph mag hier nooit worden aangeroepen (lokaal doelaccount zonder entra_object_id).
    const originalGraph = { create: graphClient.createEntraUser, reset: graphClient.resetPassword };
    const graphCalls = [];
    graphClient.createEntraUser = async (args) => {
      graphCalls.push(["createEntraUser", args.email]);
      throw new Error("Graph hoort hier niet aangeroepen te worden");
    };
    graphClient.resetPassword = async (id) => {
      graphCalls.push(["resetPassword", id]);
      throw new Error("Graph hoort hier niet aangeroepen te worden");
    };
    st.after(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      graphClient.createEntraUser = originalGraph.create;
      graphClient.resetPassword = originalGraph.reset;
    });

    // Lokaal account (bcrypt-hash, geen Entra-ids) met een sessie van vóór de omschakeling.
    const local = await createTestUser({ companyId: companyA, role: "viewer" });
    const localCookie = await login(baseUrl, local);

    for (const name of Object.keys(graphVars)) delete process.env[name];
    Object.assign(process.env, loginVars);

    const config = await request(baseUrl, "GET", "/api/auth/config");
    assert.equal(config.data.mode, "entra");

    // Alleen login geconfigureerd: aanmaken zou een lokaal wachtwoord opleveren waarmee
    // niemand via de (Entra-)loginpagina binnenkomt. Fail closed, niets opgeslagen.
    const newEmail = uniqueEmail("login-only");
    const byAdmin = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: newEmail, role: "viewer" }
    });
    assert.equal(byAdmin.status, 503);
    assert.equal(byAdmin.data.error.code, "IDENTITY_PROVIDER_NOT_CONFIGURED");
    assert.equal(byAdmin.data.tempPassword, undefined);
    const withPassword = await request(baseUrl, "POST", "/api/users", {
      cookie: adminACookie,
      body: { email: newEmail, password: "GeldigWachtwoord123!", role: "viewer" }
    });
    assert.equal(withPassword.status, 503);
    const byOwner = await request(baseUrl, "POST", "/api/users", {
      cookie: ownerCookie,
      body: { email: newEmail, role: "viewer", companyId: companyB }
    });
    assert.equal(byOwner.status, 503);
    assert.equal(byOwner.data.error.code, "IDENTITY_PROVIDER_NOT_CONFIGURED");
    const stored = await pool
      .request()
      .input("email", sql.NVarChar(256), newEmail)
      .query("SELECT COUNT(*) AS n FROM dbo.Users WHERE LOWER(email) = LOWER(@email)");
    assert.equal(stored.recordset[0].n, 0, "geen Users-rij aangemaakt");

    // Reset van een lokaal account: ook met volledige Entra-config (Graph erbij) geen nieuw
    // lokaal wachtwoord, want /api/auth/login is dan dicht.
    async function assertLocalResetRefused(label) {
      const res = await request(baseUrl, "POST", `/api/users/${local.id}/reset-password`, { cookie: adminACookie });
      assert.equal(res.status, 409, label);
      assert.equal(res.data.error.code, "RESET_NOT_SUPPORTED");
      assert.equal(res.data.tempPassword, undefined);
    }
    await assertLocalResetRefused("reset met alleen de login-vars");
    Object.assign(process.env, graphVars);
    await assertLocalResetRefused("reset met volledige Entra-config");

    const localLogin = await request(baseUrl, "POST", "/api/auth/login", {
      body: { email: local.email, password: local.password }
    });
    assert.equal(localLogin.status, 404);
    assert.equal(localLogin.data.error.code, "LOCAL_LOGIN_DISABLED");

    assert.deepEqual(graphCalls, []);
    const row = (
      await pool.request().input("id", sql.Int, local.id).query("SELECT password_hash FROM dbo.Users WHERE id = @id")
    ).recordset[0];
    assert.ok(await verifyPassword(local.password, row.password_hash), "bestaande hash is niet overschreven");
    assert.equal((await auditRows(pool, local.id, "reset_password")).length, 0);
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: localCookie });
    assert.equal(me.status, 200, "een geweigerde reset trekt geen sessies in");
  });
});
