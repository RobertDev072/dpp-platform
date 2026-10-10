const test = require("node:test");
const assert = require("node:assert/strict");
const { closePool } = require("../src/config/db");
const { startTestServer, stopTestServer, request, directUpload } = require("./helpers/testServer");
const { isStorageConfigured } = require("../src/services/storage.service");
const {
  createTestCompany,
  createTestUser,
  createTestProduct,
  cleanupTestData
} = require("./helpers/fixtures");

// Een echte upload/download tegen Supabase Storage vereist SUPABASE_URL en
// SUPABASE_SERVICE_ROLE_KEY (en de buckets uit `npm run setup:storage`). Zonder die
// configuratie wordt dat deel overgeslagen; de rest van dit bestand (schema/tenant-
// isolatie op de foto-routes) heeft geen Supabase-verbinding nodig en draait altijd.
const storageSkipReason = isStorageConfigured()
  ? false
  : "Bestandsopslag niet geconfigureerd (Supabase of S3) - zie README.md";

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
    await closePool();
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
  "productfoto: directe upload naar Supabase Storage en het media-endpoint geeft hem terug",
  { skip: storageSkipReason },
  async (t) => {
    const { server, baseUrl } = await startTestServer();

    const company = await createTestCompany("Photo Upload Company");
    const admin = await createTestUser({ companyId: company, role: "company_admin" });
    const productId = await createTestProduct({ companyId: company, name: "Upload Product" });

    t.after(async () => {
      await cleanupTestData({ companyIds: [company], userIds: [admin.id], productIds: [productId] });
      await stopTestServer(server);
      await closePool();
    });

    const cookie = await login(baseUrl, admin);

    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
      "hex"
    );
    const uploaded = await directUpload(baseUrl, {
      cookie,
      requestPath: `/api/products/${productId}/photo/upload-url`,
      completePath: `/api/products/${productId}/photo`,
      buffer: pngBytes,
      mimeType: "image/png"
    });
    assert.equal(uploaded.status, 200);
    assert.ok(uploaded.data.photo_blob_name, "server moet een objectpad teruggeven");
    assert.ok(uploaded.data.photo_blob_name.startsWith(`${company}/${productId}/`), "pad hoort bij bedrijf/product");
    assert.equal(uploaded.data.photo_url, null, "een upload vervangt een eerder geplakte externe URL");

    // Het media-endpoint stuurt door naar een kortlevende signed URL (geen streaming
    // via de function: Vercel-limiet 4,5 MB).
    const redirect = await request(baseUrl, "GET", `/api/products/${productId}/photo`, { cookie, redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.match(redirect.location, /\/storage\/v1\/object\/sign\//);

    const photoResponse = await fetch(redirect.location);
    assert.equal(photoResponse.status, 200);
    const bytesBack = Buffer.from(await photoResponse.arrayBuffer());
    assert.deepEqual(bytesBack, pngBytes, "de gestreamde bytes moeten identiek zijn aan de upload");
  }
);
