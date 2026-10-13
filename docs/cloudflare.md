# Cloudflare vóór qr.veripasso.com

Doel: Cloudflare handelt het grootste deel van de openbare QR-bezoeken af, zodat de
hosting niet bij elke scan opnieuw werk doet. Alleen het QR-domein loopt via Cloudflare
(gratis plan); de hosting zelf is nog niet gekozen. Zolang er geen hosting is, staat
`qr` in Cloudflare-DNS op **DNS only** en is deze opzet niet actief.

```
bezoeker ──> Cloudflare (cache, Worker) ──> hosting (Next.js + API) ──> PostgreSQL
              │  /p/<id>        : HTML 2 uur aan de rand, ververst na elke wijziging
              │  /api/scan/<id> : Worker telt de scan, de app krijgt 1x per minuut een bundel
              └  /api/*         : nooit gecachet (beveiligde downloads, API)
```

## Hoe het werkt

| Onderdeel | Waar | Wat |
|---|---|---|
| Paspoortcache | Cloudflare Cache Rule | `/p/<id>` (browser, `Accept: text/html`, zonder query) 2 uur aan de rand. Systemen die JSON/JSON-LD/XML vragen gaan altijd door naar de app. |
| Cache verversen | app + Worker | Bij een nieuwe paspoortversie, archiveren, een nieuwe bedrijfsnaam/-logo of documenten openbaar/privé zet de app de public_id in `dbo.edgecachepurges`. De Worker haalt die elke minuut op via `POST /api/edge/sync` en purget `/p/<ID>` en `/p/<id>`. Zo heeft de app zelf geen Cloudflare-sleutel nodig. |
| Scans | Worker + Durable Object | De pagina stuurt `POST /api/scan/<id>`. De Worker bewaart de scan en antwoordt direct; elke minuut gaan max. 5.000 scans in bundels van 500 naar `/api/edge/sync`. Tijdstip, user-agent en referrer blijven per scan bewaard. |
| Terugval | route "fail open" | Werkt de Worker niet (of is de gratis limiet op), dan gaat de beacon naar de app, die zelf telt. Er gaat niets verloren. |
| Echt bezoekers-IP | Transform Rule + app | Cloudflare zet `X-Edge-Verify: <geheim>`; alleen dan vertrouwt de app `CF-Connecting-IP` (rate limiting per bezoeker). |

Het gedeelde geheim (`EDGE_SYNC_TOKEN`) is een lange willekeurige string die je zelf
maakt, bijvoorbeeld:
```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```
Het staat op drie plekken: als geheime variabele van de hosting, als Worker-geheim en in
de Transform Rule. Let op: als de hosting zelf ook een cache vóór `/p/*` heeft, zet die
dan uit; anders haalt Cloudflare na een purge een oude kopie op.

Gratis plan, grenzen: 100.000 Worker-aanvragen per dag (elke scan = 1 aanvraag + 1 Durable
Object-aanvraag, dus circa 50.000 scans per dag). Daarboven valt de Worker terug op de app
(fail open). Meer nodig: Workers Paid ($5 per maand).

## Inrichten (zodra er hosting is)

**1. DNS** - het `qr`-record wijst naar de hosting, nog op **DNS only**. SSL/TLS > Overview:
**Full (strict)**. `@`, `www` en `app` blijven DNS only (ingelogde pagina's hebben niets aan
Cloudflare-cache, en de inlogbeveiliging rekent per IP).

**2. App** - zet `EDGE_SYNC_TOKEN` als geheime variabele bij de hosting en rol uit
(inclusief `npm run migrate`).

**3. Tiered Cache** - Caching > Tiered Cache > **Smart Tiered Caching Topology** aan (gratis).

**4. Cache Rules** - Caching > Cache Rules > Create rule (volgorde zoals hieronder):

1. *Paspoorten (HTML)*:
   ```
   (http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/p/") and http.request.uri.query eq "" and any(http.request.headers["accept"][*] contains "text/html"))
   ```
   Cache eligibility: **Eligible for cache**. Edge TTL: **Ignore cache-control header and
   use this TTL** > **2 hours** (het minimum op het gratis plan; wijzigingen worden toch
   direct ververst). Browser TTL: **Respect origin**.
2. *Nooit cachen: API en downloads*:
   ```
   (http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/"))
   ```
   Cache eligibility: **Bypass cache**.

**5. Transform Rule** - Rules > Transform Rules > Modify Request Header:
expression `(http.host eq "qr.veripasso.com")`, **Set static** header `X-Edge-Verify` =
het geheim.

**6. Rate limiting** - Security > WAF > Rate limiting rules (1 regel gratis):
`(http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/scan/"))`,
20 requests per 10 seconden per IP > **Block** 10 seconden.

**7. API-token voor de Worker** - My Profile > API Tokens > Create Token > Custom token:
alleen **Zone > Cache Purge > Purge**, zone `veripasso.com`.

**8. Worker uitrollen** - zet in [`edge/cloudflare/wrangler.toml`](../edge/cloudflare/wrangler.toml)
`SYNC_URL` (adres van de app) en `CF_ZONE_ID` (Cloudflare > veripasso.com > Overview), dan:
```bash
cd edge/cloudflare
npx wrangler login
npx wrangler secret put EDGE_SYNC_TOKEN
npx wrangler secret put CF_API_TOKEN
npx wrangler deploy
```
Daarna: Workers & Pages > `veripasso-qr-edge` > Settings > Domains & Routes > route
`qr.veripasso.com/api/scan/*` > failure mode **Fail open (proceed)**.

**9. Live** - DNS > `qr` > **Proxied** (oranje wolk).

## Testen (direct na stap 9)

Vervang `<ID>` door de public_id van een gepubliceerd paspoort (hoofdletters, zoals op de QR-code).
```bash
curl -s -o /dev/null -D - https://qr.veripasso.com/p/<ID>
```
Twee keer uitvoeren: de tweede keer `cf-cache-status: HIT`.
```bash
curl -s -D - -H "Accept: application/ld+json" https://qr.veripasso.com/p/<ID>
```
JSON-LD, en `cf-cache-status` is **niet** `HIT`.

- [ ] Niet-openbaar document (`/api/public/products/<ID>/documents/<n>/file`): 404, `BYPASS`.
- [ ] Openbaar document: 302 naar een kortlevende link, `BYPASS`.
- [ ] Geen `Set-Cookie` in het antwoord van `/p/<ID>`.
- [ ] Paspoort openen, ~1 minuut wachten: de scan staat in het dashboard; Worker-logs tonen `edge_sync`.
- [ ] Paspoort wijzigen of archiveren, ~1 minuut wachten: de pagina is bijgewerkt.

## Terugdraaien

DNS > `qr` > **DNS only**. Binnen enkele minuten gaat het verkeer weer rechtstreeks naar de
hosting; de app telt scans dan zelf.
