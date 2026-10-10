const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");
const archive = require("../src/services/passportArchive.service");

// Compliance-tests voor de DPP-eisen die in software zijn geïmplementeerd. Elke
// test verwijst naar de eis in docs/compliance/requirements-matrix.md.

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", { body: { email: user.email, password: user.password } });
  assert.equal(res.status, 200);
  return res.cookie;
}

async function raw(baseUrl, path, accept) {
  const response = await fetch(`${baseUrl}${path}`, { headers: accept ? { Accept: accept } : {}, redirect: "manual" });
  return { status: response.status, type: response.headers.get("content-type"), headers: response.headers, text: await response.text() };
}

test("DPP-compliance: archief, integriteit, persistentie, content negotiation en export", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const companyA = await createTestCompany("DPP Compliance A");
  const companyB = await createTestCompany("DPP Compliance B");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const userA = await createTestUser({ companyId: companyA, role: "company_user" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });
  const product = await createTestProduct({ companyId: companyA, name: "Paspoort Product" });
  const draftOnly = await createTestProduct({ companyId: companyA, name: "Nooit gepubliceerd" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [adminA.id, userA.id, adminB.id],
      productIds: [product, draftOnly]
    });
    await stopTestServer(server);
    await sql.close();
  });

  const cookieA = await login(baseUrl, adminA);
  const cookieUserA = await login(baseUrl, userA);
  const cookieB = await login(baseUrl, adminB);
  let publicId;

  await t.test("R-ARCH-01: concepten worden niet geversioneerd; publiceren legt versie 1 vast", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { description: "Concepttekst" } });
    assert.equal((await archive.listVersions(product)).length, 0, "concept: geen versies");

    const published = await request(baseUrl, "POST", `/api/products/${product}/publish`, { cookie: cookieA });
    assert.equal(published.status, 200);
    publicId = String(published.data.public_id);
    const versions = await archive.listVersions(product);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].versionNumber, 1);
    assert.equal(versions[0].reason, "publish");
  });

  await t.test("R-ARCH-02: elke inhoudelijke wijziging wordt een nieuwe versie; geen wijziging = geen versie", async () => {
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { description: "Nieuwe beschrijving" } });
    await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { description: "Nieuwe beschrijving" } });
    const sus = await request(baseUrl, "PUT", `/api/products/${product}/sustainability`, {
      cookie: cookieA,
      body: { recycledMaterialPct: 40 }
    });
    assert.ok(sus.status === 200 || sus.status === 201, `duurzaamheid opslaan (status ${sus.status})`);
    const versions = await archive.listVersions(product);
    assert.equal(versions.length, 3, "publish + beschrijving + duurzaamheid (dubbele PATCH telt niet)");
    assert.deepEqual(versions.map((v) => v.versionNumber), [1, 2, 3]);
  });

  await t.test("R-ARCH-03: de hash-keten is geldig en elke versie verwijst naar zijn voorganger", async () => {
    const result = await archive.verifyChain(product);
    assert.equal(result.valid, true, JSON.stringify(result.problems));
    const versions = await archive.listVersions(product);
    assert.equal(versions[0].previousChainSha256, null);
    assert.equal(versions[1].previousChainSha256, versions[0].chainSha256);
    assert.match(versions[2].contentSha256, /^[0-9a-f]{64}$/);
  });

  await t.test("R-ARCH-04: versies zijn onveranderlijk (UPDATE/DELETE/TRUNCATE geweigerd)", async () => {
    const pool = await getPool();
    await assert.rejects(pool.query("UPDATE dbo.passportversions SET reason = 'x' WHERE product_id = $1", [product]), /append-only/);
    await assert.rejects(pool.query("DELETE FROM dbo.passportversions WHERE product_id = $1", [product]), /append-only/);
    await assert.rejects(pool.query("TRUNCATE dbo.passportversions"), /append-only/);
  });

  await t.test("R-ARCH-05: een versie op een tijdstip is opvraagbaar; oude inhoud blijft behouden", async () => {
    const v1 = await archive.getVersion(product, 1);
    const atV1 = await raw(baseUrl, `/api/dpp/${publicId}?at=${encodeURIComponent(v1.createdAt)}`, "application/json");
    assert.equal(atV1.status, 200);
    const body = JSON.parse(atV1.text);
    assert.equal(body.version.number, 1);
    assert.equal(body.product.description, "Concepttekst");
    assert.equal(atV1.headers.get("cache-control"), "public, max-age=86400, immutable");

    const current = JSON.parse((await raw(baseUrl, `/api/dpp/${publicId}`, "application/json")).text);
    assert.equal(current.product.description, "Nieuwe beschrijving");
    assert.equal(current.sustainability.recycledMaterialPct, 40);

    const before = await raw(baseUrl, `/api/dpp/${publicId}?at=2000-01-01T00:00:00Z`, "application/json");
    assert.equal(before.status, 404, "vóór de eerste versie bestaat er geen paspoort");
  });

  await t.test("R-ARCH-06: versiegeschiedenis alleen voor het eigen bedrijf (tenant-isolatie)", async () => {
    const own = await request(baseUrl, "GET", `/api/products/${product}/versions`, { cookie: cookieUserA });
    assert.equal(own.status, 200);
    assert.equal(own.data.versions.length, 3);
    const foreign = await request(baseUrl, "GET", `/api/products/${product}/versions`, { cookie: cookieB });
    assert.equal(foreign.status, 404);
    const foreignVersion = await request(baseUrl, "GET", `/api/products/${product}/versions/1`, { cookie: cookieB });
    assert.equal(foreignVersion.status, 404);
    const verify = await request(baseUrl, "GET", `/api/products/${product}/versions/verify`, { cookie: cookieA });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.valid, true);
  });

  await t.test("R-EXCH-01..04: content negotiation op /api/dpp (JSON, JSON-LD, XML, HTML-redirect, 406)", async () => {
    const json = await raw(baseUrl, `/api/dpp/${publicId}`, "application/json");
    assert.equal(json.status, 200);
    assert.match(json.type, /^application\/json/);
    assert.match(json.headers.get("vary") || "", /Accept/i);
    const parsed = JSON.parse(json.text);
    assert.equal(parsed.identifiers.passportId, publicId.toLowerCase());
    assert.equal(parsed.identifiers.urn, `urn:uuid:${publicId.toLowerCase()}`);
    assert.ok(parsed.id.endsWith(`/p/${publicId.toUpperCase()}`), "canonieke id = gedrukte QR-URL");

    const ld = await raw(baseUrl, `/api/dpp/${publicId}`, "application/ld+json");
    assert.match(ld.type, /^application\/ld\+json/);
    const ldBody = JSON.parse(ld.text);
    assert.ok(ldBody["@context"], "JSON-LD heeft een @context");
    assert.equal(ldBody.product.name, parsed.product.name, "JSON-LD is gewone JSON plus context");

    const xml = await raw(baseUrl, `/api/dpp/${publicId}`, "application/xml");
    assert.match(xml.type, /^application\/xml/);
    assert.ok(xml.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.text.includes("<digitalProductPassport>"));

    const explicit = await raw(baseUrl, `/api/dpp/${publicId}?format=jsonld`);
    assert.match(explicit.type, /^application\/ld\+json/);

    const html = await raw(baseUrl, `/api/dpp/${publicId}`, "text/html");
    assert.equal(html.status, 303);
    assert.equal(html.headers.get("location"), `/p/${publicId}`);

    const unsupported = await raw(baseUrl, `/api/dpp/${publicId}`, "image/png");
    assert.equal(unsupported.status, 406);

    const upper = await raw(baseUrl, `/api/dpp/${publicId.toUpperCase()}`, "application/json");
    assert.equal(upper.status, 200, "QR-codes met hoofdletter-GUID werken ook machineleesbaar");
  });

  await t.test("R-SEC-01: machineleesbare DPP lekt geen interne gegevens", async () => {
    const text = (await raw(baseUrl, `/api/dpp/${publicId}`, "application/json")).text;
    for (const forbidden of ["company_id", "companyId", "objectName", "created_by", "blob_name", `"isPublic"`]) {
      assert.ok(!text.includes(forbidden), `"${forbidden}" mag niet in de publieke DPP staan`);
    }
    const versions = await raw(baseUrl, `/api/dpp/${publicId}/versions`);
    assert.equal(versions.status, 200);
    const list = JSON.parse(versions.text);
    assert.equal(list.versions.length, 3);
    assert.ok(!versions.text.includes("snapshot"), "de publieke lijst bevat alleen metadata");
  });

  await t.test("R-ID-01: onbekende, kapotte of niet-gepubliceerde id's geven 404", async () => {
    assert.equal((await raw(baseUrl, "/api/dpp/geen-uuid", "application/json")).status, 404);
    assert.equal((await raw(baseUrl, "/api/dpp/0f8fad5b-d9cb-469f-a165-70867728950e", "application/json")).status, 404);
    const reserved = await request(baseUrl, "POST", `/api/products/${draftOnly}/qr`, { cookie: cookieA });
    assert.equal(reserved.status, 200);
    const reservedId = reserved.data.public_id;
    assert.equal((await raw(baseUrl, `/api/dpp/${reservedId}`, "application/json")).status, 404, "gereserveerde QR is nog niet openbaar");
  });

  await t.test("R-PERS-01: een gearchiveerd concept met gereserveerde QR wordt nooit openbaar", async () => {
    const archived = await request(baseUrl, "DELETE", `/api/products/${draftOnly}`, { cookie: cookieA });
    assert.equal(archived.status, 200);
    const product2 = await request(baseUrl, "GET", `/api/products/${draftOnly}`, { cookie: cookieA });
    assert.equal(product2.data.qr_status, "reserved");
    assert.equal((await raw(baseUrl, `/api/public/products/${product2.data.public_id}`)).status, 404);
    assert.equal((await archive.listVersions(draftOnly)).length, 0);
  });

  await t.test("R-PERS-02: een gepubliceerd paspoort kan niet terug naar concept (QR blijft werken)", async () => {
    const res = await request(baseUrl, "PATCH", `/api/products/${product}`, { cookie: cookieA, body: { status: "draft" } });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, "PASSPORT_PERSISTENCE");
    assert.equal((await raw(baseUrl, `/api/public/products/${publicId}`)).status, 200);
  });

  await t.test("R-PERS-03: archiveren houdt het paspoort publiek en wordt een versie", async () => {
    const res = await request(baseUrl, "DELETE", `/api/products/${product}`, { cookie: cookieA });
    assert.equal(res.status, 200);
    const page = await raw(baseUrl, `/api/public/products/${publicId}`);
    assert.equal(page.status, 200);
    assert.equal(JSON.parse(page.text).archived, true);
    const versions = await archive.listVersions(product);
    assert.equal(versions.at(-1).reason, "archive");
    const dpp = JSON.parse((await raw(baseUrl, `/api/dpp/${publicId}`, "application/json")).text);
    assert.equal(dpp.status, "archived");
  });

  await t.test("R-REPL-01: export (NDJSON) bevat alle paspoorten met alle versies; alleen voor Company Admin", async () => {
    const forbidden = await request(baseUrl, "GET", "/api/products/passports/export", { cookie: cookieUserA });
    assert.equal(forbidden.status, 403);

    const response = await fetch(`${baseUrl}/api/products/passports/export`, { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
    const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines[0].type, "header");
    assert.equal(lines.at(-1).type, "footer");
    const passports = lines.filter((l) => l.type === "passport");
    assert.equal(passports.length, 1, "alleen paspoorten die op de markt zijn");
    assert.equal(passports[0].publicId, publicId.toLowerCase());
    assert.equal(passports[0].versions.length, (await archive.listVersions(product)).length);

    // Bedrijf B ziet niets van bedrijf A.
    const other = await fetch(`${baseUrl}/api/products/passports/export`, { headers: { Cookie: cookieB } });
    const otherLines = (await other.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(otherLines.filter((l) => l.type === "passport").length, 0);
  });

  await t.test("R-PERS-04: een geblokkeerd bedrijf (bijv. licentie/opzegging) laat gepubliceerde paspoorten online", async () => {
    const pool = await getPool();
    await pool.query("UPDATE dbo.companies SET status = 'blocked' WHERE id = $1", [companyA]);
    try {
      const page = await raw(baseUrl, `/api/public/products/${publicId}`);
      assert.equal(page.status, 200);
      const dpp = await raw(baseUrl, `/api/dpp/${publicId}`, "application/ld+json");
      assert.equal(dpp.status, 200);
      const versions = await raw(baseUrl, `/api/dpp/${publicId}/versions`);
      assert.equal(versions.status, 200);
      // Beheerders van het geblokkeerde bedrijf zijn wel buitengesloten.
      const me = await request(baseUrl, "GET", "/api/auth/me", { cookie: cookieA });
      assert.equal(me.status, 401);
    } finally {
      await pool.query("UPDATE dbo.companies SET status = 'active' WHERE id = $1", [companyA]);
    }
  });
});
