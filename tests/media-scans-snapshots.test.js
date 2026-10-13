const test = require("node:test");
const assert = require("node:assert/strict");

// Zuinig en robuust: foto's verkleinen (origineel weg), logo en profielfoto in de
// opslag, cachebare publieke afbeeldingen, één scan per apparaat per 30 minuten,
// scans per dag samenvatten en de noodkopie van paspoorten. Opslag via een nep-client.
process.env.S3_ENDPOINT = "https://s3.test.invalid";
process.env.S3_REGION = "auto";
process.env.S3_IMAGES_BUCKET = "test-images-bucket";
process.env.S3_DOCUMENTS_BUCKET = "test-documents-bucket";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

const sharp = require("sharp");
const { S3Client } = require("@aws-sdk/client-s3");
const storage = require("../src/services/blobStorage.service");
const scanDedup = require("../src/services/scanDedup.service");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

// Nep-opslag in het geheugen: Put/Get/Head/Delete, zodat ook lezen en serveren werkt.
function memoryStore() {
  const objects = new Map();
  const calls = [];
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" }
  });
  client.send = async (command) => {
    const name = command.constructor.name;
    const { Key, Body, ContentType } = command.input;
    calls.push({ name, key: Key });
    if (name === "PutObjectCommand") {
      objects.set(Key, { body: Buffer.from(Body), type: ContentType });
      return {};
    }
    if (name === "DeleteObjectCommand") {
      objects.delete(Key);
      return {};
    }
    if (name === "GetObjectCommand" || name === "HeadObjectCommand") {
      const object = objects.get(Key);
      if (!object) {
        const error = new Error("NoSuchKey");
        error.name = "NoSuchKey";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        ContentLength: object.body.length,
        ContentType: object.type,
        Body: { transformToByteArray: async () => new Uint8Array(object.body) }
      };
    }
    return {};
  };
  return { client, objects, calls };
}

const jpeg = (width, height) => sharp({ create: { width, height, channels: 3, background: "#3366cc" } }).jpeg().toBuffer();

test("Productfoto: verkleind naar WebP ≤ 2000 px + miniatuur 800 px; origineel wordt niet bewaard", async () => {
  const store = memoryStore();
  storage.setS3ClientForTests(store.client);
  const original = await jpeg(3000, 1500);
  store.objects.set("products/7/origineel.jpg", { body: original, type: "image/jpeg" });

  const photo = await storage.processProductPhoto({ productId: 7, objectName: "products/7/origineel.jpg" });

  assert.match(photo.photoBlobName, /^products\/7\/[0-9a-f-]{36}\.webp$/);
  assert.equal(photo.photoThumbBlobName, `${photo.photoBlobName}.w800.webp`);
  assert.ok(!store.objects.has("products/7/origineel.jpg"), "origineel verwijderd");
  const main = await sharp(store.objects.get(photo.photoBlobName).body).metadata();
  const thumb = await sharp(store.objects.get(photo.photoThumbBlobName).body).metadata();
  assert.deepEqual([main.format, main.width, main.height], ["webp", 2000, 1000]);
  assert.deepEqual([thumb.format, thumb.width, thumb.height], ["webp", 800, 400]);
  assert.ok(photo.bytes < original.length, "samen kleiner dan het origineel");

  // Kleine foto's worden niet vergroot; uit een buffer (multipart) werkt ook.
  const small = await storage.processProductPhoto({ productId: 7, sourceBuffer: await jpeg(300, 200) });
  assert.equal((await sharp(store.objects.get(small.photoBlobName).body).metadata()).width, 300);
});

test("Productfoto: geen geldige afbeelding = nette fout (400) en het upload-object wordt opgeruimd", async () => {
  const store = memoryStore();
  storage.setS3ClientForTests(store.client);
  store.objects.set("products/7/kapot.jpg", { body: Buffer.from("geen afbeelding"), type: "image/jpeg" });
  await assert.rejects(storage.processProductPhoto({ productId: 7, objectName: "products/7/kapot.jpg" }), (error) => error.statusCode === 400);
  assert.ok(!store.objects.has("products/7/kapot.jpg"));
  assert.equal([...store.objects.keys()].length, 0, "niets weggeschreven");
});

test("Limieten: foto 15 MB, document 25 MB", () => {
  assert.equal(storage.PHOTO_MAX_MB, 15);
  assert.equal(storage.DOCUMENT_MAX_MB, 25);
});

test("Scans: één per apparaat per paspoort per 30 minuten", () => {
  scanDedup.resetForTests();
  const t0 = Date.parse("2026-10-14T10:00:00Z");
  const scan = { publicId: "0f8fad5b-d9cb-469f-a165-70867728950e", ip: "203.0.113.5", userAgent: "Telefoon" };
  assert.equal(scanDedup.shouldCount(scan, t0), true);
  assert.equal(scanDedup.shouldCount(scan, t0 + 5_000), false, "refresh");
  assert.equal(scanDedup.shouldCount({ ...scan, publicId: scan.publicId.toUpperCase() }, t0 + 6_000), false, "hoofdletter-ID = zelfde paspoort");
  assert.equal(scanDedup.shouldCount({ ...scan, userAgent: "Ander toestel" }, t0 + 7_000), true, "ander apparaat");
  assert.equal(scanDedup.shouldCount({ ...scan, publicId: "1f8fad5b-d9cb-469f-a165-70867728950e" }, t0 + 8_000), true, "ander paspoort");
  assert.equal(scanDedup.shouldCount(scan, t0 + 31 * 60_000), true, "na 30 minuten weer");
});

