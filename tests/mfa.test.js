const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const mfa = require("../src/services/mfa.service");

process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || "test-cookie-secret";

test("TOTP: RFC 6238-testvector (SHA1) en tijdvenster", () => {
  // RFC 6238 bijlage B: sleutel "12345678901234567890", T = 59 s -> 94287082 (8 cijfers);
  // de laatste 6 cijfers zijn de 6-cijferige code.
  const key = Buffer.from("12345678901234567890");
  assert.equal(mfa.hotp(key, Math.floor(59 / 30)), "287082");
  assert.equal(mfa.hotp(key, Math.floor(1111111109 / 30)), "081804");

  const secret = mfa.base32Encode(key);
  const now = 1111111109 * 1000;
  assert.equal(mfa.verifyTotp(secret, "081804", { now }), Math.floor(1111111109 / 30));
  assert.equal(mfa.verifyTotp(secret, "000000", { now }), null);
  assert.equal(mfa.verifyTotp(secret, "081804", { now, lastStep: Math.floor(1111111109 / 30) }), null, "geen hergebruik");
});

test("MFA: versleuteling, tickets en herstelcodes", () => {
  const enc = mfa.encryptSecret("JBSWY3DPEHPK3PXP");
  assert.ok(enc.startsWith("v1:") && !enc.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(mfa.decryptSecret(enc), "JBSWY3DPEHPK3PXP");
  const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
  assert.throws(() => mfa.decryptSecret(tampered));

  const ticket = mfa.createTicket(42);
  assert.equal(mfa.readTicket(ticket), 42);
  assert.equal(mfa.readTicket(ticket, Date.now() + 6 * 60 * 1000), null, "verlopen na 5 minuten");
  assert.equal(mfa.readTicket(`${ticket}x`), null);

  const { codes, hashes } = mfa.generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(mfa.hashRecoveryCode(codes[0].toLowerCase()), hashes[0]);
});

function codeFor(secret, offsetSteps = 0) {
  return mfa.hotp(mfa.base32Decode(secret), mfa.currentStep() + offsetSteps);
}

test("MFA: koppelen, inloggen in twee stappen, replay, herstelcode, reset door beheerder", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("MFA Co");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const user = await createTestUser({ companyId: company, role: "company_user" });
  const otherCompany = await createTestCompany("MFA Other");
  const otherAdmin = await createTestUser({ companyId: otherCompany, role: "company_admin" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [company, otherCompany], userIds: [admin.id, user.id, otherAdmin.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const first = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(first.status, 200);
  const cookie = first.cookie;

  const setup = await request(baseUrl, "POST", "/api/auth/mfa/setup", { cookie });
  assert.equal(setup.status, 200);
  // Label "VeriPasso:<e-mail>", URL-gecodeerd (dubbele punt als %3A is toegestaan).
  assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\/VeriPasso(:|%3A)/);
  assert.match(setup.data.otpauthUri, /issuer=VeriPasso/);
  assert.match(setup.data.qrDataUrl, /^data:image\/png;base64,/);
  const secret = setup.data.secret;

  const wrong = await request(baseUrl, "POST", "/api/auth/mfa/enable", { cookie, body: { code: "000000" } });
  assert.equal(wrong.status, 400);
  const enableCode = codeFor(secret);
  const enabled = await request(baseUrl, "POST", "/api/auth/mfa/enable", { cookie, body: { code: enableCode } });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.recoveryCodes.length, 10);
  const recoveryCodes = enabled.data.recoveryCodes;

  await t.test("wachtwoord alleen geeft géén sessie meer", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    assert.equal(res.status, 200);
    assert.equal(res.data.mfaRequired, true);
    assert.ok(res.data.mfaTicket);
    assert.equal(res.cookie, null, "geen sessiecookie vóór de tweede stap");
  });

  await t.test("code is maar één keer geldig; een volgende tijdstap werkt wel", async () => {
    // De bij het koppelen gebruikte stap is al verbruikt: dezelfde code opnieuw faalt.
    const login1 = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    const replay = await request(baseUrl, "POST", "/api/auth/mfa/verify", { body: { ticket: login1.data.mfaTicket, code: enableCode } });
    assert.equal(replay.status, 401);
    const next = await request(baseUrl, "POST", "/api/auth/mfa/verify", { body: { ticket: login1.data.mfaTicket, code: codeFor(secret, 1) } });
    assert.equal(next.status, 200, "volgende tijdstap (klokverschil-venster) wordt geaccepteerd");
    assert.ok(next.cookie, "pas nu een sessie");
  });

  await t.test("een vervalst ticket wordt geweigerd", async () => {
    const res = await request(baseUrl, "POST", "/api/auth/mfa/verify", { body: { ticket: "bmVw.nep", code: "123456" } });
    assert.equal(res.status, 401);
    assert.equal(res.data.error.code, "MFA_TICKET_INVALID");
  });

  await t.test("herstelcode werkt precies één keer", async () => {
    const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    const ok = await request(baseUrl, "POST", "/api/auth/mfa/verify", { body: { ticket: login.data.mfaTicket, recoveryCode: recoveryCodes[0] } });
    assert.equal(ok.status, 200);
    const again = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    const reused = await request(baseUrl, "POST", "/api/auth/mfa/verify", { body: { ticket: again.data.mfaTicket, recoveryCode: recoveryCodes[0] } });
    assert.equal(reused.status, 401);
  });

  await t.test("een wachtwoordreset door de beheerder omzeilt MFA niet", async () => {
    const adminLogin = await request(baseUrl, "POST", "/api/auth/login", { body: { email: admin.email, password: admin.password } });
    const reset = await request(baseUrl, "POST", `/api/users/${user.id}/reset-password`, { cookie: adminLogin.cookie });
    assert.equal(reset.status, 200);
    const temp = reset.data.tempPassword;

    const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: temp } });
    assert.equal(login.data.mustChangePassword, true);
    assert.equal(login.data.mfaRequired, true);

    const withoutCode = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: user.email, currentPassword: temp, newPassword: "EenNieuwWachtwoord!2026" }
    });
    assert.equal(withoutCode.status, 401);
    assert.equal(withoutCode.data.error.code, "MFA_INVALID");

    const withCode = await request(baseUrl, "POST", "/api/auth/change-password", {
      body: { email: user.email, currentPassword: temp, newPassword: "EenNieuwWachtwoord!2026", recoveryCode: recoveryCodes[1] }
    });
    assert.equal(withCode.status, 200);
    user.password = "EenNieuwWachtwoord!2026";
  });

  await t.test("MFA-reset: alleen beheerder van het eigen bedrijf; daarna weer inloggen met alleen wachtwoord", async () => {
    const otherLogin = await request(baseUrl, "POST", "/api/auth/login", { body: { email: otherAdmin.email, password: otherAdmin.password } });
    const foreign = await request(baseUrl, "POST", `/api/users/${user.id}/mfa/reset`, { cookie: otherLogin.cookie });
    assert.equal(foreign.status, 404);

    const adminLogin = await request(baseUrl, "POST", "/api/auth/login", { body: { email: admin.email, password: admin.password } });
    const reset = await request(baseUrl, "POST", `/api/users/${user.id}/mfa/reset`, { cookie: adminLogin.cookie });
    assert.equal(reset.status, 200);

    const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    assert.equal(login.status, 200);
    assert.ok(login.cookie, "na reset weer direct een sessie");
    const list = await request(baseUrl, "GET", "/api/users", { cookie: adminLogin.cookie });
    assert.equal(list.data.find((u) => u.id === user.id).mfa_enabled, false);
  });
});
