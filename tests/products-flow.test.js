const test = require("node:test");
const assert = require("node:assert/strict");
const QRCode = require("qrcode");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

// De gedeelde request-helper leest de body als tekst; voor PNG's en headers hebben we de
// ruwe response nodig.
async function rawGet(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, buffer };
}

async function auditRows(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("entityId", sql.NVarChar(50), String(productId))
    .query(`
      SELECT action, user_id, metadata FROM dbo.AuditLogs
      WHERE entity_type = 'Product' AND entity_id = @entityId
      ORDER BY id
    `);
  return result.recordset.map((row) => ({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null }));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("producten: rollen, statusflow, checklist en QR", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyA = await createTestCompany("Products A");
  const companyB = await createTestCompany("Products B");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const managerA = await createTestUser({ companyId: companyA, role: "product_manager" });
  const complianceA = await createTestUser({ companyId: companyA, role: "compliance_manager" });
  const employeeA = await createTestUser({ companyId: companyA, role: "company_user" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [owner.id, adminA.id, managerA.id, complianceA.id, employeeA.id, viewerA.id, adminB.id]
    });
    await stopTestServer(server);
    await sql.close();
  });

  const cookies = {};
  const suffix = Date.now().toString(36);
  let productId;
  let publicId;
  let publishedAt;

  await t.test("setup: alle rollen kunnen inloggen", async () => {
    cookies.owner = await login(baseUrl, owner);
    cookies.adminA = await login(baseUrl, adminA);
    cookies.managerA = await login(baseUrl, managerA);
    cookies.complianceA = await login(baseUrl, complianceA);
    cookies.employeeA = await login(baseUrl, employeeA);
    cookies.viewerA = await login(baseUrl, viewerA);
    cookies.adminB = await login(baseUrl, adminB);
  });

  await t.test("medewerker maakt een product aan; company, status en created_by komen van de backend", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: cookies.employeeA,
      body: {
        name: `Stoel ${suffix}`,
        manufacturer: "Meubelfabriek BV",
        model: "S-1",
        adminNotes: "interne notitie",
        companyId: companyB,
        status: "published"
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.company_id, companyA, "companyId uit de body wordt genegeerd");
    assert.equal(res.data.status, "draft", "status uit de body wordt genegeerd");
    assert.equal(res.data.created_by, employeeA.id);
    assert.equal(res.data.created_by_email, employeeA.email);
    assert.equal(res.data.admin_notes, "interne notitie");
    assert.equal(res.data.public_id, null);
    assert.equal(res.data.public_url, null);
    productId = res.data.id;
  });

  await t.test("medewerker mag geen compliancevelden meesturen bij aanmaken (403 FIELD_NOT_PERMITTED)", async () => {
    const res = await request(baseUrl, "POST", "/api/products", {
      cookie: cookies.employeeA,
      body: { name: `Tafel ${suffix}`, materials: "Eiken", recyclingInfo: "Hout apart" }
    });
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, "FIELD_NOT_PERMITTED");
    assert.deepEqual(res.data.error.details.fields.sort(), ["materials", "recyclingInfo"]);
  });

  await t.test("viewer: alleen lezen", async () => {
    const list = await request(baseUrl, "GET", "/api/products", { cookie: cookies.viewerA });
    assert.equal(list.status, 200);
    assert.ok(list.data.some((p) => p.id === productId));
    assert.ok(list.data.every((p) => !("company_name" in p)), "company_name alleen voor de System Owner");

    const detail = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.viewerA });
    assert.equal(detail.status, 200);

    const checklist = await request(baseUrl, "GET", `/api/products/${productId}/checklist`, { cookie: cookies.viewerA });
    assert.equal(checklist.status, 200);

    const create = await request(baseUrl, "POST", "/api/products", { cookie: cookies.viewerA, body: { name: "x" } });
    assert.equal(create.status, 403);
    const patch = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.viewerA,
      body: { name: "x" }
    });
    assert.equal(patch.status, 403);
    const status = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.viewerA,
      body: { status: "review" }
    });
    assert.equal(status.status, 403);
    const del = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: cookies.viewerA });
    assert.equal(del.status, 403);
    const qr = await rawGet(baseUrl, `/api/products/${productId}/qr.png`, cookies.viewerA);
    assert.equal(qr.status, 403);
  });

  await t.test("compliance manager wijzigt compliancevelden, maar niet de naam", async () => {
    const ok = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.complianceA,
      body: { materials: "Staal, PU-schuim", complianceInfo: "CE" }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.materials, "Staal, PU-schuim");
    assert.equal(ok.data.updated_by, complianceA.id);
    assert.equal(ok.data.updated_by_email, complianceA.email);

    const name = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.complianceA,
      body: { name: "Andere naam" }
    });
    assert.equal(name.status, 403);
    assert.equal(name.data.error.code, "FIELD_NOT_PERMITTED");
    assert.deepEqual(name.data.error.details.fields, ["name"]);

    // Gemengd verzoek: alles of niets, ook het toegestane veld wordt niet opgeslagen.
    const mixed = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.complianceA,
      body: { adminNotes: "mag niet", repairInfo: "Reparatie via dealer" }
    });
    assert.equal(mixed.status, 403);
    assert.deepEqual(mixed.data.error.details.fields, ["adminNotes"]);
    const after = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.adminA });
    assert.equal(after.data.repair_info, null);
    assert.equal(after.data.admin_notes, "interne notitie");
  });

  await t.test("medewerker wijzigt algemene velden, maar geen compliancevelden", async () => {
    const ok = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.employeeA,
      body: { brand: "Zitgoed", description: "Ergonomische stoel" }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.brand, "Zitgoed");

    const denied = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.employeeA,
      body: { countryOfOrigin: "NL" }
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, "FIELD_NOT_PERMITTED");
  });

  await t.test("PATCH met status of onbekende velden -> 400", async () => {
    const status = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.adminA,
      body: { status: "published" }
    });
    assert.equal(status.status, 400);

    const unknown = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.adminA,
      body: { companyId: companyB }
    });
    assert.equal(unknown.status, 400);

    const empty = await request(baseUrl, "PATCH", `/api/products/${productId}`, { cookie: cookies.adminA, body: {} });
    assert.equal(empty.status, 400);
  });

  await t.test("System Owner mag alles lezen, maar niets aanmaken, wijzigen of publiceren", async () => {
    const list = await request(baseUrl, "GET", `/api/products?companyId=${companyA}`, { cookie: cookies.owner });
    assert.equal(list.status, 200);
    assert.ok(list.data.length > 0);
    assert.ok(list.data.every((p) => p.company_id === companyA));
    assert.ok(list.data.every((p) => typeof p.company_name === "string"));

    const detail = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.owner });
    assert.equal(detail.status, 200);

    const create = await request(baseUrl, "POST", "/api/products", { cookie: cookies.owner, body: { name: "SO" } });
    assert.equal(create.status, 403);
    const patch = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.owner,
      body: { name: "SO" }
    });
    assert.equal(patch.status, 403);
    const publish = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.owner,
      body: { status: "published" }
    });
    assert.equal(publish.status, 403);
    const del = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: cookies.owner });
    assert.equal(del.status, 403);
  });

  await t.test("checklist toont ontbrekende verplichte velden", async () => {
    const res = await request(baseUrl, "GET", `/api/products/${productId}/checklist`, { cookie: cookies.adminA });
    assert.equal(res.status, 200);
    assert.equal(res.data.ready, false);
    const byField = Object.fromEntries(res.data.items.map((item) => [item.field, item]));
    assert.equal(byField.name.ok, true);
    assert.equal(byField.name.level, "required");
    assert.equal(byField.sku.ok, false);
    assert.equal(byField.category.ok, false);
    assert.equal(byField.countryOfOrigin.ok, false);
    assert.equal(byField.materials.ok, true);
    assert.equal(byField.complianceInfo.level, "recommended");
    assert.equal(byField.publicDocuments.ok, false);
    assert.ok(res.data.items.every((item) => typeof item.label === "string"));
  });

  await t.test("medewerker biedt ter review aan, maar mag niet publiceren of archiveren", async () => {
    const review = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.employeeA,
      body: { status: "review" }
    });
    assert.equal(review.status, 200);
    assert.equal(review.data.status, "review");

    const publish = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.employeeA,
      body: { status: "published" }
    });
    assert.equal(publish.status, 403);

    const archive = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: cookies.employeeA });
    assert.equal(archive.status, 403);

    const archiveViaStatus = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.employeeA,
      body: { status: "archived" }
    });
    assert.equal(archiveViaStatus.status, 403);
  });

  await t.test("ongeldige transities -> 409 INVALID_TRANSITION", async () => {
    const same = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.adminA,
      body: { status: "review" }
    });
    assert.equal(same.status, 409, "review -> review");
    assert.equal(same.data.error.code, "INVALID_TRANSITION");

    const bogus = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.adminA,
      body: { status: "deleted" }
    });
    assert.equal(bogus.status, 400);
  });

  await t.test("publiceren met ontbrekende velden -> 422 met lijst van ontbrekende velden", async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "published" }
    });
    assert.equal(res.status, 422);
    assert.equal(res.data.error.code, "PUBLISH_REQUIREMENTS_MISSING");
    assert.deepEqual(res.data.error.details.missing.sort(), ["category", "countryOfOrigin", "sku"]);

    const still = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.adminA });
    assert.equal(still.data.status, "review");
    assert.equal(still.data.public_id, null);
  });

  await t.test("terugsturen review -> draft en opnieuw aanbieden (compliance manager)", async () => {
    const back = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "draft" }
    });
    assert.equal(back.status, 200);
    assert.equal(back.data.status, "draft");

    const again = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.complianceA,
      body: { status: "review" }
    });
    assert.equal(again.status, 200);
    assert.equal(again.data.status, "review");
  });

  await t.test("QR is niet beschikbaar zolang het product niet gepubliceerd is", async () => {
    const png = await rawGet(baseUrl, `/api/products/${productId}/qr.png`, cookies.adminA);
    assert.equal(png.status, 409);
    assert.equal(JSON.parse(png.buffer.toString("utf8")).error.code, "NOT_PUBLISHED");
    const svg = await rawGet(baseUrl, `/api/products/${productId}/qr.svg`, cookies.adminA);
    assert.equal(svg.status, 409);
  });

  await t.test("product manager vult de verplichte velden aan en publiceert", async () => {
    const patch = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.managerA,
      body: { sku: `SKU/${suffix} "1"`, category: "Meubels", countryOfOrigin: "Nederland" }
    });
    assert.equal(patch.status, 200);

    const checklist = await request(baseUrl, "GET", `/api/products/${productId}/checklist`, { cookie: cookies.adminA });
    assert.equal(checklist.data.ready, true);

    const res = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "published" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "published");
    assert.match(res.data.public_id, UUID_PATTERN);
    assert.ok(res.data.published_at);
    assert.ok(res.data.public_url.endsWith(`/p/${res.data.public_id}`));
    publicId = res.data.public_id;
    publishedAt = res.data.published_at;

    const list = await request(baseUrl, "GET", "/api/products?status=published", { cookie: cookies.viewerA });
    const row = list.data.find((p) => p.id === productId);
    assert.ok(row, "gepubliceerd product staat in de gefilterde lijst");
    assert.equal(row.public_url, res.data.public_url);
  });

  await t.test("gepubliceerd product: verplicht veld leegmaken geeft 422, gewone wijziging mag", async () => {
    const empty = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.managerA,
      body: { materials: "" }
    });
    assert.equal(empty.status, 422);
    assert.equal(empty.data.error.code, "PUBLISH_REQUIREMENTS_MISSING");
    assert.deepEqual(empty.data.error.details.missing, ["materials"]);

    const detail = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.adminA });
    assert.equal(detail.data.status, "published");
    assert.ok(detail.data.materials, "materialen zijn niet leeggemaakt");

    const ok = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.managerA,
      body: { description: "Bijgewerkte beschrijving" }
    });
    assert.equal(ok.status, 200);
  });

  await t.test("QR png/svg: juiste content-type en inhoud; alleen ?download=1 audit + attachment", async () => {
    const before = (await auditRows(productId)).filter((row) => row.action === "qr_generate").length;

    const png = await rawGet(baseUrl, `/api/products/${productId}/qr.png`, cookies.employeeA);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.ok(png.buffer.subarray(0, 8).equals(PNG_SIGNATURE));
    assert.match(png.headers.get("cache-control"), /private/);
    assert.equal(png.headers.get("content-disposition"), null);
    // Standaardgrootte 512px: breedte staat in de IHDR-chunk (bytes 16..19).
    assert.equal(png.buffer.readUInt32BE(16), 512);

    const small = await rawGet(baseUrl, `/api/products/${productId}/qr.png?size=256`, cookies.employeeA);
    assert.equal(small.status, 200);
    assert.equal(small.buffer.readUInt32BE(16), 256);

    for (const size of ["50", "4096", "abc", "300.5"]) {
      const bad = await rawGet(baseUrl, `/api/products/${productId}/qr.png?size=${size}`, cookies.employeeA);
      assert.equal(bad.status, 400, `size=${size}`);
    }

    // SVG negeert size (docs §8): ook waarden buiten 128..1024 of onzin geven gewoon de SVG.
    for (const size of ["4096", "abc"]) {
      const ignored = await rawGet(baseUrl, `/api/products/${productId}/qr.svg?size=${size}`, cookies.employeeA);
      assert.equal(ignored.status, 200, `svg size=${size}`);
      assert.match(ignored.headers.get("content-type"), /^image\/svg\+xml/);
    }
    // download blijft wel gevalideerd, ook voor SVG.
    const badDownload = await rawGet(baseUrl, `/api/products/${productId}/qr.svg?download=ja`, cookies.employeeA);
    assert.equal(badDownload.status, 400);

    const svg = await rawGet(baseUrl, `/api/products/${productId}/qr.svg`, cookies.managerA);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-type"), /^image\/svg\+xml/);
    assert.ok(svg.buffer.toString("utf8").startsWith("<svg"));
    // De SVG-uitvoer is deterministisch: gelijk aan een QR van de verwachte publieke URL.
    const base = (process.env.PUBLIC_BASE_URL || baseUrl).replace(/\/+$/, "");
    const expected = await QRCode.toString(`${base}/p/${publicId}?src=qr`, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M"
    });
    assert.equal(svg.buffer.toString("utf8"), expected, "QR bevat <PUBLIC_BASE_URL>/p/<public_id>?src=qr");

    const afterPreview = (await auditRows(productId)).filter((row) => row.action === "qr_generate").length;
    assert.equal(afterPreview, before, "voorvertoning schrijft geen audit");

    const download = await rawGet(baseUrl, `/api/products/${productId}/qr.png?download=1`, cookies.adminA);
    assert.equal(download.status, 200);
    const disposition = download.headers.get("content-disposition");
    assert.match(disposition, /^attachment; filename="dpp-qr-[A-Za-z0-9_-]+\.png"$/);
    assert.ok(disposition.includes(`SKU${suffix}1`), "onveilige tekens uit de SKU zijn verwijderd");

    const downloadSvg = await rawGet(baseUrl, `/api/products/${productId}/qr.svg?download=1`, cookies.adminA);
    assert.equal(downloadSvg.status, 200);
    assert.match(downloadSvg.headers.get("content-disposition"), /^attachment; filename="dpp-qr-[A-Za-z0-9_-]+\.svg"$/);

    const qrAudits = (await auditRows(productId)).filter((row) => row.action === "qr_generate");
    assert.equal(qrAudits.length, before + 2);
    assert.deepEqual(
      qrAudits.map((row) => row.metadata.format),
      ["png", "svg"]
    );
    assert.ok(qrAudits.every((row) => row.user_id === adminA.id));
  });

  await t.test("compliance manager heeft geen qr:download", async () => {
    const res = await rawGet(baseUrl, `/api/products/${productId}/qr.svg`, cookies.complianceA);
    assert.equal(res.status, 403);
  });

  await t.test("depubliceren en herpubliceren: public_id en published_at blijven gelijk", async () => {
    const employeeUnpublish = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.employeeA,
      body: { status: "draft" }
    });
    assert.equal(employeeUnpublish.status, 403, "depubliceren vereist products:publish");

    const invalid = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "review" }
    });
    assert.equal(invalid.status, 409);
    assert.equal(invalid.data.error.code, "INVALID_TRANSITION");

    const unpublish = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "draft" }
    });
    assert.equal(unpublish.status, 200);
    assert.equal(unpublish.data.status, "draft");
    assert.equal(unpublish.data.public_id, publicId);
    assert.equal(unpublish.data.public_url, null);

    const qr = await rawGet(baseUrl, `/api/products/${productId}/qr.png`, cookies.adminA);
    assert.equal(qr.status, 409);

    const republish = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.adminA,
      body: { status: "published" }
    });
    assert.equal(republish.status, 200);
    assert.equal(republish.data.public_id, publicId);
    assert.equal(republish.data.published_at, publishedAt);
  });

  await t.test("archiveren via DELETE; gearchiveerd = alleen-lezen; herstellen naar draft", async () => {
    const archived = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: cookies.managerA });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.status, "archived");
    assert.equal(archived.data.public_id, publicId);

    const again = await request(baseUrl, "DELETE", `/api/products/${productId}`, { cookie: cookies.managerA });
    assert.equal(again.status, 409);
    assert.equal(again.data.error.code, "INVALID_TRANSITION");

    const patch = await request(baseUrl, "PATCH", `/api/products/${productId}`, {
      cookie: cookies.adminA,
      body: { brand: "Nieuw" }
    });
    assert.equal(patch.status, 409);
    assert.equal(patch.data.error.code, "PRODUCT_ARCHIVED");

    for (const status of ["published", "review", "archived"]) {
      const res = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
        cookie: cookies.adminA,
        body: { status }
      });
      assert.equal(res.status, 409, `archived -> ${status}`);
      assert.equal(res.data.error.code, "INVALID_TRANSITION");
    }

    const restore = await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.managerA,
      body: { status: "draft" }
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.status, "draft");
    assert.equal(restore.data.public_id, publicId);
  });

  await t.test("audit log bevat elke statuswissel met {from,to}", async () => {
    const rows = await auditRows(productId);
    const transitions = rows
      .filter((row) => row.metadata && row.metadata.from)
      .map((row) => `${row.action}:${row.metadata.from}->${row.metadata.to}`);
    assert.deepEqual(transitions, [
      "submit_review:draft->review",
      "status_change:review->draft",
      "submit_review:draft->review",
      "publish:review->published",
      "unpublish:published->draft",
      "publish:draft->published",
      "archive:published->archived",
      "status_change:archived->draft"
    ]);

    const create = rows.find((row) => row.action === "create");
    assert.ok(create);
    assert.equal(create.user_id, employeeA.id);

    // Wijzigingen loggen alleen veldnamen, nooit de inhoud.
    const updates = rows.filter((row) => row.action === "update");
    assert.ok(updates.length >= 3);
    assert.ok(updates.every((row) => Array.isArray(row.metadata.fields)));
    assert.ok(!JSON.stringify(updates).includes("Staal, PU-schuim"));
  });

  await t.test("cross-tenant: company admin B krijgt overal 404", async () => {
    const cookie = cookies.adminB;
    const checks = [
      ["GET", `/api/products/${productId}`],
      ["PATCH", `/api/products/${productId}`, { name: "Gehackt" }],
      ["DELETE", `/api/products/${productId}`],
      ["POST", `/api/products/${productId}/status`, { status: "review" }],
      ["GET", `/api/products/${productId}/checklist`],
      ["GET", `/api/products/${productId}/documents`]
    ];
    for (const [method, path, body] of checks) {
      const res = await request(baseUrl, method, path, { cookie, body });
      assert.equal(res.status, 404, `${method} ${path}`);
    }

    // QR voor een gepubliceerd product van A: ook 404, niet 409/200.
    await request(baseUrl, "POST", `/api/products/${productId}/status`, {
      cookie: cookies.adminA,
      body: { status: "published" }
    });
    for (const path of [`/api/products/${productId}/qr.png`, `/api/products/${productId}/qr.svg?download=1`]) {
      const res = await rawGet(baseUrl, path, cookie);
      assert.equal(res.status, 404, path);
    }

    const list = await request(baseUrl, "GET", `/api/products?companyId=${companyA}`, { cookie });
    assert.equal(list.status, 200);
    assert.ok(!list.data.some((p) => p.id === productId), "companyId-filter werkt alleen voor de System Owner");

    const unchanged = await request(baseUrl, "GET", `/api/products/${productId}`, { cookie: cookies.adminA });
    assert.equal(unchanged.data.status, "published");
    assert.notEqual(unchanged.data.name, "Gehackt");
  });

  await t.test("ongeldige ids -> 404", async () => {
    for (const id of ["abc", "0", "-1", "1.5", "99999999999"]) {
      const res = await request(baseUrl, "GET", `/api/products/${id}`, { cookie: cookies.adminA });
      assert.equal(res.status, 404, id);
    }
  });

  await t.test("lijstfilters: q escapet LIKE-jokertekens, category en status", async () => {
    const names = [`Katoen 100% ${suffix}`, `Katoen 1000 ${suffix}`, `Band a_b ${suffix}`, `Band axb ${suffix}`];
    for (const name of names) {
      const res = await request(baseUrl, "POST", "/api/products", {
        cookie: cookies.adminA,
        body: { name, category: `Cat-${suffix}` }
      });
      assert.equal(res.status, 201);
    }

    const percent = await request(baseUrl, "GET", `/api/products?q=${encodeURIComponent("100%")}`, {
      cookie: cookies.adminA
    });
    assert.deepEqual(
      percent.data.map((p) => p.name).filter((n) => n.endsWith(suffix)),
      [`Katoen 100% ${suffix}`]
    );

    const underscore = await request(baseUrl, "GET", `/api/products?q=${encodeURIComponent("a_b")}`, {
      cookie: cookies.adminA
    });
    assert.deepEqual(
      underscore.data.map((p) => p.name).filter((n) => n.endsWith(suffix)),
      [`Band a_b ${suffix}`]
    );

    const bySku = await request(baseUrl, "GET", `/api/products?q=${encodeURIComponent(`SKU/${suffix}`)}`, {
      cookie: cookies.adminA
    });
    assert.deepEqual(bySku.data.map((p) => p.id), [productId]);

    const category = await request(baseUrl, "GET", `/api/products?category=Cat-${suffix}`, { cookie: cookies.adminA });
    assert.equal(category.data.length, 4);

    const drafts = await request(baseUrl, "GET", `/api/products?status=draft&category=Cat-${suffix}`, {
      cookie: cookies.adminA
    });
    assert.equal(drafts.data.length, 4);
    assert.ok(drafts.data.every((p) => p.status === "draft" && p.public_url === null));

    const badStatus = await request(baseUrl, "GET", "/api/products?status=weg", { cookie: cookies.adminA });
    assert.equal(badStatus.status, 400);
  });
});
