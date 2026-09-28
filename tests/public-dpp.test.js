const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
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

// Publieke verzoeken: zonder cookie, met optionele headers (User-Agent, Referer, land).
async function publicGet(baseUrl, urlPath, headers = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, { headers });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, headers: response.headers, data, text };
}

async function scanEvents(productId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("productId", sql.Int, productId)
    .query("SELECT * FROM dbo.ScanEvents WHERE product_id = @productId ORDER BY id");
  return result.recordset;
}

const DTO_KEYS = [
  "publicId",
  "name",
  "brand",
  "manufacturer",
  "model",
  "sku",
  "gtin",
  "category",
  "description",
  "materials",
  "countryOfOrigin",
  "complianceInfo",
  "recyclingInfo",
  "repairInfo",
  "issuer",
  "publishedAt",
  "updatedAt",
  "documents"
].sort();

const DPP_HTML = path.join(__dirname, "..", "public", "dpp.html");

test("publieke DPP: whitelisted DTO, alleen gepubliceerd, scan events zonder IP", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const originalCountryHeader = process.env.SCAN_COUNTRY_HEADER;

  const companyA = await createTestCompany("Public A");
  const adminA = await createTestUser({ companyId: companyA, role: "company_admin" });

  t.after(async () => {
    if (originalCountryHeader === undefined) delete process.env.SCAN_COUNTRY_HEADER;
    else process.env.SCAN_COUNTRY_HEADER = originalCountryHeader;
    await cleanupTestData({ companyIds: [companyA], userIds: [adminA.id] });
    await stopTestServer(server);
    await sql.close();
  });

  const marker = crypto.randomBytes(4).toString("hex");
  const secretNote = `GEHEIM-${marker}`;
  const privateTitle = `PRIVE-${marker}`;
  let cookie;
  let companyName;
  const products = {};

  async function createPublished(name) {
    const created = await request(baseUrl, "POST", "/api/products", {
      cookie,
      body: {
        name,
        sku: `SKU-${marker}`,
        manufacturer: "Fabriek BV",
        brand: "Merk",
        model: "M1",
        gtin: "08712345678906",
        category: "Elektronica",
        description: "Beschrijving",
        materials: "Aluminium",
        countryOfOrigin: "Nederland",
        complianceInfo: "CE, RoHS",
        recyclingInfo: "Inleveren bij milieustraat",
        repairInfo: "Onderdelen 10 jaar leverbaar",
        adminNotes: secretNote
      }
    });
    assert.equal(created.status, 201);
    const published = await request(baseUrl, "POST", `/api/products/${created.data.id}/status`, {
      cookie,
      body: { status: "published" }
    });
    assert.equal(published.status, 200);
    return published.data;
  }

  await t.test("setup: gepubliceerd, gedepubliceerd, gearchiveerd en concept product", async () => {
    cookie = await login(baseUrl, adminA);
    const me = await request(baseUrl, "GET", "/api/auth/me", { cookie });
    companyName = me.data.companyName;

    products.published = await createPublished(`Publiek ${marker}`);

    const publicDoc = await request(baseUrl, "POST", `/api/products/${products.published.id}/documents`, {
      cookie,
      body: { title: "Handleiding", type: "manual", language: "nl", url: "https://example.com/h.pdf", isPublic: true }
    });
    assert.equal(publicDoc.status, 201);
    const privateDoc = await request(baseUrl, "POST", `/api/products/${products.published.id}/documents`, {
      cookie,
      body: { title: privateTitle, type: "other", url: `https://example.com/${marker}-intern.pdf`, isPublic: false }
    });
    assert.equal(privateDoc.status, 201);

    // Oude rij van vóór de URL-validatie: mag ook als is_public = 1 nooit op de pagina komen.
    const pool = await getPool();
    await pool
      .request()
      .input("companyId", sql.Int, companyA)
      .input("productId", sql.Int, products.published.id)
      .query(`
        INSERT INTO dbo.Documents (company_id, product_id, type, title, language, storage_url, is_public)
        VALUES (@companyId, @productId, 'other', 'Legacy', NULL, 'javascript:alert(1)', 1)
      `);

    products.unpublished = await createPublished(`Gedepubliceerd ${marker}`);
    const unpublish = await request(baseUrl, "POST", `/api/products/${products.unpublished.id}/status`, {
      cookie,
      body: { status: "draft" }
    });
    assert.equal(unpublish.status, 200);

    products.archived = await createPublished(`Gearchiveerd ${marker}`);
    const archive = await request(baseUrl, "DELETE", `/api/products/${products.archived.id}`, { cookie });
    assert.equal(archive.status, 200);

    const draft = await request(baseUrl, "POST", "/api/products", { cookie, body: { name: `Concept ${marker}` } });
    assert.equal(draft.status, 201);
    products.draft = draft.data;
  });

  await t.test("gepubliceerd product is zonder login zichtbaar met exact de whitelisted velden", async () => {
    const res = await publicGet(baseUrl, `/api/public/dpp/${products.published.public_id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("set-cookie"), null);

    assert.deepEqual(Object.keys(res.data).sort(), DTO_KEYS);
    assert.equal(res.data.publicId, products.published.public_id);
    assert.equal(res.data.name, `Publiek ${marker}`);
    assert.equal(res.data.countryOfOrigin, "Nederland");
    assert.equal(res.data.complianceInfo, "CE, RoHS");
    assert.equal(res.data.issuer, companyName);
    assert.ok(res.data.publishedAt);
    assert.ok(res.data.updatedAt);

    for (const forbidden of ["id", "company_id", "companyId", "created_by", "createdBy", "updated_by", "updatedBy", "admin_notes", "adminNotes", "status"]) {
      assert.ok(!(forbidden in res.data), `${forbidden} hoort niet in de publieke DTO`);
    }
    assert.ok(!res.text.includes(secretNote), "admin notes lekken niet");
    assert.ok(!res.text.includes(privateTitle), "private documenten lekken niet");
    assert.ok(!res.text.includes(`${marker}-intern`), "private document-URL lekt niet");
    assert.ok(!res.text.includes("javascript:"), "niet-https-links komen nooit op de pagina");

    assert.deepEqual(res.data.documents, [
      { title: "Handleiding", type: "manual", language: "nl", url: "https://example.com/h.pdf" }
    ]);
  });

  await t.test("hoofdletter-UUID werkt ook", async () => {
    const res = await publicGet(baseUrl, `/api/public/dpp/${products.published.public_id.toUpperCase()}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.publicId, products.published.public_id);
  });

  await t.test("gedepubliceerd, gearchiveerd, concept, onbekend en ongeldig -> generieke 404", async () => {
    const before = (await scanEvents(products.unpublished.id)).length;
    const paths = [
      `/api/public/dpp/${products.unpublished.public_id}`,
      `/api/public/dpp/${products.archived.public_id}`,
      `/api/public/dpp/${crypto.randomUUID()}`,
      "/api/public/dpp/not-a-uuid",
      `/api/public/dpp/${products.draft.id}`,
      "/api/public/dpp/00000000-0000-0000-0000-00000000000g",
      `/api/public/dpp/${encodeURIComponent("' OR 1=1 --")}`
    ];
    for (const urlPath of paths) {
      const res = await publicGet(baseUrl, urlPath);
      assert.equal(res.status, 404, urlPath);
      assert.equal(res.data.error.message, "Niet gevonden");
      assert.equal(res.data.error.code, undefined);
    }
    assert.equal((await scanEvents(products.unpublished.id)).length, before, "geen scan voor een 404");
    assert.equal((await scanEvents(products.archived.id)).length, 0);
  });

  await t.test("scan event: bron qr/web, user-agent, alleen origin van de referrer, nooit IP", async () => {
    const productId = products.published.id;
    const before = (await scanEvents(productId)).length;

    const qr = await publicGet(baseUrl, `/api/public/dpp/${products.published.public_id}?src=qr`, {
      "User-Agent": `DPP-Test/${marker} ${"x".repeat(600)}`,
      Referer: "https://verwijzer.example.org/pad/naar/pagina?token=geheim#frag"
    });
    assert.equal(qr.status, 200);

    const web = await publicGet(baseUrl, `/api/public/dpp/${products.published.public_id}?src=iets-anders`, {
      Referer: "javascript:alert(1)"
    });
    assert.equal(web.status, 200);

    const events = (await scanEvents(productId)).slice(before);
    assert.equal(events.length, 2);

    const [qrEvent, webEvent] = events;
    assert.equal(qrEvent.source, "qr");
    assert.equal(qrEvent.referrer, "https://verwijzer.example.org");
    assert.ok(qrEvent.user_agent.startsWith(`DPP-Test/${marker}`));
    assert.equal(qrEvent.user_agent.length, 500);
    assert.equal(qrEvent.country_code, null);
    assert.ok(qrEvent.scanned_at instanceof Date);

    assert.equal(webEvent.source, "web");
    assert.equal(webEvent.referrer, null);

    for (const event of events) {
      assert.ok(!Object.keys(event).some((key) => /(^|_)ip(_|$)|address/i.test(key)), "geen IP-kolom");
      const values = Object.values(event).map((value) => String(value));
      assert.ok(!values.some((value) => /127\.0\.0\.1|::1|::ffff:/.test(value)), "geen IP-adres opgeslagen");
      assert.ok(!values.some((value) => value.includes("geheim")), "geen query uit de referrer");
    }
  });

  await t.test("landcode alleen uit de geconfigureerde proxy-header en alleen als ^[A-Z]{2}$", async () => {
    const productId = products.published.id;
    const url = `/api/public/dpp/${products.published.public_id}`;

    delete process.env.SCAN_COUNTRY_HEADER;
    await publicGet(baseUrl, url, { "X-Test-Country": "NL" });

    process.env.SCAN_COUNTRY_HEADER = "X-Test-Country";
    await publicGet(baseUrl, url, { "X-Test-Country": "NL" });
    await publicGet(baseUrl, url, { "X-Test-Country": "Nederland" });
    await publicGet(baseUrl, url, { "X-Test-Country": "N1" });
    await publicGet(baseUrl, url);

    const events = (await scanEvents(productId)).slice(-5);
    assert.deepEqual(
      events.map((event) => event.country_code),
      [null, "NL", null, null, null]
    );
    delete process.env.SCAN_COUNTRY_HEADER;
  });

  await t.test("een falende scan-insert breekt de pagina niet", async () => {
    const repo = require("../src/repositories/scanEvents.repository");
    const original = repo.recordScanEvent;
    const originalConsoleError = console.error;
    const logged = [];
    repo.recordScanEvent = async () => {
      throw new Error("DB weg");
    };
    console.error = (...args) => logged.push(args.join(" "));
    try {
      const res = await publicGet(baseUrl, `/api/public/dpp/${products.published.public_id}`);
      assert.equal(res.status, 200);
      assert.equal(res.data.name, `Publiek ${marker}`);
    } finally {
      repo.recordScanEvent = original;
      console.error = originalConsoleError;
    }
    assert.ok(logged.some((line) => line.includes("ScanEvent")));
  });

  await t.test("/p/<uuid> serveert de DPP-pagina; ongeldige uuid -> 404", async () => {
    const page = await publicGet(baseUrl, `/p/${products.published.public_id}`);
    if (fs.existsSync(DPP_HTML)) {
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type"), /^text\/html/);
      assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    } else {
      // Track F levert public/dpp.html; tot die tijd is een nette 404 (geen 500) acceptabel.
      assert.equal(page.status, 404);
    }

    for (const bad of ["not-a-uuid", "123", `${products.published.public_id}x`]) {
      const res = await publicGet(baseUrl, `/p/${bad}`);
      assert.equal(res.status, 404, bad);
      if (fs.existsSync(DPP_HTML)) {
        // Een verminkte QR-link toont de nette "niet gevonden"-pagina, geen ruwe JSON-fout.
        assert.match(res.headers.get("content-type"), /^text\/html/, bad);
      }
      // De API blijft een generieke JSON-404 geven.
      const api = await publicGet(baseUrl, `/api/public/dpp/${bad}`);
      assert.equal(api.status, 404, bad);
      assert.equal(api.data.error.message, "Niet gevonden");
    }
  });

  await t.test("publieke API is rate-limited (429 RATE_LIMITED)", async () => {
    let limited = null;
    for (let i = 0; i < 130 && !limited; i += 1) {
      const res = await publicGet(baseUrl, "/api/public/dpp/not-a-uuid");
      if (res.status === 429) limited = res;
    }
    assert.ok(limited, "na 120 verzoeken per minuut volgt een 429");
    assert.equal(limited.data.error.code, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});
