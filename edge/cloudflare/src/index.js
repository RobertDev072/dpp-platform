// Cloudflare Worker voor het QR-domein (qr.veripasso.com). Zie docs/cloudflare.md.
//
// 1. Scans tellen aan de rand. De paspoortpagina meldt elke weergave met een beacon
//    (POST /api/scan/:publicId). Deze Worker vangt die op, bewaart de
//    scan in een Durable Object en antwoordt meteen; de app wordt niet per scan aangeroepen.
// 2. Elke minuut (cron) stuurt het Durable Object de verzamelde scans in één verzoek naar
//    de app (POST /api/edge/sync). Het antwoord zegt welke paspoorten gewijzigd zijn; die
//    haalt de Worker uit de Cloudflare-cache (purge). De app zelf heeft daarvoor geen Cloudflare-sleutel nodig.
//
// Faalt de Worker (of is de gratis limiet op), dan gaat de beacon gewoon door naar de app,
// die de scan dan zelf registreert (route-instelling "fail open"). Er gaat dus niets
// verloren, alleen de besparing valt tijdelijk weg.

import { DurableObject } from "cloudflare:workers";

const SCAN_PATH = /^\/api\/scan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BATCH_SIZE = 500; // maximum dat /api/edge/sync per verzoek aanneemt
const MAX_ROUNDS = 10; // per cron-run: max. 5.000 scans versturen
const MAX_BUFFERED = 100_000; // bovengrens bij een langere storing van de app
const PURGE_CHUNK = 30; // URL's per purge-verzoek (veilig binnen de limiet van het gratis plan)

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
  }

  add({ publicId, ts, userAgent, referrer }) {
    const buffered = this.sql.exec("SELECT COUNT(*) AS n FROM scans").one().n;
    if (buffered >= MAX_BUFFERED) return false;
    this.sql.exec(
      "INSERT INTO scans (public_id, ts, user_agent, referrer) VALUES (?, ?, ?, ?)",
      publicId,
      ts,
      userAgent,
      referrer
    );
    return true;
  }

  getMeta(key, fallback) {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", key).toArray()[0];
    return row ? row.v : fallback;
  }

  setMeta(key, value) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, String(value));
  }

  async sync() {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = SCAN_PATH.exec(url.pathname);
    // Alles wat geen scan-beacon is, ongewijzigd door naar de origin.
    if (request.method !== "POST" || !match) return fetch(request);
    try {
      const stored = await buffer(env).add({
        publicId: match[1].toLowerCase(),
        ts: Date.now(),
        userAgent: (request.headers.get("user-agent") || "").slice(0, 500) || null,
        referrer: (request.headers.get("referer") || "").slice(0, 1000) || null
      });
      if (!stored) return fetch(request); // buffer vol: de app telt zelf
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch {
      return fetch(request);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      buffer(env)
        .sync()
        .then((summary) => console.log(JSON.stringify({ msg: "edge_sync", ...summary })))
        .catch((error) => console.error(JSON.stringify({ msg: "edge_sync_failed", error: error.message })))
    );
  }
};
