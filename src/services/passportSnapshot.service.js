const crypto = require("crypto");
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getPool } = require("../config/db");
const { isStorageConfigured } = require("../config/storage");
const productsRepo = require("../repositories/products.repository");
const passport = require("./passport.service");
const logger = require("../utils/logger");

// Noodkopie van elk openbaar paspoort. Een gedrukte QR-code moet altijd werken, ook als
// de server onbereikbaar is. Daarom staat van elk openbaar paspoort een zelfstandige
// kopie in de objectopslag (R2):
//   passport-snapshots/<public_id>.html  - leesbare pagina: alle productgegevens, foto en
//                                          logo ingebakken, geen JavaScript, geen server nodig
//   passport-snapshots/<public_id>.json  - machineleesbare versie (zelfde als /api/dpp)
// De Cloudflare Worker (edge/cloudflare) toont deze kopie zodra de server niet (op tijd)
// antwoordt. Normaal ziet niemand de kopie.
//
// Verversen: elke wijziging aan een openbaar paspoort zet de public_id in een wachtrij
// (queueSnapshots, vanuit edgeCache.service); processSnapshots werkt die elke paar
// minuten af en maakt ook ontbrekende kopieën aan (bijv. na de eerste ingebruikname).
// Ongewijzigde inhoud wordt niet opnieuw geschreven (hash).

const PREFIX = "passport-snapshots/";
const MAX_INLINE_IMAGE_BYTES = 250 * 1024;

function enabled() {
  return isStorageConfigured();
}

function snapshotKey(publicId, ext) {
  return `${PREFIX}${String(publicId).toLowerCase()}.${ext}`;
}

// Batch-/item-id → model-id (platte tekst). Leest de Worker als er geen eigen kopie is.
const ALIAS_PREFIX = "passport-aliases/";
function aliasKey(publicId) {
  return `${ALIAS_PREFIX}${String(publicId).toLowerCase()}.txt`;
}

async function queueSnapshots(publicIds) {
  if (!enabled()) return 0;
  const ids = [...new Set(publicIds.filter(Boolean).map((id) => String(id).toLowerCase()))];
  if (!ids.length) return 0;
  const pool = await getPool();
  await pool.query("INSERT INTO dbo.passportsnapshotqueue (public_id) SELECT unnest($1::uuid[])", [ids]);
  return ids.length;
}

