const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const mfa = require("../src/services/mfa.service");

// Tweestapsverificatie verplicht voor beheerders, "Onthoud deze computer 30 dagen", en het
// lokveld tegen bots op het inlogformulier.

process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || "test-cookie-secret";

const codeFor = (secret, offsetSteps = 0) => mfa.hotp(mfa.base32Decode(secret), mfa.currentStep() + offsetSteps);

function cookieFrom(response, name) {
  const all = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const match = all.map((c) => new RegExp(`(?:^|\\s)${name}=([^;]*)`).exec(c)).find(Boolean);
  return match ? `${name}=${match[1]}` : null;
}

async function post(baseUrl, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  return { response, status: response.status, data };
}

test("MFA verplicht voor beheerders, vertrouwd apparaat en lokveld", async (t) => {
  const previous = process.env.MFA_ENFORCE_ADMINS;
  process.env.MFA_ENFORCE_ADMINS = "true";
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("MFA verplicht");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const user = await createTestUser({ companyId: company, role: "company_user" });

  t.after(async () => {
    if (previous === undefined) delete process.env.MFA_ENFORCE_ADMINS;
    else process.env.MFA_ENFORCE_ADMINS = previous;
    await cleanupTestData({ companyIds: [company], userIds: [admin.id, user.id] });
    await stopTestServer(server);
    await sql.close();
  });

  let secret;

  await t.test("beheerder zonder MFA: alleen instellen mag, de rest wordt geweigerd", async () => {
    const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: admin.email, password: admin.password } });
    assert.equal(login.status, 200);
    const cookie = login.cookie;
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie });
    assert.equal(me.data.mfaSetupRequired, true);
    const blocked = await request(baseUrl, "GET", "/api/products", { cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, "MFA_SETUP_REQUIRED");
    assert.equal((await request(baseUrl, "GET", "/api/company", { cookie })).status, 403);

    const status = await request(baseUrl, "GET", "/api/auth/mfa", { cookie });
    assert.equal(status.data.required, true);
    const setup = await request(baseUrl, "POST", "/api/auth/mfa/setup", { cookie });
    assert.equal(setup.status, 200);
    secret = setup.data.secret;
    const enabled = await request(baseUrl, "POST", "/api/auth/mfa/enable", { cookie, body: { code: codeFor(secret) } });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.data));

    assert.equal((await request(baseUrl, "GET", "/api/products", { cookie })).status, 200, "na instellen werkt alles");
    const off = await request(baseUrl, "POST", "/api/auth/mfa/disable", { cookie, body: { password: admin.password, code: codeFor(secret, 1) } });
    assert.equal(off.status, 403);
    assert.equal(off.data.error.code, "MFA_REQUIRED");
  });

  await t.test("medewerker hoeft geen MFA", async () => {
    const login = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: login.cookie });
    assert.equal(me.data.mfaSetupRequired, false);
    assert.equal((await request(baseUrl, "GET", "/api/products", { cookie: login.cookie })).status, 200);
  });

  await t.test("onthoud deze computer: daarna alleen wachtwoord, tot 'alle computers vergeten'", async () => {
    const first = await post(baseUrl, "/api/auth/login", { email: admin.email, password: admin.password });
    assert.equal(first.data.mfaRequired, true);
    const verify = await post(baseUrl, "/api/auth/mfa/verify", { ticket: first.data.mfaTicket, code: codeFor(secret, 1), rememberDevice: true });
    assert.equal(verify.status, 200, JSON.stringify(verify.data));
    const trusted = cookieFrom(verify.response, "vp_trusted");
    assert.ok(trusted, "vertrouwd-cookie gezet");
    const setCookie = verify.response.headers.getSetCookie().find((c) => c.startsWith("vp_trusted="));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Path=\/api\/auth/i);
    assert.match(setCookie, /SameSite=Strict/i);

    const again = await post(baseUrl, "/api/auth/login", { email: admin.email, password: admin.password }, trusted);
    assert.equal(again.status, 200);
    assert.equal(again.data.mfaRequired, undefined, "geen code nodig op dit apparaat");
    const session = cookieFrom(again.response, "dpp_session");
    assert.ok(session);

    const wrongPassword = await post(baseUrl, "/api/auth/login", { email: admin.email, password: "VerkeerdWachtwoord123!" }, trusted);
    assert.equal(wrongPassword.status, 401, "wachtwoord blijft altijd nodig");

    const status = await request(baseUrl, "GET", "/api/auth/mfa", { cookie: session });
    assert.equal(status.data.trustedDevices, 1);
    assert.equal((await request(baseUrl, "DELETE", "/api/auth/trusted-devices", { cookie: session })).status, 200);
    const afterForget = await post(baseUrl, "/api/auth/login", { email: admin.email, password: admin.password }, trusted);
    assert.equal(afterForget.data.mfaRequired, true, "na vergeten weer een code");
  });

  await t.test("lokveld ingevuld: geweigerd met hetzelfde antwoord als een mislukte poging", async () => {
    const bot = await post(baseUrl, "/api/auth/login", { email: user.email, password: user.password, website: "https://spam.example" });
    assert.equal(bot.status, 401);
    assert.equal(bot.data.error.code, "INVALID_CREDENTIALS");
  });
});
