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

// Een echte upload/download tegen S3 draait alleen met een expliciete opt-in
// (TEST_S3_LIVE=true + AWS_REGION/S3_IMAGES_BUCKET/S3_DOCUMENTS_BUCKET van een
// TESTbucket, nooit productie). Zonder opt-in wordt dat deel overgeslagen; de rest
// van dit bestand (schema/tenant-isolatie op de foto-routes) draait altijd. De
// S3-logica zelf (presigned POST, controles) is los getest in s3-storage.test.js.
const { isStorageConfigured } = require("../src/config/storage");
const hasStorageConfigured = process.env.TEST_S3_LIVE === "true" && isStorageConfigured();
const storageSkipReason = hasStorageConfigured ? false : "TEST_S3_LIVE niet gezet - live S3-test overgeslagen (zie README.md)";

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

test("productfoto: URL-optie, tenant-isolatie en het afgeschermde photoBlobName-veld", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyA = await createTestCompany("Photo Company A");
  const companyB = await createTestCompany("Photo Company B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const productA = await createTestProduct({ companyId: companyA, name: "Product A" });

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

  await t.test("zonder foto geeft GET /:id/photo een 404", async () => {
    const res = await request(baseUrl, "GET", `/api/products/${productA}/photo`, {
      cookie: adminACookie,
      redirect: "manual"
    });
    assert.equal(res.status, 404);
  });

  await t.test("PATCH met een externe photoUrl wordt opgeslagen en GET /:id/photo redirect ernaartoe", async () => {
    const externalUrl = "https://example.com/mijn-product-foto.jpg";
    const patchRes = await request(baseUrl, "PATCH", `/api/products/${productA}`, {
      cookie: adminACookie,
      body: { photoUrl: externalUrl }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.photo_url, externalUrl);
    assert.equal(patchRes.data.photo_blob_name, null);

    const photoRes = await request(baseUrl, "GET", `/api/products/${productA}/photo`, {
      cookie: adminACookie,
      redirect: "manual"
    });
    assert.equal(photoRes.status, 302);
    assert.equal(photoRes.location, externalUrl);
  });

  await t.test(
    "photoBlobName in de PATCH-body wordt genegeerd (alleen de server mag die kolom zetten, na een echte upload)",
    async () => {
      const patchRes = await request(baseUrl, "PATCH", `/api/products/${productA}`, {
        cookie: adminACookie,
        body: { photoBlobName: "andermans-upload.jpg", brand: "Test-merk" }
      });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.data.brand, "Test-merk", "het wel-toegestane veld moet gewoon werken");
      assert.equal(
        patchRes.data.photo_blob_name,
        null,
        "photoBlobName moet door het schema gestript worden, niet in de database belanden"
      );
    }
  );

  await t.test("company_admin B krijgt 404 op de foto van product A (geen 403, lekt niet dat het bestaat)", async () => {
    const res = await request(baseUrl, "GET", `/api/products/${productA}/photo`, {
      cookie: adminBCookie,
      redirect: "manual"
    });
    assert.equal(res.status, 404);
  });

  await t.test(
    "na publiceren levert de publieke route een eigen media-endpoint als photoUrl, dat naar de externe URL redirect",
    async () => {
      const publishRes = await request(baseUrl, "POST", `/api/products/${productA}/publish`, {
        cookie: adminACookie
      });
      assert.equal(publishRes.status, 200);
      const publicId = publishRes.data.public_id;
      assert.ok(publicId);

      const publicRes = await request(baseUrl, "GET", `/api/public/products/${publicId}`, {});
      assert.equal(publicRes.status, 200);
      assert.equal(publicRes.data.photoUrl, `/api/public/products/${publicId}/photo`);

      const photoRedirect = await request(baseUrl, "GET", `/api/public/products/${publicId}/photo`, {
        redirect: "manual"
      });
      assert.equal(photoRedirect.status, 302);
      assert.equal(photoRedirect.location, "https://example.com/mijn-product-foto.jpg");
    }
  );
});

test(
  "productfoto: upload naar S3 (multipart én direct) en het media-endpoint verwijst door naar de bytes",
  { skip: storageSkipReason },
  async (t) => {
    const { server, baseUrl } = await startTestServer();

    const company = await createTestCompany("Photo Upload Company");
    const admin = await createTestUser({ companyId: company, role: "company_admin" });
    const productId = await createTestProduct({ companyId: company, name: "Upload Product" });

    t.after(async () => {
      await cleanupTestData({ companyIds: [company], userIds: [admin.id], productIds: [productId] });
      await stopTestServer(server);
      await sql.close();
    });

    const cookie = await login(baseUrl, admin);

    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
      "hex"
    );
    const formData = new FormData();
    formData.append("photo", new Blob([pngBytes], { type: "image/png" }), "test.png");

    const uploadResponse = await fetch(`${baseUrl}/api/products/${productId}/photo`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: formData
    });
    const uploaded = await uploadResponse.json();
    assert.equal(uploadResponse.status, 200);
    assert.ok(uploaded.photo_blob_name, "server moet een blobnaam teruggeven");
    assert.equal(uploaded.photo_url, null, "een upload vervangt een eerder geplakte externe URL");

    // Het media-endpoint verwijst door naar een kortlevende signed URL; fetch volgt die.
    const redirect = await request(baseUrl, "GET", `/api/products/${productId}/photo`, { cookie, redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.ok(redirect.location.includes(process.env.S3_IMAGES_BUCKET), "doorverwijzing hoort naar de S3-bucket te gaan");
    assert.ok(/X-Amz-Expires=300/.test(redirect.location), "presigned URL is maximaal 5 minuten geldig");

    const photoResponse = await fetch(`${baseUrl}/api/products/${productId}/photo`, {
      headers: { Cookie: cookie }
    });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get("content-type"), "image/png");
    const bytesBack = Buffer.from(await photoResponse.arrayBuffer());
    assert.deepEqual(bytesBack, pngBytes, "de opgehaalde bytes moeten identiek zijn aan de upload");

    // Directe upload (zoals de browser doet): upload-URL -> presigned POST -> complete.
    const init = await request(baseUrl, "POST", `/api/products/${productId}/photo/upload-url`, {
      cookie,
      body: { mimeType: "image/png", size: pngBytes.length }
    });
    assert.equal(init.status, 200);
    assert.ok(init.data.objectName.startsWith(`products/${productId}/`));

    const form = new FormData();
    for (const [key, value] of Object.entries(init.data.fields)) form.append(key, value);
    form.append("file", new Blob([pngBytes], { type: "image/png" }), "test.png");
    const put = await fetch(init.data.uploadUrl, { method: "POST", body: form });
    assert.ok(put.ok, `directe upload naar S3 moet slagen (status ${put.status})`);

    const complete = await request(baseUrl, "POST", `/api/products/${productId}/photo/complete`, {
      cookie,
      body: { objectName: init.data.objectName }
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.data.photo_blob_name, init.data.objectName);

    // Een object van een ander product kan niet "geclaimd" worden.
    const claim = await request(baseUrl, "POST", `/api/products/${productId}/photo/complete`, {
      cookie,
      body: { objectName: `products/${productId + 1}/nep.png` }
    });
    assert.equal(claim.status, 400);
  }
);
