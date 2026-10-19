// Cloudflare Worker voor het QR-domein (qr.veripasso.com). Zie docs/cloudflare.md.
//
// 1. Paspoortpagina's (/p/<id>) aan de rand bewaren (2 uur; de app laat ze na een wijziging
//    direct verversen) en - belangrijkste taak - een gedrukte QR-code ALTIJD laten werken:
//    antwoordt de server niet (op tijd) of met een serverfout, dan toont de Worker de
//    noodkopie van het paspoort uit R2 (passport-snapshots/<id>.html of .json, geschreven
//    door de app, zie src/services/passportSnapshot.service.js).
// 2. Scans tellen aan de rand. De paspoortpagina meldt een weergave met een beacon
//    (POST /api/scan/:publicId). De Worker telt één scan per apparaat per paspoort per
//    30 minuten (refresh telt niet), bewaart die in een Durable Object en antwoordt meteen.
// 3. Elke minuut (cron) gaan de verzamelde scans in één verzoek naar de app
//    (POST /api/edge/sync). Het antwoord zegt welke paspoorten gewijzigd zijn; die haalt
//    de Worker uit de Cloudflare-cache (purge). De app heeft geen Cloudflare-sleutel nodig.
//
// Faalt de Worker (of is de gratis limiet op), dan gaat het verkeer gewoon door naar de
// server ("fail open"); die telt scans dan zelf, met dezelfde 30-minutenregel.

import { DurableObject } from "cloudflare:workers";

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const SCAN_PATH = new RegExp(`^/api/scan/${UUID}$`, "i");
const PASSPORT_PATH = new RegExp(`^/p/${UUID}/?$`, "i");
const BATCH_SIZE = 500; // maximum dat /api/edge/sync per verzoek aanneemt
const MAX_ROUNDS = 10; // per cron-run: max. 5.000 scans versturen
const MAX_BUFFERED = 100_000; // bovengrens bij een langere storing van de app
const PURGE_CHUNK = 30; // URL's per purge-verzoek (veilig binnen de limiet van het gratis plan)
const DEDUP_WINDOW_MS = 30 * 60 * 1000;
const PAGE_CACHE_SECONDS = 2 * 60 * 60;
const ORIGIN_TIMEOUT_MS = 6000;
// Zelfde regels als src/services/scanPolicy.service.js (test: tests/scan-policy.test.js
// controleert dat dit patroon gelijk is): bots, linkpreviews en scripts tellen niet.
const BOT_PATTERN =
  /bot\b|bot\/|crawler|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|linkedin|pinterest|vkshare|quora|outbrain|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|curl\/|wget\/|python-|python\/|go-http|java\/|okhttp|axios|node-fetch|undici|postman|insomnia|httpclient|libwww|scrapy/i;

function isCountableBeacon(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT_PATTERN.test(ua)) return false;
  // Browsers sturen bij een beacon vanaf de paspoortpagina "same-origin"; scripts en andere sites niet.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export class ScanBuffer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      user_agent TEXT,
      referrer TEXT
    )`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    // Anonieme sleutels (hash van dag + IP + user-agent + paspoort) van de laatste 30 minuten.
    this.sql.exec("CREATE TABLE IF NOT EXISTS seen (k TEXT PRIMARY KEY, ts INTEGER NOT NULL)");
  }

  // true = scan bewaard; false = dubbel (zelfde apparaat binnen 30 min) of buffer vol.
  add({ publicId, ts, userAgent, referrer, visitorKey }) {
    if (visitorKey) {
      const last = this.sql.exec("SELECT ts FROM seen WHERE k = ?", visitorKey).toArray()[0];
      if (last && ts - last.ts < DEDUP_WINDOW_MS) return { stored: false, duplicate: true };
      this.sql.exec("INSERT INTO seen (k, ts) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts", visitorKey, ts);
    }
    const buffered = this.sql.exec("SELECT COUNT(*) AS n FROM scans").one().n;
    if (buffered >= MAX_BUFFERED) return { stored: false, duplicate: false };
    this.sql.exec(
      "INSERT INTO scans (public_id, ts, user_agent, referrer) VALUES (?, ?, ?, ?)",
      publicId,
      ts,
      userAgent,
      referrer
    );
    return { stored: true, duplicate: false };
  }

  getMeta(key, fallback) {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", key).toArray()[0];
    return row ? row.v : fallback;
  }

  setMeta(key, value) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, String(value));
  }

  async sync() {
    this.sql.exec("DELETE FROM seen WHERE ts < ?", Date.now() - DEDUP_WINDOW_MS);
    const summary = { sent: 0, recorded: 0, purged: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const rows = this.sql
        .exec("SELECT id, public_id, ts, user_agent, referrer FROM scans ORDER BY id LIMIT ?", BATCH_SIZE)
        .toArray();
      const ack = Number(this.getMeta("purge_ack", "0"));
      const response = await fetch(this.env.SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.EDGE_SYNC_TOKEN}` },
        body: JSON.stringify({
          ack,
          events: rows.map((r) => ({ publicId: r.public_id, ts: r.ts, userAgent: r.user_agent, referrer: r.referrer }))
        })
      });
      if (!response.ok) throw new Error(`sync ${response.status}`);
      const result = await response.json();

      // Verstuurde scans pas weghalen als de app ze heeft aangenomen.
      if (rows.length) this.sql.exec("DELETE FROM scans WHERE id <= ?", rows[rows.length - 1].id);
      summary.sent += rows.length;
      summary.recorded += result.recorded || 0;

      // Cache verversen; pas bij succes bevestigen (ack bij de volgende synchronisatie).
      const purge = result.purge || { purgeId: ack, paths: [] };
      if (purge.paths.length) {
        await purgeUrls(this.env, purge.paths.map((p) => `https://${this.env.QR_HOST}${p}`));
        summary.purged += purge.paths.length;
      }
      if (purge.purgeId > ack) this.setMeta("purge_ack", purge.purgeId);

      if (rows.length < BATCH_SIZE && !purge.paths.length) break;
    }
    return summary;
  }
}

