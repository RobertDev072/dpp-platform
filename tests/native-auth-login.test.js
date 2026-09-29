const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sql, getPool } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

// ---------------------------------------------------------------------------------
// Kanttekening voor de reviewer:
//
// Er bestaat in deze suite geen patroon voor "een echt, inlogbaar Entra-testaccount",
// en ook geen manier om er via code één op te leveren: graphClient.createEntraUser()
// zet bij aanmaak altijd forceChangePasswordNextSignIn = true, dus een vers via Graph
// aangemaakt account kan niet direct met dat tijdelijke wachtwoord via de
// password-grant inloggen.
//
// Voor een ECHTE, geslaagde native-auth-login (test 2 hieronder, en de sessie die
// test 3 nodig heeft) is daarom een ÉÉNMALIG, handmatig voorbereid Entra-testaccount
// nodig waarvan het wachtwoord al één keer via de normale flow is gezet. Zo richt je
// dat in zonder een betaalde resource of SMS:
//   1. Maak in de bestaande gratis-tier Entra External ID-tenant een invite aan
//      voor een test-e-mailadres, of gebruik een al bestaand testaccount.
//   2. Rond de uitnodiging één keer af via de normale "wachtwoord instellen"-flow
//      (UI of rechtstreeks tegen /api/password-reset/*).
//   3. Zet, ALLEEN lokaal in je (al in .gitignore staande) .env - nooit in code of
//      git -:
//        ENTRA_TEST_ACCOUNT_EMAIL=...
//        ENTRA_TEST_ACCOUNT_PASSWORD=...
//   4. Valt dit account onder Conditional Access (zie docs/entra-external-id-setup.md,
//      sectie 6): zet het in de `DPP-Standard-Users`-groep (geen verplichte MFA),
//      anders faalt test 2 met een duidelijke, diagnostische assertion (geen hang).
//
// Zonder deze twee env vars worden de betreffende tests overgeslagen (skip, met
// duidelijke reden). Test 1 hieronder heeft dit testaccount NIET nodig.
// ---------------------------------------------------------------------------------

const REAL_ACCOUNT_EMAIL = process.env.ENTRA_TEST_ACCOUNT_EMAIL;
const REAL_ACCOUNT_PASSWORD = process.env.ENTRA_TEST_ACCOUNT_PASSWORD;
const hasRealAccount = Boolean(REAL_ACCOUNT_EMAIL && REAL_ACCOUNT_PASSWORD);
const skipReason = hasRealAccount
  ? false
  : "ENTRA_TEST_ACCOUNT_EMAIL/ENTRA_TEST_ACCOUNT_PASSWORD niet gezet - zie de kanttekening bovenaan dit bestand voor eenmalige handmatige setup";

// Zelfde constructie als het insert-patroon in tests/entra-linking.test.js (geen
// wachtwoord, wel een entra_object_id) - maar met een uniek fake object-id per
// aanroep om een unique-index-botsing te vermijden als testbestanden gelijktijdig
// draaien (zie migrations/003: UQ_Users_EntraObjectId en CHK_Users_HasAuthMethod).
async function createEntraManagedUser({ companyId, role, email }) {
  const pool = await getPool();
  const fakeObjectId = `fake-graph-object-id-${crypto.randomBytes(8).toString("hex")}`;
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .input("email", sql.NVarChar(256), email)
    .input("role", sql.NVarChar(30), role)
    .input("entraObjectId", sql.NVarChar(255), fakeObjectId)
    .query(`
      INSERT INTO dbo.Users (company_id, email, password_hash, entra_object_id, role, status)
      OUTPUT INSERTED.id
      VALUES (@companyId, @email, NULL, @entraObjectId, @role, 'active')
    `);
  return { id: result.recordset[0].id, email, companyId, role };
}

