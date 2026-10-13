# Cloudflare vóór qr.veripasso.com

Doel: (1) een gedrukte QR-code werkt **altijd**, ook als de server plat ligt, en (2)
Cloudflare handelt het grootste deel van de QR-bezoeken af, zodat de server niet bij elke
scan werk doet. Alleen `qr.veripasso.com` loopt via Cloudflare (Proxied); `@`, `www` en
`app` staan op DNS only. Server: [hosting-strato.md](hosting-strato.md).

```
bezoeker ──> Cloudflare ──────────────────────────────> server (Caddy → app → PostgreSQL)
              │ Worker /p/<id>        : pagina 2 uur aan de rand; server traag of plat → noodkopie uit R2
              │ Worker /api/scan/<id> : 1 scan per apparaat per 30 min; 1× per minuut gebundeld naar de app
              │ Cache  foto's/logo's  : 1 jaar (URL met versie), R2 wordt per foto ±1× gelezen
              └ overige /api/*        : nooit gecachet (beveiligde downloads, API)
```

## Hoe het werkt

| Onderdeel | Waar | Wat |
|---|---|---|
| Paspoortpagina | Worker (`edge/cloudflare/src/index.js`) | `/p/<id>` voor browsers 2 uur aan de rand (sleutel = pad). Systemen die JSON/JSON-LD/XML vragen gaan altijd door naar de app. |
| **Noodkopie** | app → R2 → Worker | De app schrijft van elk openbaar paspoort een zelfstandige kopie naar R2 (`passport-snapshots/<id>.html` en `.json`; alle gegevens, foto en logo ingebakken, geen JavaScript). Antwoordt de server niet binnen 6 s of met een serverfout, dan toont de Worker die kopie (header `X-VeriPasso-Noodkopie: 1`). Bijgewerkt binnen ±2 minuten na elke wijziging (`passportSnapshot.service.js`). |
| Cache verversen | app + Worker | Na een wijziging zet de app de public_id in `dbo.edgecachepurges`; de Worker haalt die elke minuut op via `POST /api/edge/sync` en purget `/p/<ID>` en `/p/<id>`. De app heeft zelf geen Cloudflare-sleutel. |
| Scans | Worker + Durable Object | De pagina stuurt `POST /api/scan/<id>`, maar alleen als dit apparaat dit paspoort de laatste 30 minuten niet al meldde (browser). De Worker controleert dat nog eens (anonieme hash van IP + user-agent, dagelijks wisselend, geen IP bewaard) en stuurt elke minuut max. 5.000 scans in bundels naar `/api/edge/sync`. |
| Foto's en logo's | Cache Rule | `/api/public/products/<id>/photo?v=…` en `/logo?v=…`: de app geeft `immutable` (1 jaar) mee; een nieuwe foto krijgt een nieuwe `v`. |
| Terugval | route "fail open" | Werkt de Worker niet (of is de gratis limiet op), dan gaat alles naar de server, die scans zelf telt met dezelfde 30-minutenregel. |
| Echt bezoekers-IP | Transform Rule + app | Cloudflare zet `X-Edge-Verify: <geheim>`; alleen dan vertrouwt de app `CF-Connecting-IP`. |

Het gedeelde geheim `EDGE_SYNC_TOKEN` (lang, willekeurig) staat op drie plekken: in
`deploy/.env` op de server, als Worker-geheim en in de Transform Rule.

**Gratis plan:** 100.000 Worker-aanvragen per dag. Een eerste scan = 2 aanvragen (pagina +
beacon), een refresh = 1. Ruwweg 40.000-50.000 scans per dag gratis; daarboven
Workers Paid ($5 per maand, 10 mln. aanvragen). Bij overschrijding gaat het verkeer
gewoon naar de server (fail open).

## Inrichten

1. **SSL/TLS** > Overview: **Full (strict)** (Caddy heeft een geldig certificaat).
   SSL/TLS > Edge Certificates: **Always Use HTTPS uit** (Caddy stuurt zelf door en heeft
   poort 80 nodig om zijn certificaat te verlengen).
2. **Server**: `EDGE_SYNC_TOKEN` in `deploy/.env`, `docker compose up -d`.
3. **Cache Rules** (Caching > Cache Rules), in deze volgorde:
   1. *Foto's en logo's*: `(http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/public/products/") and (ends_with(http.request.uri.path, "/photo") or ends_with(http.request.uri.path, "/logo")))`
      → Eligible for cache, Edge TTL: **Respect origin**, Browser TTL: **Respect origin**.
   2. *Nooit cachen: overige API*: `(http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/"))` → **Bypass cache**.
4. **Transform Rule** (Rules > Transform Rules > Modify Request Header):
   `(http.host eq "qr.veripasso.com")` → Set static `X-Edge-Verify` = het geheim.
5. **Rate limiting** (Security > WAF, 1 regel gratis):
   `(http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/scan/"))`,
   20 per 10 seconden per IP → Block 10 seconden.
6. **Token voor de Worker** (cache verversen): alleen **Zone > Cache Purge > Purge**, zone `veripasso.com`.
7. **Worker uitrollen**:
   ```bash
   cd edge/cloudflare
   npx wrangler secret put EDGE_SYNC_TOKEN
   npx wrangler secret put CF_API_TOKEN
   npx wrangler deploy
   ```
   Daarna bij beide routes (`qr.veripasso.com/p/*` en `/api/scan/*`) failure mode **Fail open**.
8. **Live**: DNS > `qr` > **Proxied** (oranje wolk).

## Testen

```bash
curl -s -o /dev/null -D - https://qr.veripasso.com/p/<ID>        # 2e keer: cf-cache-status HIT
curl -s -D - -H "Accept: application/ld+json" https://qr.veripasso.com/p/<ID>   # JSON-LD, geen HIT
```
- [ ] Paspoort openen, 5× verversen, 1 minuut wachten: precies **1** scan erbij in het dashboard.
- [ ] Paspoort wijzigen, ±1 minuut wachten: pagina bijgewerkt.
- [ ] Foto: 2e keer `cf-cache-status: HIT`, `cache-control: … immutable`.
- [ ] **Noodkopie**: `docker compose stop app` op de server, paspoort openen → kopie met de
      melding "bewaarde kopie" (header `X-VeriPasso-Noodkopie: 1`); daarna `docker compose start app`.

## Terugdraaien

DNS > `qr` > **DNS only**. Binnen enkele minuten gaat het verkeer weer rechtstreeks naar de
server; de app telt scans dan zelf (zelfde 30-minutenregel). Let op: zonder Cloudflare is
er geen noodkopie bij een storing.
