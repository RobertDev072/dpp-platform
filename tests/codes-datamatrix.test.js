const test = require("node:test");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const { decodePng, decodeSvg } = require("./helpers/qrDecode");
const { decodeDataMatrixPng } = require("./helpers/dataMatrixDecode");
const codes = require("../src/services/qrCode.service");

// Gegevensdragers: QR-code met de voorgeschreven vrije ruimte (4 modules, ISO/IEC 18004)
// en Data Matrix (ISO/IEC 16022). Elke code wordt echt teruggelezen.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

function gtin13(prefix12) {
  let sum = 0;
  const padded = prefix12.padStart(13, "0");
  for (let i = 0; i < 13; i += 1) sum += Number(padded[i]) * (i % 2 === 0 ? 3 : 1);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

test("QR: vrije ruimte van 4 modules, inhoud ongewijzigd", async () => {
  const url = "https://qr.veripasso.com/p/50CD7183-22A2-4CE5-918C-E0091BA2B2AF";
  const svg = await codes.generateQrSvgString(url);
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  // Versie n heeft 17 + 4n modules; plus 2 × 4 vrije ruimte.
  assert.equal((size - 2 * codes.QR_QUIET_ZONE_MODULES - 17) % 4, 0, `onverwachte afmeting ${size}`);
  assert.equal(decodeSvg(svg), url);
  assert.equal(decodePng(await codes.generateQrPngBuffer(url, { width: 300 })), url);
});

test("Data Matrix: leesbaar, met vrije ruimte", async () => {
  const url = "https://qr.veripasso.com/p/50CD7183-22A2-4CE5-918C-E0091BA2B2AF";
  const png = await codes.generateDataMatrixPngBuffer(url, { width: 400 });
  assert.equal(decodeDataMatrixPng(png), url);
  const svg = codes.generateDataMatrixSvgString(url);
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
});

test("Data Matrix-downloads: product, batch, item, GS1 en ZIP", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("DM A");
  const companyB = await createTestCompany("DM B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const product = await createTestProduct({ companyId: companyA, name: "Sensor Mini" });
  t.after(async () => {
    await cleanupTestData({ companyIds: [companyA, companyB], userIds: [adminA.id, adminB.id], productIds: [product] });
    await stopTestServer(server);
    await sql.close();
  });
  const cookieA = await login(baseUrl, adminA);
  const cookieB = await login(baseUrl, adminB);
  const get = (path, cookie = cookieA) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
  const gtin = gtin13(`85${String(Date.now()).slice(-10)}`);

  await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { gtin } });
  const publicId = String((await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA })).data.public_id).toUpperCase();

  await t.test("product: PNG bevat de paspoort-URL; SVG; ander bedrijf 404", async () => {
    const res = await get(`/api/products/${product}/datamatrix?format=png&size=400`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const text = decodeDataMatrixPng(Buffer.from(await res.arrayBuffer()));
    assert.ok(text.endsWith(`/p/${publicId}`), text);
    const svg = await get(`/api/products/${product}/datamatrix?download=1`);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    assert.match(svg.headers.get("content-disposition"), /datamatrix-/);
    assert.equal((await get(`/api/products/${product}/datamatrix`, cookieB)).status, 404);
  });

  await t.test("GS1-inhoud: Digital Link op het QR-domein, opent via de resolver hetzelfde paspoort", async () => {
    const res = await get(`/api/products/${product}/datamatrix?format=png&size=400&content=gs1`);
    const text = decodeDataMatrixPng(Buffer.from(await res.arrayBuffer()));
    assert.ok(text.endsWith(`/01/0${gtin}`), text);
    const resolved = await (await fetch(`${baseUrl}/api/v1/resolve?link=${encodeURIComponent(new URL(text).pathname)}`)).json();
    assert.equal(resolved.digitalProductPassportId, `urn:uuid:${publicId.toLowerCase()}`);
  });

  await t.test("item: Data Matrix met GS1-link inclusief lot en serienummer", async () => {
    const batch = (await request(baseUrl, "POST", `/api/products/${product}/batches`, { cookie: cookieA, body: { batchNumber: "B7" } })).data;
    await request(baseUrl, "POST", `/api/products/${product}/items`, { cookie: cookieA, body: { serials: ["S-1"], batchId: batch.id } });
    const item = (await request(baseUrl, "GET", `/api/products/${product}/items`, { cookie: cookieA })).data.items[0];
    const res = await get(`/api/products/${product}/items/${item.id}/qr?type=datamatrix&format=png&content=gs1`);
    const text = decodeDataMatrixPng(Buffer.from(await res.arrayBuffer()));
    assert.ok(text.endsWith(`/01/0${gtin}/10/B7/21/S-1`), text);
    const plain = await get(`/api/products/${product}/items/${item.id}/qr?format=png`);
    assert.ok(decodePng(Buffer.from(await plain.arrayBuffer())).endsWith(`/p/${String(item.public_id).toUpperCase()}`));
  });

  await t.test("ZIP-export met Data Matrix", async () => {
    const res = await fetch(`${baseUrl}/api/qr/codes.zip`, {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [product], format: "png", symbology: "datamatrix", sizePx: 400 })
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /datamatrix-codes-png/);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const [name] = Object.keys(files);
    assert.match(name, /^datamatrix-/);
    assert.ok(decodeDataMatrixPng(Buffer.from(files[name])).endsWith(`/p/${publicId}`));
  });

  await t.test("GS1 zonder geldige GTIN geeft een duidelijke fout", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { gtin: "123" } });
    const res = await get(`/api/products/${product}/datamatrix?content=gs1`);
    assert.equal(res.status, 400);
  });
});
