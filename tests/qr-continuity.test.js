const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const { getPassportUrl } = require("../src/utils/baseUrl");

// Gedrukte QR-codes moeten eeuwig blijven werken, ook na de verhuizing van Azure SQL
// (GUID's in hoofdletters) naar Postgres (uuid's in kleine letters).

test("QR-continuïteit: paspoortlink in hoofdletters en kleine letters, kapotte id geeft 404", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("QR Continuity Co");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const productId = await createTestProduct({ companyId: company, name: "QR Product" });

  t.after(async () => {
    await cleanupTestData({ companyIds: [company], userIds: [admin.id], productIds: [productId] });
    await stopTestServer(server);
    await sql.close();
  });

  const login = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: admin.email, password: admin.password }
  });
  assert.equal(login.status, 200);

  const published = await request(baseUrl, "POST", `/api/products/${productId}/publish`, { cookie: login.cookie });
  assert.equal(published.status, 200);
  const publicId = String(published.data.public_id);

  const upper = await request(baseUrl, "GET", `/api/public/products/${publicId.toUpperCase()}`);
  assert.equal(upper.status, 200, "QR-codes uit de Azure-tijd (hoofdletters) moeten blijven werken");

  const lower = await request(baseUrl, "GET", `/api/public/products/${publicId.toLowerCase()}`);
  assert.equal(lower.status, 200);

  const broken = await request(baseUrl, "GET", "/api/public/products/geen-geldige-id");
  assert.equal(broken.status, 404, "een kapotte/geraden id is 'niet gevonden', geen serverfout");

  // Gearchiveerd blijft bereikbaar (gedrukte code mag nooit stoppen met werken).
  const archived = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: login.cookie });
  assert.equal(archived.status, 200);
  const afterArchive = await request(baseUrl, "GET", `/api/public/products/${publicId.toUpperCase()}`);
  assert.equal(afterArchive.status, 200);
  assert.equal(afterArchive.data.archived, true);
});

test("QR-continuïteit: QR-URL-formaat is {QR_BASE_URL}/p/{PUBLIC_ID in hoofdletters}", () => {
  const previous = process.env.QR_BASE_URL;
  process.env.QR_BASE_URL = "https://qr.veripasso.com/";
  try {
    const fakeReq = { protocol: "https", get: () => "app.veripasso.com" };
    assert.equal(
      getPassportUrl(fakeReq, "0f8fad5b-d9cb-469f-a165-70867728950e"),
      "https://qr.veripasso.com/p/0F8FAD5B-D9CB-469F-A165-70867728950E"
    );
  } finally {
    if (previous === undefined) delete process.env.QR_BASE_URL;
    else process.env.QR_BASE_URL = previous;
  }
});
