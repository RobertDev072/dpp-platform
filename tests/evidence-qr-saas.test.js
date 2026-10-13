const test = require("node:test");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const { decodePng, decodeSvg } = require("./helpers/qrDecode");

// Bewijstests voor docs/verification/evidence-matrix.md. Elke test hoort bij een regel
// in die matrix (ID tussen haakjes). QR-codes worden echt teruggelezen (jsQR), niet
// alleen op "er komt een afbeelding terug" gecontroleerd.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200, `login ${user.email}`);
  return res.cookie;
}

async function getBinary(baseUrl, path, cookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, type: res.headers.get("content-type"), headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function postBinary(baseUrl, path, cookie, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
}

test("Bewijs: QR, publieke pagina, documenten, scans, isolatie, uitnodigingen", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("Evidence A");
  const companyB = await createTestCompany("Evidence B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const owner = await createTestUser({ companyId: null, role: "platform_owner" });
  const product = await createTestProduct({ companyId: companyA, name: "Bewijs Product" });
  const extraUserIds = [];

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [adminA.id, adminB.id, owner.id, ...extraUserIds],
      productIds: [product]
    });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieB = await login(baseUrl, adminB);
  const cookieOwner = await login(baseUrl, owner);

  const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA });
  assert.equal(published.status, 200);
  const publicId = String(published.data.public_id);
  const expectedSuffix = `/p/${publicId.toUpperCase()}`;
  let qrUrl;

  await t.test("QR-01: de gedownloade QR-code (PNG, SVG, print-PNG) is scanbaar en bevat de paspoort-URL", async () => {
    const png = await getBinary(baseUrl, `/api/products/${product}/qr.png`, cookieA);
    assert.equal(png.status, 200);
    assert.equal(png.type, "image/png");
    qrUrl = decodePng(png.buffer);
    assert.ok(qrUrl, "PNG is scanbaar");
    assert.ok(qrUrl.endsWith(expectedSuffix), `QR bevat ${expectedSuffix} (gelezen: ${qrUrl})`);
    assert.match(qrUrl, /^https?:\/\//);

    const big = await getBinary(baseUrl, `/api/products/${product}/qr.png?size=1200&download=1`, cookieA);
    assert.equal(decodePng(big.buffer), qrUrl, "print-PNG (1200 px) bevat dezelfde URL");
    assert.match(big.headers.get("content-disposition") || "", /attachment/);

    const svg = await getBinary(baseUrl, `/api/products/${product}/qr.svg`, cookieA);
    assert.equal(svg.status, 200);
    assert.equal(decodeSvg(svg.buffer.toString("utf8")), qrUrl, "SVG is scanbaar met dezelfde URL");

    // Labels printen is verwijderd: de route bestaat niet meer.
    assert.equal((await getBinary(baseUrl, `/api/products/${product}/qr-label.pdf`, cookieA)).status, 404);
  });

  await t.test("QR-02: de URL in de QR-code opent het publieke paspoort (hoofdletter-GUID)", async () => {
    const path = new URL(qrUrl).pathname; // /p/<ID>
    const id = path.split("/").pop();
    const page = await request(baseUrl, "GET", `/api/public/products/${id}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.name, published.data.name);
  });

  await t.test("QR-03: QR-code en paspoort blijven ongewijzigd na alle soorten productwijzigingen", async () => {
    const steps = [
      ["PATCH", `/api/products/${product}`, { name: "Nieuwe naam", brand: "Merk X", sku: "SKU-EVID-1", gtin: "08712345678906" }],
      ["PATCH", `/api/products/${product}`, { description: "Nieuwe beschrijving", categoryLabel: "Testcategorie" }],
      ["PUT", `/api/products/${product}/sustainability`, { recycledMaterialPct: 55, recyclable: true }],
      ["PUT", `/api/products/${product}/compliance`, { ceMarked: true, applicableRegulations: ["EU 2024/1781"] }],
      ["POST", `/api/products/${product}/documents`, { type: "manual", title: "Handleiding", storageUrl: "https://example.com/handleiding.pdf", isPublic: true }],
      ["DELETE", `/api/products/${product}`, undefined]
    ];
    for (const [method, path, body] of steps) {
      const res = await request(baseUrl, method, path, { cookie: cookieA, body });
      assert.ok(res.status >= 200 && res.status < 300, `${method} ${path} → ${res.status}`);
      const current = await request(baseUrl, "GET", `/api/products/${product}`, { cookie: cookieA });
      assert.equal(String(current.data.public_id), publicId, `public_id ongewijzigd na ${method} ${path}`);
      const png = await getBinary(baseUrl, `/api/products/${product}/qr.png`, cookieA);
      assert.equal(decodePng(png.buffer), qrUrl, `QR-inhoud ongewijzigd na ${method} ${path}`);
      const pub = await request(baseUrl, "GET", new URL(qrUrl).pathname.replace("/p/", "/api/public/products/"));
      assert.equal(pub.status, 200, `paspoort bereikbaar na ${method} ${path}`);
    }
    const final = await request(baseUrl, "GET", `/api/public/products/${publicId}`);
    assert.equal(final.data.name, "Nieuwe naam", "paspoort toont de actuele gegevens");
    assert.equal(final.data.archived, true, "gearchiveerd product blijft publiek met melding");
  });

  await t.test("PUB-01: onbekende, kapotte en niet-gepubliceerde codes geven 404 (geen serverfout)", async () => {
    const draft = await createTestProduct({ companyId: companyA, name: "Concept" });
    const reserved = await request(baseUrl, "POST", `/api/products/${draft}/qr`, { cookie: cookieA });
    assert.equal(reserved.status, 200);
    assert.equal((await request(baseUrl, "GET", `/api/public/products/${reserved.data.public_id}`)).status, 404);
    assert.equal((await request(baseUrl, "GET", "/api/public/products/0f8fad5b-d9cb-469f-a165-70867728950e")).status, 404);
    assert.equal((await request(baseUrl, "GET", "/api/public/products/<script>")).status, 404);
  });

  await t.test("DOC-01: alleen openbare documenten zijn publiek zichtbaar en downloadbaar; privé blijft afgeschermd", async () => {
    const p2 = await createTestProduct({ companyId: companyA, name: "Docs Product" });
    const pub = await request(baseUrl, "POST", `/api/products/${p2}/documents`, {
      cookie: cookieA,
      body: { type: "certificate", title: "Openbaar certificaat", storageUrl: "https://example.com/cert.pdf", isPublic: true, category: "certificate" }
    });
    const priv = await request(baseUrl, "POST", `/api/products/${p2}/documents`, {
      cookie: cookieA,
      body: { type: "manual", title: "Interne handleiding", storageUrl: "https://example.com/intern.pdf", isPublic: false }
    });
    assert.equal(pub.status, 201);
    assert.equal(priv.status, 201);
    const published2 = await request(baseUrl, "POST", `/api/products/${p2}/publish`, { cookie: cookieA });
    const id2 = published2.data.public_id;

    const page = await request(baseUrl, "GET", `/api/public/products/${id2}`);
    const titles = page.data.documents.map((d) => d.title);
    assert.deepEqual(titles, ["Openbaar certificaat"], "alleen het openbare document staat op het paspoort");

    const open = await request(baseUrl, "GET", `/api/public/products/${id2}/documents/${pub.data.id}/file`, { redirect: "manual" });
    assert.equal(open.status, 302);
    assert.equal(open.location, "https://example.com/cert.pdf");
    const closed = await request(baseUrl, "GET", `/api/public/products/${id2}/documents/${priv.data.id}/file`, { redirect: "manual" });
    assert.equal(closed.status, 404, "privé-document is publiek niet op te vragen");

    // Openbaar → privé zetten haalt het direct van het paspoort.
    const toPrivate = await request(baseUrl, "PATCH", `/api/products/${p2}/documents/${pub.data.id}`, { cookie: cookieA, body: { isPublic: false } });
    assert.equal(toPrivate.status, 200);
    assert.equal((await request(baseUrl, "GET", `/api/public/products/${id2}`)).data.documents.length, 0);
    assert.equal(
      (await request(baseUrl, "GET", `/api/public/products/${id2}/documents/${pub.data.id}/file`, { redirect: "manual" })).status,
      404
    );

    // Een ander bedrijf kan de documentenlijst niet zien.
    assert.equal((await request(baseUrl, "GET", `/api/products/${p2}/documents`, { cookie: cookieB })).status, 404);
  });

  await t.test("SCAN-01: één scan per apparaat per paspoort per 30 minuten (refresh telt niet), per bedrijf gescheiden; concepten tellen niet", async () => {
    const p3 = await createTestProduct({ companyId: companyA, name: "Scan Product" });
    const pub3 = await request(baseUrl, "POST", `/api/products/${p3}/publish`, { cookie: cookieA });
    const pool = await getPool();
    const count = async () =>
      Number((await pool.query("SELECT COUNT(*)::int AS n FROM dbo.scanevents WHERE product_id = $1", [p3])).rows[0].n);
    const beacon = (ua) => fetch(`${baseUrl}/api/scan/${pub3.data.public_id}`, { method: "POST", headers: { "User-Agent": ua } });

    const before = await count();
    // De pagina zelf is cachebaar (CDN); het ophalen van de gegevens telt dus niet,
    // de beacon die de browser stuurt wel.
    assert.equal((await request(baseUrl, "GET", `/api/public/products/${pub3.data.public_id}`)).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await count(), before, "ophalen van gegevens telt niet als scan");

    for (let i = 0; i < 5; i++) assert.equal((await beacon("Telefoon-A")).status, 204);
    assert.equal(await count(), before + 1, "5× refresh op hetzelfde apparaat = 1 scan");
    for (let i = 0; i < 2; i++) assert.equal((await beacon("Telefoon-B")).status, 204);
    assert.equal(await count(), before + 2, "ander apparaat telt wel");

    // Machineleesbare opvraging (/api/dpp) telt ook als scan, met dezelfde regel.
    for (let i = 0; i < 2; i++) await fetch(`${baseUrl}/api/dpp/${pub3.data.public_id}`, { headers: { Accept: "application/json", "User-Agent": "Systeem-C" } });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await count(), before + 3);

    const statsA = await request(baseUrl, "GET", "/api/products/qr-stats", { cookie: cookieA });
    assert.equal(statsA.status, 200);
    assert.ok(statsA.data.scans.total >= 3, "statistiek van A bevat de scans");
    const statsB = await request(baseUrl, "GET", "/api/products/qr-stats", { cookie: cookieB });
    assert.equal(statsB.data.scans.total, 0, "bedrijf B ziet geen scans van A");

    const pool2 = await getPool();
    const draft = await createTestProduct({ companyId: companyA, name: "Niet gepubliceerd" });
    assert.equal((await request(baseUrl, "POST", `/api/public/products/0f8fad5b-d9cb-469f-a165-70867728950e/scan`)).status, 404);
    const draftScans = (await pool2.query("SELECT COUNT(*)::int AS n FROM dbo.scanevents WHERE product_id = $1", [draft])).rows[0].n;
    assert.equal(draftScans, 0);
  });

  await t.test("ISO-01: een ander bedrijf kan QR-codes, versies en bulkacties van A niet benaderen", async () => {
    for (const path of [
      `/api/products/${product}/qr.png`,
      `/api/products/${product}/qr.svg`,
      `/api/products/${product}/versions`,
      `/api/products/${product}/documents`,
      `/api/products/${product}`
    ]) {
      assert.equal((await getBinary(baseUrl, path, cookieB)).status, 404, `B krijgt 404 op ${path}`);
    }
    assert.equal((await request(baseUrl, "POST", `/api/products/${product}/qr`, { cookie: cookieB })).status, 404);
    const bulk = await request(baseUrl, "POST", "/api/products/bulk/actions", {
      cookie: cookieB,
      body: { action: "archive", selection: { ids: [product] } }
    });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.data.affected, 0, "bulkactie van B raakt product van A niet");
    const zip = await postBinary(baseUrl, "/api/qr/codes.zip", cookieB, { ids: [product], format: "png" });
    assert.equal(zip.status, 400, "B kan geen QR-ZIP van A's product maken");
    const exportB = await fetch(`${baseUrl}/api/products/passports/export`, { headers: { Cookie: cookieB } });
    assert.ok(!(await exportB.text()).includes(publicId.toLowerCase()), "export van B bevat A niet");
  });

  await t.test("BULK-01: 1.000 QR-codes in bulk: allemaal uniek, in één SVG-ZIP, steekproef scanbaar", async () => {
    const pool = await getPool();
    const inserted = await pool.query(
      `INSERT INTO dbo.products (company_id, name, sku, status)
       SELECT $1, 'Bulk ' || g, 'BULK-' || g, 'draft' FROM generate_series(1, 1000) g RETURNING id`,
      [companyB]
    );
    const ids = inserted.rows.map((r) => r.id);
    const started = Date.now();
    const action = await request(baseUrl, "POST", "/api/products/bulk/actions", {
      cookie: cookieB,
      body: { action: "generate_qr", selection: { ids } }
    });
    assert.equal(action.status, 200);
    assert.equal(action.data.affected, 1000);
    const unique = await pool.query(
      "SELECT COUNT(DISTINCT public_id)::int AS n, COUNT(*)::int AS total FROM dbo.products WHERE id = ANY($1::int[])",
      [ids]
    );
    assert.equal(unique.rows[0].n, 1000, "1.000 unieke QR-identiteiten");

    const zip = await postBinary(baseUrl, "/api/qr/codes.zip", cookieB, { ids, format: "svg" });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get("x-files-count"), "1000");
    const files = unzipSync(new Uint8Array(zip.buffer));
    const names = Object.keys(files);
    assert.equal(names.length, 1000, "ZIP bevat 1.000 bestanden");

    const known = new Set(
      (await pool.query("SELECT upper(public_id::text) AS id FROM dbo.products WHERE id = ANY($1::int[])", [ids])).rows.map((r) => r.id)
    );
    for (const name of names.filter((_, i) => i % 40 === 0)) {
      const url = decodeSvg(Buffer.from(files[name]).toString("utf8"));
      assert.ok(url, `${name} is scanbaar`);
      assert.ok(known.has(url.split("/p/")[1]), `${name} verwijst naar een eigen product`);
    }
    const pngTooMany = await postBinary(baseUrl, "/api/qr/codes.zip", cookieB, { ids: ids.slice(0, 501), format: "png" });
    assert.equal(pngTooMany.status, 400, "PNG-ZIP is begrensd op 500 per bestand");
    t.diagnostic(`1.000 QR's genereren + SVG-ZIP: ${Date.now() - started} ms`);
  });

  await t.test("ACC-01: uitnodiging → activeren met eigen wachtwoord → inloggen; link is eenmalig", async () => {
    const email = `invite-${Date.now()}@example.com`;
    const invite = await request(baseUrl, "POST", `/api/admin/companies/${companyB}/invites`, {
      cookie: cookieOwner,
      body: { email, firstName: "Nieuwe", lastName: "Beheerder" }
    });
    assert.equal(invite.status, 201);
    const token = new URL(invite.data.activationUrl).searchParams.get("token");
    assert.ok(token);

    assert.equal((await request(baseUrl, "GET", `/api/invites/${token}`)).status, 200);
    const weak = await request(baseUrl, "POST", `/api/invites/${token}/accept`, { body: { password: "kort" } });
    assert.equal(weak.status, 400, "te kort wachtwoord geweigerd");
    const ok = await request(baseUrl, "POST", `/api/invites/${token}/accept`, { body: { password: "EenSterkWachtwoord!2026" } });
    assert.equal(ok.status, 201);

    const loginNew = await request(baseUrl, "POST", "/api/auth/login", { body: { email, password: "EenSterkWachtwoord!2026" } });
    assert.equal(loginNew.status, 200);
    assert.equal(loginNew.data.role, "company_admin");
    extraUserIds.push(loginNew.data.id);

    const again = await request(baseUrl, "POST", `/api/invites/${token}/accept`, { body: { password: "EenSterkWachtwoord!2026" } });
    assert.ok([404, 410].includes(again.status), "uitnodigingslink is eenmalig");
    assert.equal((await request(baseUrl, "POST", `/api/admin/companies/${companyB}/invites`, { cookie: cookieA, body: { email: "x@example.com" } })).status, 403);
  });
});
