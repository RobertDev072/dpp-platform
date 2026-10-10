const test = require("node:test");
const assert = require("node:assert/strict");

// S3-opslag zonder netwerk: presigned URL's worden lokaal berekend (met nep-
// credentials), Head/Delete gaan via een nep-client. Zo zijn de veiligheidsregels
// (sleutel, type, grootte, verloop, tenant) altijd getest, ook zonder AWS-account.
process.env.AWS_REGION = "eu-west-1";
process.env.S3_IMAGES_BUCKET = "test-images-bucket";
process.env.S3_DOCUMENTS_BUCKET = "test-documents-bucket";
process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const { S3Client } = require("@aws-sdk/client-s3");
const storage = require("../src/services/blobStorage.service");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

// Echte S3Client (voor het presignen), maar send() onderschept: geen netwerk.
function fakeClient({ head } = {}) {
  const client = new S3Client({ region: "eu-west-1" });
  const calls = [];
  client.send = async (command) => {
    calls.push(command);
    const name = command.constructor.name;
    if (name === "HeadObjectCommand") {
      if (!head) {
        const error = new Error("NotFound");
        error.name = "NotFound";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return head;
    }
    return {};
  };
  return { client, calls };
}

function decodePolicy(fields) {
  return JSON.parse(Buffer.from(fields.Policy, "base64").toString("utf8"));
}

test("S3: presigned POST dwingt sleutel, Content-Type, maximale grootte en verloop af", async () => {
  storage.setS3ClientForTests(fakeClient().client);
  const upload = await storage.createDocumentUpload({ productId: 42, mimeType: "application/pdf", size: 1234 });

  assert.equal(upload.method, "POST");
  assert.match(upload.objectName, /^products\/42\/[0-9a-f-]{36}\.pdf$/);
  assert.ok(upload.uploadUrl.includes("test-documents-bucket"));
  assert.equal(upload.fields.key, upload.objectName);
  assert.equal(upload.fields["Content-Type"], "application/pdf");

  const policy = decodePolicy(upload.fields);
  const conditions = JSON.stringify(policy.conditions);
  assert.ok(conditions.includes('["content-length-range",1,10485760]'), "max. 10 MB in de policy");
  assert.ok(conditions.includes('["eq","$Content-Type","application/pdf"]'), "exact dit type");
  assert.ok(conditions.includes(`{"key":"${upload.objectName}"}`), "exact deze sleutel");
  const expiresInMs = new Date(policy.expiration).getTime() - Date.now();
  assert.ok(expiresInMs > 0 && expiresInMs <= 300 * 1000 + 5000, "policy verloopt binnen 5 minuten");
});

test("S3: verkeerd type of te groot bestand krijgt geen upload-URL", async () => {
  storage.setS3ClientForTests(fakeClient().client);
  await assert.rejects(storage.createPhotoUpload({ productId: 1, mimeType: "application/x-msdownload", size: 10 }), /Alleen JPEG/);
  await assert.rejects(storage.createPhotoUpload({ productId: 1, mimeType: "image/png", size: 6 * 1024 * 1024 }), /te groot/);
  await assert.rejects(storage.createDocumentUpload({ productId: 1, mimeType: "application/pdf", size: 0 }), /te groot/);
});

test("S3: na een directe upload worden sleutel, type en grootte gecontroleerd; afwijkingen worden verwijderd", async () => {
  // Sleutel van een ander product of met path traversal: geweigerd zonder S3-aanroep.
  const { client: c1, calls: calls1 } = fakeClient();
  storage.setS3ClientForTests(c1);
  await assert.rejects(storage.verifyUploadedPhoto({ objectName: "products/7/0f8fad5b-d9cb-469f-a165-70867728950e.png", productId: 8 }), /Onbekende upload/);
  await assert.rejects(storage.verifyUploadedPhoto({ objectName: "products/8/../7/x.png", productId: 8 }), /Onbekende upload/);
  assert.equal(calls1.length, 0);

  // Bestaat niet (upload nooit afgerond).
  await assert.rejects(
    storage.verifyUploadedPhoto({ objectName: "products/8/0f8fad5b-d9cb-469f-a165-70867728950e.png", productId: 8 }),
    /niet \(volledig\) geüpload/
  );

  // Verkeerd type in S3: geweigerd én verwijderd.
  const { client: c2, calls: calls2 } = fakeClient({ head: { ContentLength: 100, ContentType: "text/html" } });
  storage.setS3ClientForTests(c2);
  await assert.rejects(
    storage.verifyUploadedPhoto({ objectName: "products/8/0f8fad5b-d9cb-469f-a165-70867728950e.png", productId: 8 }),
    /voldoet niet/
  );
  assert.ok(calls2.some((c) => c.constructor.name === "DeleteObjectCommand"), "ongeldig object wordt opgeruimd");

  // Correct object.
  const { client: c3 } = fakeClient({ head: { ContentLength: 2048, ContentType: "image/png" } });
  storage.setS3ClientForTests(c3);
  const ok = await storage.verifyUploadedPhoto({ objectName: "products/8/0f8fad5b-d9cb-469f-a165-70867728950e.png", productId: 8 });
  assert.deepEqual(ok, { size: 2048, mimeType: "image/png" });
});

test("S3: downloadlinks zijn kortlevend; SVG nooit inline", async () => {
  storage.setS3ClientForTests(fakeClient().client);
  const pdf = await storage.getProductDocumentUrl("products/3/0f8fad5b-d9cb-469f-a165-70867728950e.pdf");
  assert.match(pdf, /X-Amz-Expires=300/);
  assert.ok(pdf.includes("test-documents-bucket"));
  assert.ok(!/response-content-disposition/i.test(pdf));
  const svg = await storage.getProductDocumentUrl("products/3/0f8fad5b-d9cb-469f-a165-70867728950e.svg");
  assert.match(svg, /response-content-disposition=attachment/i);
});

test("S3: upload-URL alleen voor producten van het eigen bedrijf (tenant-isolatie)", async (t) => {
  storage.setS3ClientForTests(fakeClient().client);
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("S3 Tenant A");
  const companyB = await createTestCompany("S3 Tenant B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const productA = await createTestProduct({ companyId: companyA });

  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id], productIds: [productA] });
    await stopTestServer(server);
    await sql.close();
  });

  const loginB = await request(baseUrl, "POST", "/api/auth/login", { body: { email: adminB.email, password: adminB.password } });
  const loginA = await request(baseUrl, "POST", "/api/auth/login", { body: { email: adminA.email, password: adminA.password } });

  const foreign = await request(baseUrl, "POST", `/api/products/${productA}/documents/upload-url`, {
    cookie: loginB.cookie,
    body: { mimeType: "application/pdf", size: 100, title: "x", type: "manual" }
  });
  assert.equal(foreign.status, 404, "bedrijf B krijgt geen upload-URL voor een product van bedrijf A");

  const own = await request(baseUrl, "POST", `/api/products/${productA}/photo/upload-url`, {
    cookie: loginA.cookie,
    body: { mimeType: "image/png", size: 100 }
  });
  assert.equal(own.status, 200);
  assert.ok(own.data.objectName.startsWith(`products/${productA}/`));

  const anonymous = await request(baseUrl, "POST", `/api/products/${productA}/photo/upload-url`, {
    body: { mimeType: "image/png", size: 100 }
  });
  assert.equal(anonymous.status, 401);
});