// --- HTML ----------------------------------------------------------------------------

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nlNumber(n) {
  return Number(n).toLocaleString("nl-NL");
}

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`;
}

function renderHtml(view, { publicId, passportUrl, photoDataUri, logoDataUri, generatedAt }) {
  const s = view.sustainability || {};
  const c = view.compliance || {};
  const materials = Array.isArray(s.materials) ? s.materials : [];
  const regulations = Array.isArray(c.applicable_regulations) ? c.applicable_regulations : [];
  const badges = [
    c.ce_marked && "CE-markering",
    s.recyclable && "Recyclebaar",
    s.reach_conform && "REACH-conform",
    s.rohs_conform && "RoHS-conform"
  ].filter(Boolean);
  const facts = [
    ["Merk", view.brand],
    ["Model", view.model],
    ["Fabrikant", view.manufacturer],
    ["Land van oorsprong", view.countryOfOrigin],
    ["SKU", view.sku],
    ["GTIN / EAN", view.gtin]
  ].filter(([, v]) => v);
  const sustainability = [
    s.co2_footprint_kg != null && ["CO₂-voetafdruk", `${nlNumber(s.co2_footprint_kg)} kg CO₂-eq`],
    s.co2_reduction_pct != null && ["CO₂-reductie", `${nlNumber(s.co2_reduction_pct)}%`],
    s.recycled_material_pct != null && ["Gerecycled materiaal", `${nlNumber(s.recycled_material_pct)}%`],
    s.expected_lifespan_years != null && ["Verwachte levensduur", `${s.expected_lifespan_years} jaar`]
  ].filter(Boolean);
  const docs = (view.documents || []).filter((d) => d.downloadUrl);
  const factList = (rows) => `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  const section = (title, body) => `<section class="card"><h2>${esc(title)}</h2>${body}</section>`;
  const generated = new Date(generatedAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long", timeStyle: "short" });

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(view.name)} – digitaal productpaspoort</title>
<meta name="robots" content="noindex">
<link rel="alternate" type="application/ld+json" href="/api/dpp/${esc(publicId)}?format=jsonld">
<style>
*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f172a;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{background:#fff;border-bottom:1px solid #e2e8f0}.wrap{max-width:42rem;margin:0 auto;padding:12px 16px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}.top img{height:32px;max-width:10rem;object-fit:contain}
.tag{background:#ecfdf5;color:#065f46;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;white-space:nowrap}
main{max-width:42rem;margin:0 auto;padding:20px 16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:16px;overflow:hidden}
.hero{padding:0}.hero img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#f1f5f9}.hero .body{padding:20px}
.cat{color:#047857;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin:0}h1{font-size:24px;line-height:1.2;margin:4px 0}
h2{font-size:16px;margin:0 0 12px}.muted{color:#475569;font-size:14px;margin:0}.desc{white-space:pre-line;color:#334155;margin:12px 0 0}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.pill{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:999px;padding:3px 10px;font-size:12px}
.pill.slate{background:#f1f5f9;color:#334155;border-color:#e2e8f0}ul.hl{padding-left:18px;margin:12px 0 0;color:#334155}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}.facts div{background:#f8fafc;border-radius:12px;padding:10px 12px}
dt{font-size:12px;color:#64748b}dd{margin:2px 0 0;font-weight:600;font-size:14px;word-break:break-word}
.list{list-style:none;padding:0;margin:0}.list li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #f1f5f9;font-size:14px}
.list li:first-child{border-top:0}.doc a{color:#047857;font-weight:600;text-decoration:none}.small{font-size:12px;color:#64748b}
.notice{background:#fffbeb;color:#78350f;border:1px solid #fde68a;border-radius:12px;padding:12px 16px;font-size:14px;margin-bottom:16px}
.offline{background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe}footer{text-align:center;color:#94a3b8;font-size:12px;padding:16px 0 24px}footer a{color:#64748b}
</style></head><body>
<header><div class="wrap top">${
    logoDataUri ? `<img src="${logoDataUri}" alt="${esc(view.issuer?.name || "")}">` : `<strong>${esc(view.issuer?.name || view.brand || "")}</strong>`
  }<span class="tag">Digitaal productpaspoort</span></div></header>
<main>
<p class="notice offline">Dit is een bewaarde kopie van dit productpaspoort (bijgewerkt ${esc(generated)}). De volledige website is tijdelijk niet bereikbaar; alle productgegevens hieronder zijn geldig. Documenten zijn mogelijk pas weer te openen als de website terug is.</p>
${view.archived ? `<p class="notice">Dit product wordt niet meer actief aangeboden. De gegevens hieronder blijven beschikbaar als naslag.</p>` : ""}
<section class="card hero">${photoDataUri ? `<img src="${photoDataUri}" alt="${esc(view.name)}">` : ""}<div class="body">
${view.categoryLabel ? `<p class="cat">${esc(view.categoryLabel)}</p>` : ""}<h1>${esc(view.name)}</h1>
${view.brand || view.model ? `<p class="muted">${esc([view.brand, view.model].filter(Boolean).join(" · "))}</p>` : ""}
${badges.length ? `<div class="pills">${badges.map((b) => `<span class="pill">✓ ${esc(b)}</span>`).join("")}</div>` : ""}
${view.description ? `<p class="desc">${esc(view.description)}</p>` : ""}
${view.highlights?.length ? `<ul class="hl">${view.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
</div></section>
${facts.length ? section("Productinformatie", factList(facts)) : ""}
${
  sustainability.length || materials.length || s.epd_url
    ? section(
        "Duurzaamheid",
        `${sustainability.length ? factList(sustainability) : ""}${
          materials.length
            ? `<h2 style="margin-top:16px;font-size:14px">Materialen</h2><ul class="list">${materials
                .map((m) => `<li><span>${esc(m.material)}</span>${m.pct != null ? `<span class="small">${esc(m.pct)}%</span>` : ""}</li>`)
                .join("")}</ul>`
            : ""
        }${s.epd_url && /^https?:\/\//i.test(s.epd_url) ? `<p class="small" style="margin-top:12px">Milieuproductverklaring (EPD): ${esc(s.epd_url)}</p>` : ""}`
      )
    : ""
}
${
  c.ce_marked || regulations.length
    ? section(
        "Compliance",
        `<div class="pills">${c.ce_marked ? `<span class="pill">✓ CE-markering</span>` : ""}${regulations.map((r) => `<span class="pill slate">${esc(r)}</span>`).join("")}</div>`
      )
    : ""
}
${
  view.parts?.length
    ? section(
        "Onderdelen",
        `<ul class="list">${view.parts.map((p) => `<li><span>${esc(p.name)}</span>${p.part_number ? `<span class="small">${esc(p.part_number)}</span>` : ""}</li>`).join("")}</ul>`
      )
    : ""
}
${
  docs.length
    ? section(
        "Documenten",
        `<ul class="list doc">${docs
          .map(
            (d) =>
              `<li><a href="${esc(d.downloadUrl)}">${esc(d.title)}</a><span class="small">${esc(
                [d.language ? String(d.language).toUpperCase() : "", formatSize(d.fileSize)].filter(Boolean).join(" · ")
              )}</span></li>`
          )
          .join("")}</ul>`
      )
    : ""
}
<footer>${view.publishedAt ? `<p>Gepubliceerd op ${esc(new Date(view.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }))}</p>` : ""}
<p>Paspoort-ID ${esc(String(publicId).toUpperCase())} · <a href="${esc(passportUrl)}">${esc(passportUrl)}</a></p>
<p>Digitaal productpaspoort via VeriPasso</p></footer>
</main></body></html>`;
}

// --- opslag -------------------------------------------------------------------------

function storage() {
  const blob = require("./blobStorage.service");
  return { client: blob.getClient(), bucket: blob.bucketFor("image"), blob };
}

async function readAsDataUri(key) {
  if (!key) return null;
  try {
    const { client, bucket, blob } = storage();
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (Number(object.ContentLength || 0) > MAX_INLINE_IMAGE_BYTES) return null;
    const buffer = await blob.streamToBuffer(object.Body);
    return `data:${object.ContentType || "image/webp"};base64,${buffer.toString("base64")}`;
  } catch {
    return null; // zonder foto/logo is de kopie nog steeds bruikbaar
  }
}

async function logoDataUri(company) {
  if (company?.logo_blob_name) return readAsDataUri(company.logo_blob_name);
  const legacy = company?.logo;
  return typeof legacy === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(legacy) && legacy.length < MAX_INLINE_IMAGE_BYTES * 1.4 ? legacy : null;
}

async function putObject(key, body, contentType) {
  const { client, bucket } = storage();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store",
      ChecksumAlgorithm: "SHA256"
    })
  );
}

async function deleteSnapshot(productId, publicId) {
  const { client, bucket } = storage();
  for (const ext of ["html", "json"]) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: snapshotKey(publicId, ext) })).catch(() => {});
  }
  const pool = await getPool();
  await pool.query("DELETE FROM dbo.passportsnapshots WHERE public_id = $1", [String(publicId).toLowerCase()]);
  if (productId) await pool.query("DELETE FROM dbo.passportsnapshots WHERE product_id = $1", [productId]);
}

function qrBaseUrl() {
  return (process.env.QR_BASE_URL || process.env.APP_BASE_URL || "https://qr.veripasso.com").replace(/\/+$/, "");
}

// Eén paspoort: kopie schrijven (als de inhoud gewijzigd is) of weghalen (niet meer openbaar).
async function writeSnapshot(publicId) {
  // Batch- of itempaspoort: geen eigen kopie (dat zouden er duizenden kunnen zijn), maar
  // een verwijzing naar de kopie van het model. De Worker volgt die bij een storing.
  const resolved = await require("../repositories/instances.repository").resolvePublicPassport(publicId);
  if (resolved?.instance) {
    await putObject(
      aliasKey(publicId),
      Buffer.from(String(resolved.product.public_id).toLowerCase(), "utf8"),
      "text/plain; charset=utf-8"
    );
    const pool = await getPool();
    for (const table of ["productitems", "productbatches"]) {
      await pool.query(`UPDATE dbo.${table} SET alias_written_at = now() WHERE public_id = $1`, [String(publicId).toLowerCase()]);
    }
    return "alias";
  }
  const product = await productsRepo.getProductByPublicId(publicId);
  if (!product) {
    await deleteSnapshot(null, publicId);
    return "removed";
  }
  const data = await passport.loadPassportData(product);
  const snapshot = passport.snapshotFromData(product, data);
  const id = String(product.public_id).toUpperCase();
  const view = passport.toPublicPageView(snapshot, { urlPublicId: id });
  const json = passport.toDppJson(snapshot, { qrBaseUrl: qrBaseUrl(), lastUpdated: product.updated_at });
  const photoKey = product.photo_thumb_blob_name || product.photo_blob_name || null;
  const companyRow = (await (await getPool()).query("SELECT logo, logo_blob_name FROM dbo.companies WHERE id = $1", [product.company_id])).rows[0];

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ view, json, photoKey, logo: companyRow?.logo_blob_name || (companyRow?.logo ? crypto.createHash("sha1").update(companyRow.logo).digest("hex") : null) }))
    .digest("hex");
  const pool = await getPool();
  const existing = (await pool.query("SELECT content_sha256 FROM dbo.passportsnapshots WHERE product_id = $1", [product.id])).rows[0];
  if (existing?.content_sha256 === hash) return "unchanged";

  const html = renderHtml(view, {
    publicId: id,
    passportUrl: `${qrBaseUrl()}/p/${id}`,
    photoDataUri: photoKey ? await readAsDataUri(photoKey) : null,
    logoDataUri: await logoDataUri(companyRow),
    generatedAt: new Date()
  });
  await putObject(snapshotKey(product.public_id, "html"), Buffer.from(html, "utf8"), "text/html; charset=utf-8");
  await putObject(snapshotKey(product.public_id, "json"), Buffer.from(JSON.stringify(json), "utf8"), "application/json; charset=utf-8");
  await pool.query(
    `INSERT INTO dbo.passportsnapshots (product_id, public_id, content_sha256, written_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (product_id) DO UPDATE SET public_id = EXCLUDED.public_id, content_sha256 = EXCLUDED.content_sha256, written_at = now()`,
    [product.id, String(product.public_id).toLowerCase(), hash]
  );
  return "written";
}

// Wachtrij afwerken + ontbrekende kopieën aanmaken. Max. `limit` paspoorten per run.
async function processSnapshots({ limit = 100 } = {}) {
  if (!enabled()) return { skipped: true };
  const pool = await getPool();
  const queued = (
    await pool.query(
      `SELECT public_id::text AS public_id, MAX(id) AS max_id FROM dbo.passportsnapshotqueue
       GROUP BY public_id ORDER BY MIN(id) LIMIT $1`,
      [limit]
    )
  ).rows;
  const missing =
    queued.length < limit
      ? (
          await pool.query(
            `SELECT p.public_id::text AS public_id FROM dbo.products p
             LEFT JOIN dbo.passportsnapshots s ON s.product_id = p.id
             WHERE s.product_id IS NULL AND p.public_id IS NOT NULL
               AND (p.status = 'published' OR (p.status = 'archived' AND p.published_at IS NOT NULL))
             ORDER BY p.id LIMIT $1`,
            [limit - queued.length]
          )
        ).rows
      : [];

  // Verwijzingen voor batches/items die er nog geen hebben (eenmalig per id).
  const aliasesMissing =
    queued.length + missing.length < limit
      ? (
          await pool.query(
            `SELECT x.public_id::text AS public_id FROM (
               SELECT public_id, product_id FROM dbo.productitems WHERE alias_written_at IS NULL
               UNION ALL SELECT public_id, product_id FROM dbo.productbatches WHERE alias_written_at IS NULL
             ) x JOIN dbo.products p ON p.id = x.product_id
             WHERE p.public_id IS NOT NULL AND p.published_at IS NOT NULL
             LIMIT $1`,
            [limit - queued.length - missing.length]
          )
        ).rows
      : [];
  missing.push(...aliasesMissing);

  const counts = { written: 0, unchanged: 0, removed: 0, alias: 0, failed: 0 };
  for (const row of [...queued, ...missing]) {
    try {
      counts[await writeSnapshot(row.public_id)] += 1;
      if (row.max_id) await pool.query("DELETE FROM dbo.passportsnapshotqueue WHERE public_id = $1 AND id <= $2", [row.public_id, row.max_id]);
    } catch (error) {
      counts.failed += 1;
      logger.error("passport_snapshot_failed", { publicId: row.public_id, errorMessage: error.message });
    }
  }
  return counts;
}

module.exports = { enabled, queueSnapshots, processSnapshots, writeSnapshot, renderHtml, snapshotKey, aliasKey, PREFIX, ALIAS_PREFIX };