// --- Test 1: draait altijd, heeft GEEN echt Entra-testaccount nodig -----------------
// Een Entra-beheerde DPP-gebruiker (geen password_hash) met een e-mailadres dat nooit
// in de echte tenant bestaat. nativeAuth.service.js doet een echte netwerkaanroep;
// Entra antwoordt user_not_found, wat auth.routes.js vertaalt naar een schone 401 -
// dit dekt "foutieve login geeft 401, geen hang/500" voor het Entra-pad.
test("native-auth login: onbekende Entra-identiteit geeft een schone 401 (geen hang of 500)", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyId = await createTestCompany("Native Auth Unknown Co");
  const email = `native-auth-unknown-${crypto.randomBytes(4).toString("hex")}@example.com`;
  const user = await createEntraManagedUser({ companyId, role: "company_user", email });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyId], userIds: [user.id] });
    await stopTestServer(server);
  });

  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: "Wachtwoord-Dat-Er-Niet-Toe-Doet-123!" }
  });

  assert.equal(res.status, 401);
});

// --- Test 2 + 3: hebben het echte, éénmalig voorbereide testaccount nodig -----------
test(
  "native-auth login: echte Entra-tenant, company_admin-account (bestaat alleen met ENTRA_TEST_ACCOUNT_EMAIL/PASSWORD)",
  { skip: skipReason },
  async (t) => {
    const { server, baseUrl } = await startTestServer();
    const companyB = await createTestCompany("Native Auth Company B");
    const companyA = await createTestCompany("Native Auth Company A");
    const adminB = await createEntraManagedUser({
      companyId: companyB,
      role: "company_admin",
      email: REAL_ACCOUNT_EMAIL
    });
    const productA = await createTestProduct({ companyId: companyA, name: "Product A (native-auth isolation)" });

    t.after(async () => {
      await cleanupTestData({
        companyIds: [companyA, companyB],
        userIds: [adminB.id],
        productIds: [productA]
      });
      await stopTestServer(server);
    });

    let sessionCookie;

    await t.test("1: correcte e-mail+wachtwoord tegen de echte tenant geeft 200, het juiste response-shape en een sessie-cookie", async () => {
      const res = await request(baseUrl, "POST", "/api/auth/login", {
        body: { email: adminB.email, password: REAL_ACCOUNT_PASSWORD }
      });

      if (res.status === 200 && res.data && res.data.mfaRequired) {
        assert.fail(
          "Login vroeg om MFA (mfaRequired: true) - dit testaccount moet in de Conditional-Access-groep " +
            "'DPP-Standard-Users' zitten (geen verplichte MFA), zie de kanttekening bovenaan dit bestand. " +
            "Dit is geen bug in de test of de app, alleen een tenant-configuratiestap die nog moet gebeuren."
        );
      }

      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.data).sort(), ["companyId", "email", "id", "role"].sort());
      assert.equal(res.data.email, adminB.email);
      assert.equal(res.data.role, "company_admin");
      assert.equal(res.data.companyId, companyB);
      assert.ok(Number.isInteger(res.data.id));
      assert.ok(res.cookie, "verwacht een Set-Cookie header");
      sessionCookie = res.cookie;
    });

    await t.test("1b: /me met de sessie-cookie bevestigt dezelfde, echte-tenant-gekoppelde gebruiker", async () => {
      const res = await request(baseUrl, "GET", "/api/auth/me", { cookie: sessionCookie });
      assert.equal(res.status, 200);
      assert.equal(res.data.email, adminB.email);
    });

    await t.test("2: verkeerd wachtwoord voor hetzelfde, bij Entra bekende account geeft een schone 401 (geen hang of 500)", async () => {
      const res = await request(baseUrl, "POST", "/api/auth/login", {
        body: { email: adminB.email, password: `${REAL_ACCOUNT_PASSWORD}-fout` }
      });
      assert.equal(res.status, 401);
    });

    await t.test("3: tenant isolation blijft gelden: company_admin B (native-auth) krijgt 404, geen 403, bij direct opvragen van product A", async () => {
      const res = await request(baseUrl, "GET", `/api/products/${productA}`, { cookie: sessionCookie });
      assert.equal(res.status, 404);
    });

    await t.test("3b: company_admin B (native-auth) ziet product A ook niet terug in de lijst", async () => {
      const res = await request(baseUrl, "GET", "/api/products", { cookie: sessionCookie });
      assert.equal(res.status, 200);
      assert.ok(!res.data.some((p) => p.id === productA));
    });
  }
);

after(async () => {
  await sql.close();
});