test("App: foto's, logo's, profielfoto, scans samenvatten en noodkopie", async (t) => {
  const store = memoryStore();
  storage.setS3ClientForTests(store.client);
  const { server, baseUrl } = await startTestServer();
  const company = await createTestCompany("Media A");
  const other = await createTestCompany("Media B");
  const admin = await createTestUser({ companyId: company, role: "company_admin" });
  const outsider = await createTestUser({ companyId: other, role: "company_admin" });
  const product = await createTestProduct({ companyId: company, name: "Media <Product> & co" });
  const pool = await getPool();

  t.after(async () => {
    await pool.query("DELETE FROM dbo.scandaily WHERE product_id = $1", [product]);
    await pool.query("DELETE FROM dbo.passportsnapshots WHERE product_id = $1", [product]);
    await cleanupTestData({ companyIds: [company, other], userIds: [admin.id, outsider.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });

  const login = async (user) => (await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } })).cookie;
  const cookie = await login(admin);
  const cookieOther = await login(outsider);
  const publicId = String((await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie })).data.public_id);

  await t.test("logo: naar de opslag als WebP; de app krijgt een URL, nooit de afbeelding", async () => {
    const png = await sharp({ create: { width: 600, height: 300, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const patched = await request(baseUrl, "PATCH", "/api/company", { cookie, body: { logo: `data:image/png;base64,${png.toString("base64")}` } });
    assert.equal(patched.status, 200);
    const row = (await pool.query("SELECT logo, logo_blob_name FROM dbo.companies WHERE id = $1", [company])).rows[0];
    assert.equal(row.logo, null, "geen data-URI meer in de database");
    assert.match(row.logo_blob_name, new RegExp(`^companies/${company}/[0-9a-f-]{36}\\.webp$`));
    assert.equal((await sharp(store.objects.get(row.logo_blob_name).body).metadata()).width, 256);

    const own = await request(baseUrl, "GET", "/api/company", { cookie });
    assert.match(own.data.logo, new RegExp(`^/api/media/logos/${company}\\?v=[0-9a-f]{10}$`));
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie });
    assert.equal(me.data.companyLogo, own.data.logo);

    const image = await fetch(`${baseUrl}${own.data.logo}`, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.match(image.headers.get("cache-control"), /max-age=31536000, immutable/);
    assert.equal((await fetch(`${baseUrl}${own.data.logo}`, { headers: { Cookie: cookieOther } })).status, 404, "ander bedrijf");

    const view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.match(view.data.issuer.logo, /\/logo\?v=[0-9a-f]{10}$/);
    const publicLogo = await fetch(`${baseUrl}${view.data.issuer.logo}`);
    assert.equal(publicLogo.status, 200);
    assert.match(publicLogo.headers.get("cache-control"), /public, max-age=31536000, immutable/);
  });

  await t.test("productfoto: publieke URL met versie, miniatuur rechtstreeks uit de opslag, een jaar cachebaar", async () => {
    const upload = await request(baseUrl, "POST", `/api/products/${product}/photo/upload-url`, { cookie, body: { mimeType: "image/jpeg", size: 1000 } });
    assert.equal(upload.status, 200);
    store.objects.set(upload.data.objectName, { body: await jpeg(2400, 1800), type: "image/jpeg" });
    const done = await request(baseUrl, "POST", `/api/products/${product}/photo/complete`, { cookie, body: { objectName: upload.data.objectName } });
    assert.equal(done.status, 200);
    assert.ok(!store.objects.has(upload.data.objectName), "origineel weg");

    const view = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.match(view.data.photoUrl, /\/photo\?v=[0-9a-f]{10}$/);
    const photo = await fetch(`${baseUrl}${view.data.photoUrl}`);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get("cache-control"), /immutable/);
    assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width, 800, "miniatuur");
    const large = await fetch(`${baseUrl}${view.data.photoUrl}&size=large`);
    assert.equal((await sharp(Buffer.from(await large.arrayBuffer())).metadata()).width, 2000);
    const stale = await fetch(`${baseUrl}/api/public/products/${publicId}/photo?v=oud`);
    assert.match(stale.headers.get("cache-control"), /max-age=300/, "oude versie: kort bewaren");
  });

  await t.test("profielfoto: 256 px WebP, zichtbaar voor jezelf, niet voor een ander bedrijf; verwijderen", async () => {
    const form = new FormData();
    form.append("photo", new Blob([await jpeg(1200, 900)], { type: "image/jpeg" }), "ik.jpg");
    const res = await fetch(`${baseUrl}/api/media/avatar`, { method: "POST", headers: { Cookie: cookie }, body: form });
    assert.equal(res.status, 200);
    const { avatarUrl } = await res.json();
    assert.match(avatarUrl, new RegExp(`^/api/media/avatars/${admin.id}\\?v=[0-9a-f]{10}$`));
    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie })).data.avatarUrl, avatarUrl);
    const image = await fetch(`${baseUrl}${avatarUrl}`, { headers: { Cookie: cookie } });
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 256);
    assert.equal((await fetch(`${baseUrl}${avatarUrl}`, { headers: { Cookie: cookieOther } })).status, 404);
    assert.equal((await fetch(`${baseUrl}${avatarUrl}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/media/avatar`, { method: "DELETE", headers: { Cookie: cookie } })).status, 204);
    assert.equal((await request(baseUrl, "GET", "/api/auth/me", { cookie })).data.avatarUrl, null);
  });

  await t.test("scans samenvatten: totalen blijven gelijk, losse regels ouder dan 90 dagen verdwijnen", async () => {
    const insert = (daysAgo, n) =>
      pool.query(
        "INSERT INTO dbo.scanevents (product_id, scanned_at) SELECT $1, now() - make_interval(days => $2::int) FROM generate_series(1, $3)",
        [product, daysAgo, n]
      );
    await pool.query("DELETE FROM dbo.scanevents WHERE product_id = $1", [product]);
    // Samenvattingspunt terug (een eerdere testrun kan het al verschoven hebben); in
    // productie schuift het alleen vooruit en komen scans hooguit 2 dagen te laat binnen.
    await pool.query("UPDATE dbo.scanrollup SET rolled_up_through = (now() AT TIME ZONE 'UTC')::date - 150 WHERE id = 1");
    await insert(120, 4);
    await insert(10, 3);
    await insert(0, 2);
    const scans = require("../src/repositories/scanEvents.repository");
    const before = await scans.getScanSummary(company);
    assert.equal(before.total, 9);

    const result = await require("../src/services/scanRollup.service").rollupScans();
    assert.ok(result.deletedRawScans >= 4);
    const raw = Number((await pool.query("SELECT COUNT(*) FROM dbo.scanevents WHERE product_id = $1", [product])).rows[0].count);
    assert.equal(raw, 5, "alleen de losse regels van 120 dagen geleden zijn weg");
    const daily = (await pool.query("SELECT SUM(scans)::int AS n FROM dbo.scandaily WHERE product_id = $1", [product])).rows[0].n;
    assert.equal(daily, 7, "120 en 10 dagen geleden staan in de dagtotalen");

    const after = await scans.getScanSummary(company);
    assert.deepEqual(after, before, "statistieken ongewijzigd");
    assert.equal(after.today, 2);
    assert.equal(after.last30Days, 5);
    assert.equal((await scans.listTopScannedProducts(company, { days: 365 }))[0].scans, 9);
  });

  await t.test("noodkopie: zelfstandige HTML + JSON in de opslag, opnieuw alleen bij wijziging, weg na intrekken", async () => {
    const snapshots = require("../src/services/passportSnapshot.service");
    const html = `passport-snapshots/${publicId.toLowerCase()}.html`;
    const json = `passport-snapshots/${publicId.toLowerCase()}.json`;
    assert.equal(await snapshots.writeSnapshot(publicId), "written");
    const page = store.objects.get(html).body.toString("utf8");
    assert.match(page, /Media &lt;Product&gt; &amp; co/, "tekst is ge-escaped");
    assert.ok(!/<script/i.test(page), "geen JavaScript");
    assert.match(page, /data:image\/webp;base64,/, "foto en logo zitten erin");
    assert.match(page, /bewaarde kopie/);
    assert.equal(JSON.parse(store.objects.get(json).body.toString("utf8")).identifiers.passportId.toLowerCase(), publicId.toLowerCase());

    assert.equal(await snapshots.writeSnapshot(publicId), "unchanged");
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie, body: { description: "Nieuwe omschrijving" } });
    assert.equal(await snapshots.writeSnapshot(publicId), "written");
    assert.match(store.objects.get(html).body.toString("utf8"), /Nieuwe omschrijving/);

    // De wachtrij: een wijziging zet het paspoort erin; processSnapshots werkt hem af.
    const queued = Number((await pool.query("SELECT COUNT(*) FROM dbo.passportsnapshotqueue WHERE public_id = $1", [publicId.toLowerCase()])).rows[0].count);
    assert.ok(queued >= 1, "wijziging staat in de wachtrij");
    const outcome = await snapshots.processSnapshots({ limit: 50 });
    assert.equal(outcome.failed, 0);

    await pool.query("UPDATE dbo.products SET status = 'draft' WHERE id = $1", [product]);
    assert.equal(await snapshots.writeSnapshot(publicId), "removed");
    assert.ok(!store.objects.has(html) && !store.objects.has(json));
  });
});
