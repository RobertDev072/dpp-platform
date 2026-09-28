const test = require("node:test");
const assert = require("node:assert/strict");
const { getPool, sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");
const { createTestCompany, createTestUser, createTestProduct, cleanupTestData } = require("./helpers/fixtures");

async function login(baseUrl, user) {
  const res = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email: user.email, password: user.password }
  });
  assert.equal(res.status, 200, `login voor ${user.email} moet slagen`);
  return res.cookie;
}

async function documentAuditRows(documentId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("entityId", sql.NVarChar(50), String(documentId))
    .query(`
      SELECT action, company_id, user_id, metadata FROM dbo.AuditLogs
      WHERE entity_type = 'Document' AND entity_id = @entityId
      ORDER BY id
    `);
  return result.recordset;
}

test("documenten: https-only, rechten en tenant-isolatie", async (t) => {
  const { server, baseUrl } = await startTestServer();

  const companyA = await createTestCompany("Docs A");
  const companyB = await createTestCompany("Docs B");

  const owner = await createTestUser({ companyId: null, role: "system_owner" });
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });
  const employeeA = await createTestUser({ companyId: companyA, role: "company_user" });
  const complianceA = await createTestUser({ companyId: companyA, role: "compliance_manager" });
  const viewerA = await createTestUser({ companyId: companyA, role: "viewer" });
  const adminB = await createTestUser({ companyId: companyB, role: "company_admin" });

  const productA = await createTestProduct({ companyId: companyA, name: "Doc product A" });
  const productA2 = await createTestProduct({ companyId: companyA, name: "Doc product A2" });
  const productB = await createTestProduct({ companyId: companyB, name: "Doc product B" });

  t.after(async () => {
    await cleanupTestData({
      companyIds: [companyA, companyB],
      userIds: [owner.id, adminA.id, employeeA.id, complianceA.id, viewerA.id, adminB.id],
      productIds: [productA, productA2, productB]
    });
    await stopTestServer(server);
    await sql.close();
  });

  const cookies = {};
  let documentId;
  let documentB;

  await t.test("setup: inloggen", async () => {
    cookies.owner = await login(baseUrl, owner);
    cookies.adminA = await login(baseUrl, adminA);
    cookies.employeeA = await login(baseUrl, employeeA);
    cookies.complianceA = await login(baseUrl, complianceA);
    cookies.viewerA = await login(baseUrl, viewerA);
    cookies.adminB = await login(baseUrl, adminB);
  });

  await t.test("medewerker voegt een https-document toe; company komt van het product", async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
      cookie: cookies.employeeA,
      body: {
        title: "Handleiding",
        type: "manual",
        language: "nl",
        url: "https://example.com/handleiding.pdf",
        companyId: companyB,
        productId: productB
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.company_id, companyA, "companyId uit de body wordt genegeerd");
    assert.equal(res.data.product_id, productA, "productId komt uit de URL");
    assert.equal(res.data.url, "https://example.com/handleiding.pdf");
    assert.equal(res.data.is_public, false, "standaard niet publiek");
    assert.equal(res.data.created_by, employeeA.id);
    documentId = res.data.id;

    const audit = await documentAuditRows(documentId);
    assert.deepEqual(
      audit.map((row) => row.action),
      ["document_create"]
    );
    assert.equal(audit[0].company_id, companyA);
    assert.ok(!audit[0].metadata.includes("example.com"), "de URL staat niet in de audit log");
  });

  await t.test("alleen https-links: javascript:, data:, http: en rommel worden geweigerd", async () => {
    const badUrls = [
      "http://example.com/a.pdf",
      "javascript:alert(1)",
      "JavaScript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "ftp://example.com/a.pdf",
      "//example.com/a.pdf",
      "https://user:secret@example.com/a.pdf",
      "https://localhost/a.pdf",
      "niet een url",
      "",
      `https://example.com/${"a".repeat(1000)}`
    ];
    for (const url of badUrls) {
      const res = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
        cookie: cookies.adminA,
        body: { title: "Kwaad", type: "other", url, isPublic: true }
      });
      assert.equal(res.status, 400, `url ${url.slice(0, 40)} moet geweigerd worden`);
    }
  });

  await t.test("validatie van titel, type, taal en isPublic", async () => {
    const cases = [
      { type: "manual", url: "https://example.com/x.pdf" },
      { title: "", type: "manual", url: "https://example.com/x.pdf" },
      { title: "a".repeat(201), type: "manual", url: "https://example.com/x.pdf" },
      { title: "T", type: "brochure", url: "https://example.com/x.pdf" },
      { title: "T", type: "manual", url: "https://example.com/x.pdf", language: "nederlands-lang" },
      { title: "T", type: "manual", url: "https://example.com/x.pdf", isPublic: "ja" }
    ];
    for (const body of cases) {
      const res = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
        cookie: cookies.adminA,
        body
      });
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    }
  });

  await t.test("viewer en System Owner mogen lezen maar geen documenten beheren", async () => {
    const list = await request(baseUrl, "GET", `/api/products/${productA}/documents`, { cookie: cookies.viewerA });
    assert.equal(list.status, 200);
    assert.ok(list.data.some((d) => d.id === documentId));

    const create = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
      cookie: cookies.viewerA,
      body: { title: "V", type: "manual", url: "https://example.com/v.pdf" }
    });
    assert.equal(create.status, 403);

    const patch = await request(baseUrl, "PATCH", `/api/documents/${documentId}`, {
      cookie: cookies.viewerA,
      body: { title: "V" }
    });
    assert.equal(patch.status, 403);

    const del = await request(baseUrl, "DELETE", `/api/documents/${documentId}`, { cookie: cookies.viewerA });
    assert.equal(del.status, 403);

    const ownerList = await request(baseUrl, "GET", `/api/documents?companyId=${companyA}`, { cookie: cookies.owner });
    assert.equal(ownerList.status, 200);
    assert.ok(ownerList.data.some((d) => d.id === documentId));
    assert.ok(ownerList.data.every((d) => d.company_id === companyA));

    const ownerCreate = await request(baseUrl, "POST", `/api/products/${productA}/documents`, {
      cookie: cookies.owner,
      body: { title: "SO", type: "manual", url: "https://example.com/so.pdf" }
    });
    assert.equal(ownerCreate.status, 403);
  });

  await t.test("compliance manager mag documenten beheren", async () => {
    const res = await request(baseUrl, "POST", `/api/products/${productA2}/documents`, {
      cookie: cookies.complianceA,
      body: { title: "CE-verklaring", type: "declaration", url: "https://example.com/ce.pdf", isPublic: true }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.is_public, true);
  });

  await t.test("GET /api/documents: eigen company, product_name, filters", async () => {
    const all = await request(baseUrl, "GET", "/api/documents", { cookie: cookies.viewerA });
    assert.equal(all.status, 200);
    assert.equal(all.data.length, 2);
    assert.ok(all.data.every((d) => d.company_id === companyA));
    const doc = all.data.find((d) => d.id === documentId);
    assert.match(doc.product_name, /^Doc product A /);

    const byType = await request(baseUrl, "GET", "/api/documents?type=declaration", { cookie: cookies.viewerA });
    assert.deepEqual(
      byType.data.map((d) => d.type),
      ["declaration"]
    );

    const byProduct = await request(baseUrl, "GET", `/api/documents?productId=${productA}`, { cookie: cookies.viewerA });
    assert.deepEqual(
      byProduct.data.map((d) => d.id),
      [documentId]
    );

    const badType = await request(baseUrl, "GET", "/api/documents?type=brochure", { cookie: cookies.viewerA });
    assert.equal(badType.status, 400);
    const badProduct = await request(baseUrl, "GET", "/api/documents?productId=abc", { cookie: cookies.viewerA });
    assert.equal(badProduct.status, 400);
  });

  await t.test("PATCH: velden bijwerken, https-only, geen verplaatsing naar ander product", async () => {
    const ok = await request(baseUrl, "PATCH", `/api/documents/${documentId}`, {
      cookie: cookies.employeeA,
      body: { title: "Handleiding v2", isPublic: true, language: "" }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.title, "Handleiding v2");
    assert.equal(ok.data.is_public, true);
    assert.equal(ok.data.language, null);

    const http = await request(baseUrl, "PATCH", `/api/documents/${documentId}`, {
      cookie: cookies.employeeA,
      body: { url: "http://example.com/onveilig.pdf" }
    });
    assert.equal(http.status, 400);

    const move = await request(baseUrl, "PATCH", `/api/documents/${documentId}`, {
      cookie: cookies.employeeA,
      body: { productId: productB }
    });
    assert.equal(move.status, 400);

    const empty = await request(baseUrl, "PATCH", `/api/documents/${documentId}`, { cookie: cookies.employeeA, body: {} });
    assert.equal(empty.status, 400);
  });

  await t.test("tenant-isolatie: company B ziet en raakt documenten van A niet (404)", async () => {
    const createB = await request(baseUrl, "POST", `/api/products/${productB}/documents`, {
      cookie: cookies.adminB,
      body: { title: "B-doc", type: "manual", url: "https://example.com/b.pdf" }
    });
    assert.equal(createB.status, 201);
    documentB = createB.data.id;

    const list = await request(baseUrl, "GET", "/api/documents", { cookie: cookies.adminB });
    assert.equal(list.status, 200);
    assert.ok(!list.data.some((d) => d.id === documentId));
    assert.ok(list.data.every((d) => d.company_id === companyB));

    const filtered = await request(baseUrl, "GET", `/api/documents?productId=${productA}&companyId=${companyA}`, {
      cookie: cookies.adminB
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.data, [], "companyId-filter werkt alleen voor de System Owner");

    const checks = [
      ["GET", `/api/products/${productA}/documents`],
      ["POST", `/api/products/${productA}/documents`, { title: "X", type: "manual", url: "https://example.com/x.pdf" }],
      ["PATCH", `/api/documents/${documentId}`, { title: "Gehackt" }],
      ["DELETE", `/api/documents/${documentId}`]
    ];
    for (const [method, path, body] of checks) {
      const res = await request(baseUrl, method, path, { cookie: cookies.adminB, body });
      assert.equal(res.status, 404, `${method} ${path}`);
    }

    const aSees = await request(baseUrl, "GET", "/api/documents", { cookie: cookies.adminA });
    assert.ok(!aSees.data.some((d) => d.id === documentB));
    const aPatchB = await request(baseUrl, "PATCH", `/api/documents/${documentB}`, {
      cookie: cookies.adminA,
      body: { title: "Gehackt" }
    });
    assert.equal(aPatchB.status, 404);

    const unchanged = await request(baseUrl, "GET", `/api/products/${productA}/documents`, { cookie: cookies.adminA });
    assert.equal(unchanged.data.find((d) => d.id === documentId).title, "Handleiding v2");
  });

  await t.test("ongeldige ids -> 404", async () => {
    for (const id of ["abc", "0", "-5"]) {
      const res = await request(baseUrl, "PATCH", `/api/documents/${id}`, { cookie: cookies.adminA, body: { title: "x" } });
      assert.equal(res.status, 404, id);
    }
  });

  await t.test("gearchiveerd product: documenten zijn alleen-lezen (409 PRODUCT_ARCHIVED)", async () => {
    const archive = await request(baseUrl, "DELETE", `/api/products/${productA2}`, { cookie: cookies.adminA });
    assert.equal(archive.status, 200);

    const create = await request(baseUrl, "POST", `/api/products/${productA2}/documents`, {
      cookie: cookies.adminA,
      body: { title: "Te laat", type: "other", url: "https://example.com/laat.pdf" }
    });
    assert.equal(create.status, 409);
    assert.equal(create.data.error.code, "PRODUCT_ARCHIVED");

    const docs = await request(baseUrl, "GET", `/api/products/${productA2}/documents`, { cookie: cookies.adminA });
    assert.equal(docs.status, 200);
    const archivedDoc = docs.data[0];
    const patch = await request(baseUrl, "PATCH", `/api/documents/${archivedDoc.id}`, {
      cookie: cookies.adminA,
      body: { title: "Nieuw" }
    });
    assert.equal(patch.status, 409);
    assert.equal(patch.data.error.code, "PRODUCT_ARCHIVED");
  });

  await t.test("DELETE -> 204 en audit document_update/document_delete", async () => {
    const res = await request(baseUrl, "DELETE", `/api/documents/${documentId}`, { cookie: cookies.employeeA });
    assert.equal(res.status, 204);

    const again = await request(baseUrl, "DELETE", `/api/documents/${documentId}`, { cookie: cookies.employeeA });
    assert.equal(again.status, 404);

    const list = await request(baseUrl, "GET", `/api/products/${productA}/documents`, { cookie: cookies.adminA });
    assert.ok(!list.data.some((d) => d.id === documentId));

    const audit = await documentAuditRows(documentId);
    assert.deepEqual(
      audit.map((row) => row.action),
      ["document_create", "document_update", "document_delete"]
    );
    assert.ok(audit.every((row) => row.company_id === companyA));
  });
});
