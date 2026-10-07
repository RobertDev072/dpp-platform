// Live end-to-end-rooktest tegen de echte omgeving (Vercel + Supabase), met
// wegwerp-testaccounts (e2e-<hex>@example.com) die na afloop volledig worden
// opgeruimd: database, Supabase Auth-accounts en Storage-bestanden.
//
// Draai dit na elke infrastructuurwijziging (en eenmalig direct na de migratie):
//   E2E_BASE_URL=https://app.veripasso.com node scripts/e2e-supabase-live.js
// Vereist in .env: DATABASE_URL, SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY van
// dezelfde omgeving als E2E_BASE_URL.
require("dotenv").config();
const crypto = require("crypto");
const { query, closePool } = require("../src/config/db");
const { getSupabaseAdmin, IMAGES_BUCKET, DOCUMENTS_BUCKET } = require("../src/config/supabase");
const { createTestCompany, createTestUser, cleanupTestData } = require("../tests/helpers/fixtures");

const BASE = (process.env.E2E_BASE_URL || "").replace(/\/+$/, "");
const results = [];

function report(step, ok, detail = "") {
  results.push({ ok, step, detail });
  console.log(`${ok ? "✔" : "✘"} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function api(method, path, { cookie, body, redirect } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: redirect || "follow",
    signal: AbortSignal.timeout(60000)
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* tekst/binair */
  }
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : null, location: res.headers.get("location") };
}

async function upload(cookie, requestPath, completePath, buffer, mimeType, fields = {}) {
  const target = await api("POST", requestPath, { cookie, body: { mimeType, size: buffer.length } });
  if (target.status !== 201) return target;
  const put = await fetch(target.data.uploadUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: buffer });
  if (!put.ok) return { status: put.status, data: await put.text() };
  return api("POST", completePath, { cookie, body: { path: target.data.path, ...fields } });
}

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex"
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

(async () => {
  if (!BASE) throw new Error("Zet E2E_BASE_URL (bijv. https://app.veripasso.com).");
  const suffix = crypto.randomBytes(4).toString("hex");
  const companyId = await createTestCompany("E2E Supabase");
  const admin = await createTestUser({ companyId, role: "company_admin" });
  const userIds = [admin.id];
  const authUserIds = [];

  try {
    const health = await api("GET", "/api/health");
    report("Publieke health", health.status === 200 && health.data === "OK", `status ${health.status}`);

    const adminLogin = await api("POST", "/api/auth/login", { body: { email: admin.email, password: admin.password } });
    report("Login lokaal testaccount", adminLogin.status === 200, `status ${adminLogin.status}`);
    const adminCookie = adminLogin.cookie;

    // --- Supabase Auth: account aanmaken, tijdelijk wachtwoord, verplichte wijziging ---
    const email = `e2e-${suffix}@example.com`;
    const created = await api("POST", "/api/users", { cookie: adminCookie, body: { email, role: "company_user", firstName: "E2E" } });
    const authOk = created.status === 201 && Boolean(created.data.auth_user_id) && Boolean(created.data.tempPassword);
    report("Gebruiker aangemaakt in Supabase Auth", authOk, `status ${created.status}`);
    if (created.data?.id) userIds.push(created.data.id);
    if (created.data?.auth_user_id) authUserIds.push(created.data.auth_user_id);

    if (authOk) {
      const temp = await api("POST", "/api/auth/login", { body: { email, password: created.data.tempPassword } });
      report("Tijdelijk wachtwoord → verplichte wijziging", temp.status === 200 && temp.data.mustChangePassword === true);

      const newPassword = `E2e-${crypto.randomBytes(9).toString("base64url")}!`;
      const changed = await api("POST", "/api/auth/change-password", {
        body: { email, currentPassword: created.data.tempPassword, newPassword }
      });
      report("Eigen wachtwoord instellen", changed.status === 200 && Boolean(changed.cookie), `status ${changed.status}`);

      const login = await api("POST", "/api/auth/login", { body: { email, password: newPassword } });
      report("Login met nieuw wachtwoord (Supabase)", login.status === 200, `status ${login.status}`);

      const wrong = await api("POST", "/api/auth/login", { body: { email, password: "fout-wachtwoord-123" } });
      report("Fout wachtwoord geweigerd", wrong.status === 401, `status ${wrong.status}`);

      const blocked = await api("PATCH", `/api/users/${created.data.id}`, { cookie: adminCookie, body: { status: "blocked" } });
      const afterBlock = await api("POST", "/api/auth/login", { body: { email, password: newPassword } });
      report("Geblokkeerd account kan niet inloggen", blocked.status === 200 && afterBlock.status === 401);

      await api("PATCH", `/api/users/${created.data.id}`, { cookie: adminCookie, body: { status: "active" } });
      const reset = await api("POST", `/api/users/${created.data.id}/reset-password`, { cookie: adminCookie });
      const afterReset = await api("POST", "/api/auth/login", { body: { email, password: reset.data?.tempPassword } });
      report("Wachtwoordreset door beheerder werkt", reset.status === 200 && afterReset.data?.mustChangePassword === true);
    }

    // --- Supabase Storage + QR ---
    const product = await api("POST", "/api/products", { cookie: adminCookie, body: { name: `E2E product ${suffix}` } });
    report("Product aangemaakt", product.status === 201, `status ${product.status}`);
    const pid = product.data.id;

    const photo = await upload(adminCookie, `/api/products/${pid}/photo/upload-url`, `/api/products/${pid}/photo`, PNG, "image/png");
    report("Foto direct naar Supabase Storage", photo.status === 200 && Boolean(photo.data.photo_blob_name), `status ${photo.status}`);

    const doc = await upload(
      adminCookie,
      `/api/products/${pid}/documents/upload-url`,
      `/api/products/${pid}/documents/upload`,
      PDF,
      "application/pdf",
      { title: "E2E handleiding", isPublic: true }
    );
    report("Document direct naar Supabase Storage", doc.status === 201 && doc.data.file_size === PDF.length, `status ${doc.status}`);

    const published = await api("POST", `/api/products/${pid}/publish`, { cookie: adminCookie });
    const publicId = published.data?.public_id;
    report("Product gepubliceerd", published.status === 200 && Boolean(publicId));

    const qr = await api("GET", `/api/products/${pid}/qr.svg`, { cookie: adminCookie });
    report("QR-code (SVG) gegenereerd", qr.status === 200 && String(qr.data).startsWith("<svg"));
    const label = await fetch(`${BASE}/api/products/${pid}/qr-label.pdf`, { headers: { Cookie: adminCookie } });
    report("QR-label (PDF) gegenereerd", label.status === 200 && label.headers.get("content-type") === "application/pdf");

    const upper = String(publicId).toUpperCase();
    const page = await fetch(`${BASE}/p/${upper}`);
    const html = await page.text();
    report("Publiek paspoort via QR-URL (hoofdletters)", page.status === 200 && html.includes(`E2E product ${suffix}`), `status ${page.status}`);

    const passport = await api("GET", `/api/public/products/${upper}`);
    const photoRedirect = await api("GET", passport.data.photoUrl, { redirect: "manual" });
    const photoBytes = photoRedirect.location ? Buffer.from(await (await fetch(photoRedirect.location)).arrayBuffer()) : null;
    report("Publieke foto via signed URL", photoRedirect.status === 302 && photoBytes?.equals(PNG));

    const docLink = passport.data.documents?.[0]?.downloadUrl;
    const docRes = docLink ? await fetch(`${BASE}${docLink}`) : null;
    report("Publiek document via signed URL", docRes?.status === 200);

    const scans = await query("SELECT COUNT(*) AS n FROM scan_events WHERE product_id = $1", [pid]);
    report("Scan geregistreerd", scans.rows[0].n >= 1, `${scans.rows[0].n} scan(s)`);
  } catch (error) {
    report("Onverwachte fout", false, error.message);
  } finally {
    // --- Opruimen: Storage, Supabase Auth, database ---
    try {
      const storage = getSupabaseAdmin().storage;
      for (const bucket of [IMAGES_BUCKET, DOCUMENTS_BUCKET]) {
        const { data: products } = await storage.from(bucket).list(String(companyId));
        for (const folder of products || []) {
          const prefix = `${companyId}/${folder.name}`;
          const { data: files } = await storage.from(bucket).list(prefix);
          if (files?.length) await storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`));
        }
      }
      for (const id of authUserIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
      await cleanupTestData({ companyIds: [companyId], userIds });
      report("Opruimen (Storage, Auth, database)", true);
    } catch (error) {
      report("Opruimen (Storage, Auth, database)", false, `${error.message} — draai scripts/cleanup-test-data.js --apply`);
    }
    await closePool();
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n❌ ${failed} stap(pen) mislukt` : "\n✅ Alle stappen geslaagd");
    process.exitCode = failed ? 1 : 0;
  }
})().catch(async (error) => {
  console.error("❌", error.message);
  await closePool().catch(() => {});
  process.exit(1);
});
