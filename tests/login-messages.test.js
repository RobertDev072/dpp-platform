const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");
const { validateLogin, loginErrorMessage } = require("../lib/loginMessages");

// Meldingen bij inloggen: duidelijk voor de gebruiker, maar zonder te verraden of een
// e-mailadres een account heeft (onbekend adres en verkeerd wachtwoord geven hetzelfde).

test("controle vóór versturen: lege velden en ongeldig e-mailadres", () => {
  assert.equal(validateLogin({ email: "", password: "" }).title, "Vul je e-mailadres en wachtwoord in.");
  assert.equal(validateLogin({ email: "  ", password: "x" }).title, "Vul je e-mailadres in.");
  assert.equal(validateLogin({ email: "naam@bedrijf", password: "x" }).title, "Dit is geen geldig e-mailadres.");
  assert.equal(validateLogin({ email: "naam@bedrijf.nl", password: "" }).field, "password");
  assert.equal(validateLogin({ email: "naam@bedrijf.nl", password: "geheim" }), null);
});

test("meldingen per foutcode", () => {
  assert.equal(loginErrorMessage({ code: "INVALID_CREDENTIALS", status: 401 }).title, "E-mailadres of wachtwoord klopt niet.");
  assert.match(loginErrorMessage({ code: "ACCOUNT_INACTIVE", status: 403 }).title, /geblokkeerd/);
  assert.equal(loginErrorMessage({ code: "RATE_LIMITED", status: 429, message: "Probeer het over 15 minuten opnieuw." }).hint, "Probeer het over 15 minuten opnieuw.");
  assert.match(loginErrorMessage({ code: "TEMP_PASSWORD_EXPIRED" }).title, /verlopen/);
  assert.match(loginErrorMessage(Object.assign(new TypeError("Failed to fetch"))).title, /Geen verbinding/);
  assert.match(loginErrorMessage({ status: 503 }).title, /ging iets mis/);
});

test("inloggen: zelfde antwoord voor onbekend adres en verkeerd wachtwoord; geblokkeerd alleen met juist wachtwoord", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const pool = await getPool();
  const company = await createTestCompany("Login meldingen");
  const user = await createTestUser({ companyId: company, role: "company_user" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [company], userIds: [user.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const login = (email, password) => request(baseUrl, "POST", "/api/auth/login", { body: { email, password } });

  const unknown = await login(`niet-bestaand-${Date.now()}@example.com`, "WelkWachtwoord123!");
  const wrong = await login(user.email, "VerkeerdWachtwoord123!");
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.data, wrong.data, "geen verschil tussen onbekend adres en verkeerd wachtwoord");
  assert.equal(wrong.data.error.code, "INVALID_CREDENTIALS");
  assert.equal(wrong.data.error.message, "E-mailadres of wachtwoord klopt niet.");

  await pool.query("UPDATE dbo.users SET status = 'blocked' WHERE id = $1", [user.id]);
  const blockedWrong = await login(user.email, "VerkeerdWachtwoord123!");
  assert.equal(blockedWrong.status, 401, "geblokkeerd + verkeerd wachtwoord verraadt niets");
  assert.deepEqual(blockedWrong.data, wrong.data);
  const blockedRight = await login(user.email, user.password);
  assert.equal(blockedRight.status, 403);
  assert.equal(blockedRight.data.error.code, "ACCOUNT_INACTIVE");
  assert.ok(!blockedRight.cookie, "geen sessie voor een geblokkeerd account");

  await pool.query("UPDATE dbo.users SET status = 'active' WHERE id = $1", [user.id]);
  const ok = await login(user.email, user.password);
  assert.equal(ok.status, 200);
});
