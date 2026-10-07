const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { isLegacyEntraConfigured } = require("../src/config/entra");

// Zelfservice-herstel bestaat alleen tijdens de Entra-overgangsfase (zie
// src/config/entra.js). Zonder die configuratie draaien de Entra-tests niet en
// geldt de "niet beschikbaar"-test onderaan.
const legacyOnly = { skip: !isLegacyEntraConfigured() && "Entra-overgangslogin niet geconfigureerd" };

// ---------------------------------------------------------------------------------
// Kanttekening voor de reviewer:
//
// Een volledige end-to-end SSPR-test (echt een reset-code via e-mail ontvangen en
// daarmee een nieuw wachtwoord zetten) is bewust NIET opgenomen: er is geen
// test-mailbox-API, geen Graph Mail.Read-permissie en geen OTP-bypass-testhook.
// Zelf een code verzinnen test alleen dat Entra een verzonnen code afwijst - en dat
// is precies wat de "invalid code"-test hieronder al dekt.
//
// Dit bestand test daarom de veilige, deterministische randgevallen die zonder een
// echte, afgeleverde code getest kunnen worden. De eerste en vierde test doen een
// ECHTE netwerkaanroep naar de Entra-tenant (geen mocks), zonder een geslaagde flow
// te hoeven voltooien, zonder SMS en zonder betaalde resources.
//
// Geen van de tests raakt de SQL-database (de /start- en /verify-code-routes doen
// zelf geen DB-call). sql.close() aan het eind is een no-op-vangnet.
// ---------------------------------------------------------------------------------

test("password reset: onbekend e-mailadres bij /start lekt niet of het bestaat (200, continuationToken: null)", legacyOnly, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const email = `password-reset-unknown-${crypto.randomBytes(4).toString("hex")}@example.com`;
  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: { email } });

  assert.equal(res.status, 200);
  assert.equal(res.data.continuationToken, null);
});

test("password reset: ongeldig e-mailadres in de request body geeft 400 op validatieniveau (geen Entra-call nodig)", legacyOnly, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: { email: "geen-geldig-adres" } });

  assert.equal(res.status, 400);
});

test("password reset: ontbrekend e-mailveld bij /start geeft 400 op validatieniveau", legacyOnly, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: {} });

  assert.equal(res.status, 400);
});

test("password reset: ongeldige/verzonnen code + token bij /verify-code geeft een schone 400, geen hang of 500", legacyOnly, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  // continuationToken en code voldoen aan het zod-schema (beide min. 1 teken), dus
  // dit komt echt bij nativeAuth.submitPasswordResetCode() en de echte tenant terecht.
  // mapNativeAuthError() vertaalt elke NativeAuthError naar 400 - dat is wat we
  // toetsen, niet een specifieke Entra-foutcode.
  const res = await request(baseUrl, "POST", "/api/password-reset/verify-code", {
    body: { continuationToken: "verzonnen-token-bestaat-niet", code: "000000" }
  });

  assert.equal(res.status, 400);
  assert.notEqual(res.status, 500);
});

test("password reset: ontbrekende code bij /verify-code geeft 400 op validatieniveau (geen Entra-call nodig)", legacyOnly, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/verify-code", {
    body: { continuationToken: "iets", code: "" }
  });

  assert.equal(res.status, 400);
});

after(async () => {
  await sql.close();
});

test(
  "password reset: zonder Entra-overgangsfase geeft /start een duidelijke 503 (vraag de beheerder)",
  { skip: isLegacyEntraConfigured() && "Entra-overgangslogin is geconfigureerd" },
  async (t) => {
    const { server, baseUrl } = await startTestServer();
    t.after(() => stopTestServer(server));

    const res = await request(baseUrl, "POST", "/api/password-reset/start", {
      body: { email: "iemand@example.com" }
    });

    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, "SELF_SERVICE_RESET_UNAVAILABLE");
  }
);
