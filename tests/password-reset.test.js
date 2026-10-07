const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { closePool } = require("../src/config/db");
const { isSupabaseConfigured } = require("../src/config/supabase");
const { signToken, verifyToken } = require("../src/utils/signedToken");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");

// ---------------------------------------------------------------------------------
// "Wachtwoord vergeten" loopt via Supabase Auth (e-mail met eenmalige code). Een
// volledige end-to-end test (echt een code uit een mailbox halen) is bewust niet
// opgenomen: er is geen test-mailbox-API. Dit bestand test de deterministische
// randgevallen; de tests die Supabase echt aanroepen draaien alleen als
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY gezet zijn.
// ---------------------------------------------------------------------------------

const supabaseSkip = isSupabaseConfigured() ? false : "Supabase niet geconfigureerd (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)";

test("password reset: onbekend e-mailadres bij /start lekt niet of het bestaat", { skip: supabaseSkip }, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const email = `password-reset-unknown-${crypto.randomBytes(4).toString("hex")}@example.com`;
  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: { email } });

  // Zelfde antwoord als voor een bestaand adres: een token voor de volgende stap.
  assert.equal(res.status, 200);
  assert.ok(res.data.continuationToken);
});

test("password reset: zonder Supabase-configuratie geeft /start een nette 503", { skip: !supabaseSkip }, async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: { email: "iemand@example.com" } });
  assert.equal(res.status, 503);
  assert.equal(res.data.error.code, "AUTH_UNAVAILABLE");
});

test("password reset: ongeldig e-mailadres in de request body geeft 400 op validatieniveau", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: { email: "geen-geldig-adres" } });

  assert.equal(res.status, 400);
});

test("password reset: ontbrekend e-mailveld bij /start geeft 400 op validatieniveau", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/start", { body: {} });

  assert.equal(res.status, 400);
});

test("password reset: verzonnen token bij /verify-code en /submit geeft een schone 400 EXPIRED, geen 500", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const verify = await request(baseUrl, "POST", "/api/password-reset/verify-code", {
    body: { continuationToken: "verzonnen-token-bestaat-niet", code: "000000" }
  });
  assert.equal(verify.status, 400);
  assert.equal(verify.data.error.code, "EXPIRED");

  // Een geldig ondertekend start-token mag nooit als "geverifieerd" token werken.
  const startToken = signToken("password-reset-start", { email: "a@example.com" }, 60000);
  const submit = await request(baseUrl, "POST", "/api/password-reset/submit", {
    body: { continuationToken: startToken, password: "EenLangGenoegWachtwoord1!" }
  });
  assert.equal(submit.status, 400);
  assert.equal(submit.data.error.code, "EXPIRED");
});

test("password reset: ontbrekende code bij /verify-code geeft 400 op validatieniveau", async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(() => stopTestServer(server));

  const res = await request(baseUrl, "POST", "/api/password-reset/verify-code", {
    body: { continuationToken: "iets", code: "" }
  });

  assert.equal(res.status, 400);
});

test("ondertekende tokens: doel, verloop en manipulatie worden gecontroleerd", () => {
  const token = signToken("doel-a", { authUserId: "x" }, 60000);
  assert.equal(verifyToken(token, "doel-a").authUserId, "x");
  assert.equal(verifyToken(token, "doel-b"), null);
  assert.equal(verifyToken(signToken("doel-a", {}, -1), "doel-a"), null);

  const [body, sig] = token.split(".");
  const tampered = Buffer.from(JSON.stringify({ authUserId: "y", purpose: "doel-a", exp: Date.now() + 60000 })).toString("base64url");
  assert.equal(verifyToken(`${tampered}.${sig}`, "doel-a"), null);
  assert.equal(verifyToken(`${body}.`, "doel-a"), null);
});

after(async () => {
  await closePool();
});