async function purgeUrls(env, urls) {
  for (let i = 0; i < urls.length; i += PURGE_CHUNK) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: JSON.stringify({ files: urls.slice(i, i + PURGE_CHUNK) })
    });
    if (!response.ok) throw new Error(`purge ${response.status}: ${await response.text()}`);
  }
}

function buffer(env) {
  return env.SCAN_BUFFER.get(env.SCAN_BUFFER.idFromName("qr"));
}

// Anonieme bezoekerssleutel: SHA-256 van een geheim + de dag + IP + user-agent + paspoort.
// Het IP-adres wordt niet bewaard en de sleutel is na een dag niet meer te herleiden.
async function visitorKey(request, env, publicId) {
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("cf-connecting-ip") || "";
  const ua = request.headers.get("user-agent") || "";
  const data = new TextEncoder().encode(`${env.EDGE_SYNC_TOKEN}|${day}|${ip}|${ua}|${publicId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function handleScan(request, env, publicId) {
  // Geen echte scan (bot, script, andere site): wel 204, niet tellen.
  if (!isCountableBeacon(request)) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await buffer(env).add({
      publicId,
      ts: Date.now(),
      userAgent: (request.headers.get("user-agent") || "").slice(0, 500) || null,
      referrer: (request.headers.get("referer") || "").slice(0, 1000) || null,
      visitorKey: await visitorKey(request, env, publicId)
    });
    if (!result.stored && !result.duplicate) return fetch(request); // buffer vol: de app telt zelf
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return fetch(request);
  }
}

function wantsMachineReadable(request) {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return !accept.includes("text/html") && /application\/(?:ld\+json|json|xml)/.test(accept);
}

async function handlePassport(request, env, publicId) {
  const machine = wantsMachineReadable(request);
  const url = new URL(request.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORIGIN_TIMEOUT_MS);
  try {
    // Browsers: pagina aan de rand bewaren (sleutel = pad, zonder query). Systemen die
    // JSON/JSON-LD/XML vragen: altijd actueel van de server.
    const response = await fetch(
      request,
      machine
        ? { signal: controller.signal }
        : { signal: controller.signal, cf: { cacheEverything: true, cacheTtl: PAGE_CACHE_SECONDS, cacheKey: `${url.origin}${url.pathname}` } }
    );
    if (response.status < 500) return response;
  } catch {
    // time-out of server onbereikbaar: noodkopie
  } finally {
    clearTimeout(timer);
  }
  return serveSnapshot(env, publicId, machine);
}

async function serveSnapshot(env, publicId, machine) {
  try {
    let object = await env.PASSPORTS.get(`passport-snapshots/${publicId}.${machine ? "json" : "html"}`);
    if (!object) {
      // Batch- of itempaspoort: verwijzing naar het modelpaspoort volgen (dezelfde
      // productgegevens; serie-/lotnummer ontbreken dan tijdelijk in de noodkopie).
      const alias = await env.PASSPORTS.get(`passport-aliases/${publicId}.txt`);
      const modelId = alias ? (await alias.text()).trim().toLowerCase() : "";
      if (/^[0-9a-f-]{36}$/.test(modelId)) {
        object = await env.PASSPORTS.get(`passport-snapshots/${modelId}.${machine ? "json" : "html"}`);
      }
    }
    if (object) {
      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": machine ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-VeriPasso-Noodkopie": "1",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
  } catch {
    // ook de opslag onbereikbaar: nette melding hieronder
  }
  return new Response(
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Productpaspoort tijdelijk niet beschikbaar</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0f172a"><h1 style="font-size:20px">Productpaspoort tijdelijk niet beschikbaar</h1>` +
      `<p>Dit digitale productpaspoort is op dit moment niet bereikbaar. Probeer het over enkele minuten opnieuw.</p><p style="color:#64748b;font-size:13px">VeriPasso · ${publicId.toUpperCase()}</p></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" } }
  );
}

// --- bewaking (draait op Cloudflare, dus ook als STRATO volledig plat ligt) ------------------
// Elke 5 minuten: app, database, website, noodkopieën en capaciteit/back-ups. Bij een
// verandering (storing of herstel) een pushbericht via ntfy (geheim onderwerp NTFY_TOPIC,
// als Worker-geheim); zolang een storing duurt elk uur een herinnering; elke ochtend om
// 08:00 (NL) een korte "alles in orde". Zonder NTFY_TOPIC wordt alleen gelogd.
const APP = "https://app.veripasso.com";
const CHECKS = [
  {
    key: "app",
    label: "App (app.veripasso.com)",
    url: `${APP}/api/health`,
    advice: "STRATO-server of de app ligt eruit. QR-paspoorten werken via de noodkopie. Zie noodplan scenario 1; bij langer dan 1 uur: scenario 5b (herstel op Hetzner)."
  },
  {
    key: "database",
    label: "Database",
    url: `${APP}/api/health/ready`,
    advice: "De app draait maar de database reageert niet. Zie noodplan scenario 4 (data kwijt of beschadigd)."
  },
  {
    key: "website",
    label: "Website (www.veripasso.com)",
    url: "https://www.veripasso.com/",
    advice: "De landingspagina is onbereikbaar (zelfde server als de app)."
  },
  {
    key: "capacity",
    label: "Capaciteit en back-ups",
    url: `${APP}/api/health/capacity`,
    advice: "Schijf, geheugen, certificaat of back-up vraagt aandacht. Bekijk Systeemstatus in de app."
  }
];

async function probe(check) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(check.url, { signal: controller.signal, redirect: "manual", headers: { "User-Agent": "VeriPasso-monitor" }, cf: { cacheTtl: 0 } });
    const body = (await res.text()).slice(0, 200);
    return res.status < 400 || res.status === 301 || res.status === 302 ? { ok: true } : { ok: false, detail: `HTTP ${res.status} ${body}`.trim() };
  } catch (error) {
    return { ok: false, detail: error.name === "AbortError" ? "geen antwoord binnen 10 s" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

// JSON-publicatie (UTF-8-veilig, geen headerbeperkingen). Elke mislukte aflevering wordt
// gelogd (Cloudflare-logboek), zodat een stille fout opvalt.
const PRIORITY = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
async function notify(env, { title, message, priority = "default", tags = "" }) {
  if (!env.NTFY_TOPIC) {
    console.error(JSON.stringify({ msg: "notify_skipped", reason: "NTFY_TOPIC ontbreekt", title }));
    return false;
  }
  try {
    const res = await fetch("https://ntfy.sh/", {
      method: "POST",
      // Met NTFY_TOKEN (eigen ntfy-account) telt het quotum per account i.p.v. per
      // (gedeeld) Cloudflare-IP; zonder token weigert ntfy.sh vaak.
      headers: { "Content-Type": "application/json", ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
      body: JSON.stringify({ topic: env.NTFY_TOPIC, title, message, priority: PRIORITY[priority] || 3, tags: tags ? tags.split(",") : [] })
    });
    if (!res.ok) {
      console.error(JSON.stringify({ msg: "notify_failed", status: res.status, body: (await res.text()).slice(0, 200), title }));
      return false;
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({ msg: "notify_failed", error: error.message, title }));
    return false;
  }
}

async function monitor(env, now = new Date()) {
  const stub = buffer(env);
  const results = [];
  for (const check of CHECKS) results.push({ check, ...(await probe(check)) });
  // Noodkopieën: staan er paspoortkopieën in R2 (zonder die kan de QR-terugval niets tonen)?
  let snapshotsOk = true;
  try {
    const list = await env.PASSPORTS.list({ prefix: "passport-snapshots/", limit: 1 });
    snapshotsOk = list.objects.length > 0;
  } catch {
    snapshotsOk = false;
  }
  results.push({
    check: { key: "snapshots", label: "Noodkopieën QR-paspoorten (R2)", advice: "Bij een serverstoring kunnen QR-codes niets tonen. Controleer Cloudflare R2." },
    ok: snapshotsOk,
    detail: snapshotsOk ? "" : "geen noodkopieën gevonden"
  });

  const down = results.filter((r) => !r.ok);
  for (const r of results) {
    const before = await stub.getMeta(`mon:${r.check.key}`, "ok");
    const since = Number(await stub.getMeta(`mon:${r.check.key}:since`, "0"));
    const lastAlert = Number(await stub.getMeta(`mon:${r.check.key}:alert`, "0"));
    if (!r.ok && before === "ok") {
      await stub.setMeta(`mon:${r.check.key}`, "down");
      await stub.setMeta(`mon:${r.check.key}:since`, String(now.getTime()));
      await stub.setMeta(`mon:${r.check.key}:alert`, String(now.getTime()));
      await notify(env, {
        title: `STORING: ${r.check.label}`,
        message: `${r.detail}\n\nWat nu: ${r.check.advice}`,
        priority: r.check.key === "capacity" ? "high" : "urgent",
        tags: "rotating_light"
      });
    } else if (!r.ok && now.getTime() - lastAlert > 60 * 60 * 1000) {
      await stub.setMeta(`mon:${r.check.key}:alert`, String(now.getTime()));
      const minutes = Math.round((now.getTime() - since) / 60000);
      await notify(env, { title: `Nog steeds storing (${minutes} min): ${r.check.label}`, message: `${r.detail}\n\nWat nu: ${r.check.advice}`, priority: "high", tags: "warning" });
    } else if (r.ok && before === "down") {
      await stub.setMeta(`mon:${r.check.key}`, "ok");
      const minutes = Math.round((now.getTime() - since) / 60000);
      await notify(env, { title: `Hersteld: ${r.check.label}`, message: `Weer bereikbaar na ongeveer ${minutes} minuten.`, tags: "white_check_mark" });
    }
  }
  // Eenmalige proefmelding via exact dezelfde weg als een storing (MONITOR_TEST_ID wijzigen = opnieuw).
  if (env.MONITOR_TEST_ID && (await stub.getMeta("mon:test", "")) !== env.MONITOR_TEST_ID) {
    if (await notify(env, { title: "VeriPasso: proef van de storingsmelding", message: "Deze melding komt van de bewaking in Cloudflare (los van STRATO). Bij een echte storing krijg je hier bericht met wat eruit ligt.", priority: "high", tags: "bell" })) {
      await stub.setMeta("mon:test", env.MONITOR_TEST_ID);
    }
  }
  // Dagelijkse bevestiging om 06:00 UTC (08:00 NL zomertijd): de bewaking leeft.
  const today = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === 6 && (await stub.getMeta("mon:daily", "")) !== today) {
    await stub.setMeta("mon:daily", today);
    await notify(env, {
      title: down.length ? `VeriPasso: ${down.length} probleem/problemen` : "VeriPasso: alles in orde",
      message: down.length ? down.map((r) => `• ${r.check.label}: ${r.detail}`).join("\n") : "App, database, website, noodkopieën en back-ups: OK.",
      tags: down.length ? "warning" : "white_check_mark"
    });
  }
  return results.map((r) => ({ key: r.check.key, ok: r.ok, detail: r.detail || "" }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const scan = SCAN_PATH.exec(url.pathname);
    if (request.method === "POST" && scan) return handleScan(request, env, scan[1].toLowerCase());
    const passport = PASSPORT_PATH.exec(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && passport) {
      return handlePassport(request, env, passport[1].toLowerCase());
    }
    // Al het andere ongewijzigd door naar de server.
    return fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      buffer(env)
        .sync()
        .then((summary) => console.log(JSON.stringify({ msg: "edge_sync", ...summary })))
        .catch((error) => console.error(JSON.stringify({ msg: "edge_sync_failed", error: error.message })))
    );
    const now = new Date(event.scheduledTime || Date.now());
    if (now.getUTCMinutes() % 5 === 0) {
      ctx.waitUntil(
        monitor(env, now)
          .then((results) => console.log(JSON.stringify({ msg: "monitor", results })))
          .catch((error) => console.error(JSON.stringify({ msg: "monitor_failed", error: error.message })))
      );
    }
  }
};
