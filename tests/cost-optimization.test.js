const test = require("node:test");
const assert = require("node:assert/strict");

// Kostenbesparing (hosting op Lambda, caching via CloudFront): miniatuurfoto's, het
// cachebare bedrijfslogo, foto's via het CDN-pad, interne taken en de afscherming van
// de Function URL. Alles zonder AWS: S3 via een nep-client.
process.env.AWS_REGION = "eu-west-1";
process.env.S3_IMAGES_BUCKET = "test-images-bucket";
process.env.S3_DOCUMENTS_BUCKET = "test-documents-bucket";
process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const sharp = require("sharp");
const { S3Client } = require("@aws-sdk/client-s3");
const storage = require("../src/services/blobStorage.service");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

function fakeClient() {
  const client = new S3Client({ region: "eu-west-1" });
  const calls = [];
  client.send = async (command) => {
    calls.push(command);
    return {};
  };
  return { client, calls };
}

// 1x1 PNG (rood), als data-URI zoals bedrijfslogo's worden opgeslagen.
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64"
);

test("Miniatuur: productfoto wordt een WebP van max. 800 px breed naast het origineel", async () => {
  const fake = fakeClient();
  storage.setS3ClientForTests(fake.client);
  const original = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#3366cc" } }).jpeg().toBuffer();

  const thumbName = await storage.createPhotoThumbnail("products/7/abc.jpg", { sourceBuffer: original });

  assert.equal(thumbName, "products/7/abc.jpg.w800.webp");
  const put = fake.calls.find((c) => c.constructor.name === "PutObjectCommand");
  assert.ok(put, "miniatuur is opgeslagen");
  assert.equal(put.input.Bucket, "test-images-bucket");
  assert.equal(put.input.Key, thumbName);
  assert.equal(put.input.ContentType, "image/webp");
  assert.equal(put.input.IfNoneMatch, "*", "bestaande objecten worden nooit overschreven");
  const meta = await sharp(put.input.Body).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 400);
  assert.ok(put.input.Body.length < original.length, "kleiner dan het origineel");

  const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#fff" } }).png().toBuffer();
  fake.calls.length = 0;
  await storage.createPhotoThumbnail("products/7/klein.png", { sourceBuffer: small });
  const smallMeta = await sharp(fake.calls[0].input.Body).metadata();
  assert.equal(smallMeta.width, 300, "kleine foto's worden niet vergroot");
});

test("Miniatuur: geen geldige afbeelding geeft een fout en schrijft niets weg", async () => {
  const fake = fakeClient();
  storage.setS3ClientForTests(fake.client);
  await assert.rejects(storage.createPhotoThumbnail("products/7/kapot.jpg", { sourceBuffer: Buffer.from("geen afbeelding") }));
  assert.equal(fake.calls.length, 0);
});

