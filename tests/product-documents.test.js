const test = require("node:test");
const assert = require("node:assert/strict");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const {
  createTestCompany,
  createTestUser,
  createTestProduct,
  cleanupTestData
} = require("./helpers/fixtures");

// Documentupload naar S3. Zelfde voorwaarde als de fototest: zonder TEST_S3_LIVE=true
// (met testbuckets) worden de echte
// upload/downloaddelen overgeslagen; validatie en tenant-isolatie draaien altijd.
const { isStorageConfigured } = require("../src/config/storage");
const hasStorageConfigured = process.env.TEST_S3_LIVE === "true" && isStorageConfigured();
const storageSkipReason = hasStorageConfigured
  ? false
  : "TEST_S3_LIVE niet gezet - live S3-test overgeslagen (zie README.md)";

// Kleinst mogelijke geldige PDF-bytes (header volstaat voor de mimetype-flow; multer
// controleert het door de client meegegeven type, de inhoud is hier niet relevant).
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

async function uploadDocument(baseUrl, { productId, cookie, buffer, mimeType, filename, fields = {} }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const response = await fetch(`${baseUrl}/api/products/${productId}/documents/upload`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
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
    await sql.close();
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
      filename: "groot.pdf",
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
      filename: "virus.exe",
      fields: { title: "Foute boel" }
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /PDF, JPEG, PNG, SVG of WEBP/);
  });

  await t.test("ontbrekende titel geeft een veldfout", { skip: storageSkipReason }, async () => {
    const res = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminACookie,
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
      filename: "handleiding.pdf"
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.details?.fieldErrors?.title);
  });

  await t.test("cross-tenant upload geeft 404", async () => {
    const res = await uploadDocument(baseUrl, {
      productId: productA,
      cookie: adminBCookie,
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
      filename: "handleiding.pdf",
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
      filename: "handleiding.pdf",
      fields: { title: "Handleiding", category: "manual", isPublic: "true" }
    });
    assert.equal(up.status, 201);
    assert.ok(up.data.blob_name);
    assert.equal(up.data.file_size, PDF_BYTES.length);

    // Eigen (ingelogde) download
    const file = await fetch(`${baseUrl}/api/products/${productA}/documents/${up.data.id}/file`, {
      headers: { Cookie: adminACookie }
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");

    // Cross-tenant download geeft 404
    const cross = await fetch(`${baseUrl}/api/products/${productA}/documents/${up.data.id}/file`, {
      headers: { Cookie: adminBCookie }
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
      filename: "intern.pdf",
      fields: { title: "Intern document", isPublic: "false" }
    });
    assert.equal(up2.status, 201);
    const pub2 = await request(baseUrl, "GET", `/api/public/products/${publish.data.public_id}`);
    assert.ok(!pub2.data.documents.some((d) => d.id === up2.data.id));
    const hidden = await fetch(`${baseUrl}/api/public/products/${publish.data.public_id}/documents/${up2.data.id}/file`);
    assert.equal(hidden.status, 404);
  });
});
