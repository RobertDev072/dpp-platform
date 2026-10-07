const test = require("node:test");
const assert = require("node:assert/strict");
const { closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request, directUpload } = require("./helpers/testServer");
const { isSupabaseConfigured } = require("../src/config/supabase");
const {
  createTestCompany,
  createTestUser,
  createTestProduct,
  cleanupTestData
} = require("./helpers/fixtures");

// Documentupload rechtstreeks naar Supabase Storage. Zelfde voorwaarde als de
// fototest: zonder SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY worden de echte
// upload/downloaddelen overgeslagen; validatie en tenant-isolatie draaien altijd.
const storageSkipReason = isSupabaseConfigured()
  ? false
  : "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY niet gezet - zie README.md";

// Kleinst mogelijke PDF-bytes (de inhoud is hier niet relevant, alleen type/grootte).
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

function uploadDocument(baseUrl, { productId, cookie, buffer, mimeType, fields = {} }) {
  return directUpload(baseUrl, {
    cookie,
    requestPath: `/api/products/${productId}/documents/upload-url`,
    completePath: `/api/products/${productId}/documents/upload`,
    buffer,
    mimeType,
    fields
  });
}

test("productdocumenten: upload, validatie, download en publieke zichtbaarheid", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyA = await createTestCompany("Docs Company A");
  const companyB = await createTestCompany("Docs Company B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const productA = await createTestProduct({ companyId: companyA, name: "Docs Product A" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [adminA.id, adminB.id],
      productIds: [productA]
    });
    await stopTestServer(server);
    await closePool();
  });

  const adminACookie = await login(baseUrl, adminA);
  const adminBCookie = await login(baseUrl, adminB);

  await t.test("te groot bestand geeft een duidelijke melding", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 1);
    const res = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminACookie,
      buffer: big,
      mimeType: "application/pdf",
      fields: { title: "Te groot" }
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /te groot/i);
  });

  await t.test("niet-ondersteund bestandstype wordt geweigerd", async () => {
    const res = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminACookie,
      buffer: Buffer.from("MZ..."),
      mimeType: "application/x-msdownload",
      fields: { title: "Foute boel" }
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /PDF, JPEG, PNG, SVG of WEBP/);
  });

  await t.test("ontbrekende titel geeft een veldfout (bij het afronden)", async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productA}/documents/upload`, {
      cookie: adminACookie,
      body: { path: `${companyA}/${productA}/00000000-0000-0000-0000-000000000000.pdf` }
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.details?.fieldErrors?.title);
  });

  await t.test("afronden met een pad van een ander product wordt geweigerd", { skip: storageSkipReason }, async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productA}/documents/upload`, {
      cookie: adminACookie,
      body: { path: `${companyB}/999/00000000-0000-0000-0000-000000000000.pdf`, title: "Kaping" }
    });
    assert.equal(res.status, 400);
  });

  await t.test("cross-tenant upload geeft 404", async () => {
    const res = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminBCookie,
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
      fields: { title: "Hack" }
    });
    assert.equal(res.status, 404);
  });

  await t.test("upload + download + publieke link werken end-to-end", { skip: storageSkipReason }, async (t2) => {
    const up = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminACookie,
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
      fields: { title: "Handleiding", category: "manual", isPublic: true }
    });
    assert.equal(up.status, 201);
    assert.ok(up.data.blob_name);
    assert.equal(up.data.file_size, PDF_BYTES.length);

    // Eigen (ingelogde) download: redirect naar een kortlevende signed URL
    const file = await fetch(`${baseUrl}/api/products/${productA}/documents/${up.data.id}/file`, {
      headers: { Cookie: adminACookie }
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");

    // Cross-tenant download geeft 404
    const cross = await fetch(`${baseUrl}/api/products/${productA}/documents/${up.data.id}/file`, {
      headers: { Cookie: adminBCookie },
      redirect: "manual"
    });
    assert.equal(cross.status, 404);

    // Publiek: pas zichtbaar/downloadbaar na publicatie van het product
    const publish = await request(baseUrl, "POST", `/api/products/${productA}/publish`, { cookie: adminACookie });
    assert.equal(publish.status, 200);
    const pub = await request(baseUrl, "GET", `/api/public/products/${publish.data.public_id}`);
    assert.equal(pub.status, 200);
    const doc = pub.data.documents.find((d) => d.id === up.data.id);
    assert.ok(doc, "publiek document hoort in het paspoort te staan");
    assert.ok(doc.downloadUrl.includes("/documents/"));

    const pubFile = await fetch(`${baseUrl}${doc.downloadUrl}`);
    assert.equal(pubFile.status, 200);
    assert.equal(pubFile.headers.get("content-type"), "application/pdf");

    // Niet-publiek document blijft onzichtbaar op het publieke paspoort
    const up2 = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminACookie,
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
      fields: { title: "Intern document", isPublic: false }
    });
    assert.equal(up2.status, 201);
    const pub2 = await request(baseUrl, "GET", `/api/public/products/${publish.data.public_id}`);
    assert.ok(!pub2.data.documents.some((d) => d.id === up2.data.id));
    const hidden = await fetch(`${baseUrl}/api/public/products/${publish.data.public_id}/documents/${up2.data.id}/file`);
    assert.equal(hidden.status, 404);
  });
});