test("Publiek paspoort: logo als cachebare afbeelding, foto via CDN-pad, interne taken afgeschermd", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("Kosten A");
  const bare = await createTestCompany("Kosten B");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const adminBare = await createTestUser({ companyId: bare, role: "company_admin" });
  const product = await createTestProduct({ companyId: company, name: "Kosten Product" });
  const productBare = await createTestProduct({ companyId: bare, name: "Zonder Logo" });
  const pool = await getPool();
  const savedEnv = { cdn: process.env.PUBLIC_MEDIA_FROM_CDN, internal: process.env.INTERNAL_EVENTS_ENABLED };

  t.after(async () => {
    process.env.PUBLIC_MEDIA_FROM_CDN = savedEnv.cdn ?? "";
    process.env.INTERNAL_EVENTS_ENABLED = savedEnv.internal ?? "";
    await cleanupTestData({ companyIds: [company, bare], userIds: [admin.id, adminBare.id], productIds: [product, productBare] });
    await stopTestServer(server);
    await sql.close();
  });

  await pool.query("UPDATE dbo.companies SET logo = $1 WHERE id = $2", [`data:image/png;base64,${LOGO_PNG.toString("base64")}`, company]);
  const login = async (user) => (await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } })).cookie;
  const publicId = String((await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: await login(admin) })).data.public_id);
  const publicIdBare = String((await request(baseUrl, "POST", `/api/products/${productBare}/publish`, { cookie: await login(adminBare) })).data.public_id);

  await t.test("logo: echte PNG met lange cache en ETag/304; geen inline base64 in de paspoortdata", async () => {
    const view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(view.status, 200);
    assert.equal(view.data.issuer.logo, `/api/public/products/${publicId}/logo`);
    assert.ok(!JSON.stringify(view.data).includes("data:image"), "geen data-URI in de paspoortdata");

    const logo = await fetch(`${baseUrl}/api/public/products/${publicId}/logo`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.match(logo.headers.get("cache-control"), /public, max-age=86400/);
    assert.deepEqual(Buffer.from(await logo.arrayBuffer()), LOGO_PNG);

    const again = await fetch(`${baseUrl}/api/public/products/${publicId}/logo`, { headers: { "If-None-Match": logo.headers.get("etag") } });
    assert.equal(again.status, 304);

    const noLogo = await request(baseUrl, "GET", `/api/public/products/${publicIdBare}`);
    assert.equal(noLogo.data.issuer.logo, null);
    assert.equal((await fetch(`${baseUrl}/api/public/products/${publicIdBare}/logo`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/public/products/0f8fad5b-d9cb-469f-a165-70867728950e/logo`)).status, 404);
  });

  await t.test("foto: miniatuur via het CDN-pad als dat aan staat, anders via de API-route", async () => {
    await pool.query("UPDATE dbo.products SET photo_blob_name = $1, photo_thumb_blob_name = $2 WHERE id = $3", [
      `products/${product}/foto.jpg`,
      `products/${product}/foto.jpg.w800.webp`,
      product
    ]);

    process.env.PUBLIC_MEDIA_FROM_CDN = "";
    let view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(view.data.photoUrl, `/api/public/products/${publicId}/photo`);

    process.env.PUBLIC_MEDIA_FROM_CDN = "true";
    view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(view.data.photoUrl, `/products/${product}/foto.jpg.w800.webp`);

    // Zonder miniatuur (oude foto's): het origineel via hetzelfde CDN-pad.
    await pool.query("UPDATE dbo.products SET photo_thumb_blob_name = NULL WHERE id = $1", [product]);
    view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(view.data.photoUrl, `/products/${product}/foto.jpg`);

    view = await request(baseUrl, "GET", `/api/public/products/${publicIdBare}`);
    assert.equal(view.data.photoUrl, null, "geen foto, geen URL");
  });

  await t.test("interne taken: uit buiten Lambda, en nooit via een HTTP-verzoek van buiten", async () => {
    process.env.INTERNAL_EVENTS_ENABLED = "";
    assert.equal((await request(baseUrl, "POST", "/api/internal/events", { body: { task: "migrate" } })).status, 404);

    process.env.INTERNAL_EVENTS_ENABLED = "true";
    const viaUrl = await fetch(`${baseUrl}/api/internal/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-amzn-request-context": "{}" },
      body: JSON.stringify({ task: "migrate" })
    });
    assert.equal(viaUrl.status, 404, "verzoek via de Function URL wordt geweigerd");

    // Directe aanroep (uitrol-workflow, EventBridge): de adapter zet de header op "null".
    const direct = await fetch(`${baseUrl}/api/internal/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-amzn-request-context": "null" },
      body: JSON.stringify({ task: "migrate" })
    });
    assert.equal(direct.status, 200, "directe Lambda-aanroep wordt doorgelaten");

    assert.equal((await request(baseUrl, "POST", "/api/internal/events", { body: { task: "onbekend" } })).status, 400);

    const migrate = await request(baseUrl, "POST", "/api/internal/events", { body: { task: "migrate" } });
    assert.equal(migrate.status, 200);
    assert.equal(migrate.data.task, "migrate");
    assert.equal(migrate.data.result.applied.length, 0, "testdatabase is al bijgewerkt");
  });
});

test("Function URL: zonder juiste X-Origin-Verify geeft de proxy 403, via CloudFront mag het", async () => {
  const { proxy } = await import("../proxy.js");
  const saved = process.env.ORIGIN_VERIFY_SECRET;
  try {
    process.env.ORIGIN_VERIFY_SECRET = "geheim-van-test";
    const lambda = (headers) => new Request("https://abc.lambda-url.eu-west-1.on.aws/p/1", { headers: { "x-amzn-request-context": "{}", ...headers } });

    assert.equal(proxy(lambda({})).status, 403, "rechtstreeks naar de Function URL");
    assert.equal(proxy(lambda({ "x-origin-verify": "fout" })).status, 403);
    assert.notEqual(proxy(lambda({ "x-origin-verify": "geheim-van-test" })).status, 403, "via CloudFront");
    assert.notEqual(proxy(new Request("http://localhost:3000/p/1")).status, 403, "lokaal (geen Lambda) ongemoeid");
    const direct = new Request("http://127.0.0.1:3000/api/internal/events", { method: "POST", headers: { "x-amzn-request-context": "null" } });
    assert.notEqual(proxy(direct).status, 403, "directe Lambda-aanroep (migraties) ongemoeid");
    assert.equal(proxy(lambda({ "x-amzn-request-context": "kapot{" })).status, 403, "onbekende vorm: behandelen als van buiten");

    delete process.env.ORIGIN_VERIFY_SECRET;
    assert.notEqual(proxy(lambda({})).status, 403, "zonder geheim (lokaal/CI) geen controle");
  } finally {
    if (saved === undefined) delete process.env.ORIGIN_VERIFY_SECRET;
    else process.env.ORIGIN_VERIFY_SECRET = saved;
  }
});
