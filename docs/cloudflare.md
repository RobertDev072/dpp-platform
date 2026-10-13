# Cloudflare vóór qr.veripasso.com

Doel: Cloudflare handelt het grootste deel van de openbare QR-bezoeken af, zodat AWS niet
bij elke scan opnieuw werk doet. AWS blijft de basis (Lambda, RDS, S3, CDK); alleen het
QR-domein loopt via Cloudflare (gratis plan).

```
bezoeker ──> Cloudflare (cache, Worker) ──> CloudFront ──> Lambda ──> RDS / S3
              │  /p/<id>        : HTML 2 uur aan de rand, ververst na elke wijziging
              │  /products/*    : productfoto's (1 jaar, objectnamen veranderen nooit)
              │  /api/scan/<id> : Worker telt de scan, AWS krijgt 1x per minuut een bundel
              └  /api/*         : nooit gecachet (beveiligde downloads, API)
```

## Hoe het werkt

| Onderdeel | Waar | Wat |
|---|---|---|
| Paspoortcache | Cloudflare Cache Rule | `/p/<id>` (browser, `Accept: text/html`, zonder query) 2 uur aan de rand. Systemen die JSON/JSON-LD/XML vragen gaan altijd door naar de app. |
| Cache verversen | app + Worker | Bij een nieuwe paspoortversie, archiveren, een nieuwe bedrijfsnaam/-logo of documenten openbaar/privé zet de app de public_id in `dbo.edgecachepurges`. De Worker haalt die elke minuut op via `POST /api/edge/sync` en purget `/p/<ID>` en `/p/<id>`. De Lambda heeft geen internet; daarom gaat het via de Worker. |
| Scans | Worker + Durable Object | De pagina stuurt `POST /api/scan/<id>`. De Worker bewaart de scan en antwoordt direct; elke minuut gaan max. 5.000 scans in bundels van 500 naar `/api/edge/sync`. Tijdstip, user-agent en referrer blijven per scan bewaard. |
| Terugval | route "fail open" | Werkt de Worker niet (of is de gratis limiet op), dan gaat de beacon naar de app, die zelf telt. Er gaat niets verloren. |
| Echt bezoekers-IP | Transform Rule + app | Cloudflare zet `X-Edge-Verify: <geheim>`; alleen dan vertrouwt de app `CF-Connecting-IP` (rate limiting per bezoeker). |
| CloudFront | `cloudflareInFront: true` | CloudFront cachet `/p/*` dan niet meer zelf, anders haalt Cloudflare na een purge een oude kopie op. |

Het gedeelde geheim staat in AWS Secrets Manager (`veripasso-<env>-edge`, door CDK
aangemaakt) en wordt in Cloudflare twee keer gebruikt: als Worker-geheim
`EDGE_SYNC_TOKEN` en in de Transform Rule.

Gratis plan, grenzen: 100.000 Worker-aanvragen per dag (elke scan = 1 aanvraag + 1 Durable
Object-aanvraag, dus circa 50.000 scans per dag). Daarboven valt de Worker terug op de app
(fail open). Meer nodig: Workers Paid ($5 per maand).

## Stap 1 - Cloudflare-account en DNS (verandert nog niets aan het verkeer)

1. Cloudflare-dashboard: **Add a domain** > `veripasso.com` > plan **Free**.
2. Cloudflare leest de DNS-records in. **Vergelijk ze één voor één met TransIP**
   (TransIP > Domeinen > veripasso.com > DNS). Controleer vooral:
   - `@`, `www`, `app`, `qr` (naar CloudFront `d37e3416ndk4p8.cloudfront.net`);
   - MX, SPF/DKIM/DMARC (TXT) voor e-mail;
   - de ACM-validatierecords (`_xxxx.veripasso.com` CNAME naar `...acm-validations.aws`):
     zonder deze verlengt AWS het certificaat niet.
3. Zet **alle** records op **DNS only** (grijze wolk), ook `qr`. Zo blijft alles na de
   overstap precies werken zoals nu.
4. SSL/TLS > Overview: **Full (strict)**.
5. TransIP: zet **DNSSEC uit** (TransIP zet het standaard aan; met DNSSEC aan breekt de
   overstap het domein). Vervang daarna de nameservers door de twee van Cloudflare.
6. Wacht tot Cloudflare de zone **Active** meldt (minuten tot enkele uren). Controleer
   dat app.veripasso.com, de landingspagina, een QR-paspoort en e-mail nog werken.
   DNSSEC kan daarna in Cloudflare weer aan (DNS > Settings), met de DS-record bij TransIP.

## Stap 2 - AWS uitrollen

De code (inclusief de overstap naar Lambda, zie het runbook) staat op `main`.

1. Actions > **AWS pauzeren / hervatten** > `production`, `hervatten` (als gepauzeerd).
2. Actions > **Deploy naar AWS** > `production`.
3. Het gedeelde geheim ophalen (AWS-console > Secrets Manager > `veripasso-production-edge`
   > Retrieve secret value, veld `value`), of:
   ```bash
   aws secretsmanager get-secret-value --secret-id veripasso-production-edge --query SecretString --output text
   ```

## Stap 3 - Cloudflare instellen

**Tiered Cache** - Caching > Tiered Cache > **Smart Tiered Caching Topology** aan (gratis).
Zo vraagt maar één Cloudflare-locatie de pagina op bij AWS, niet elke locatie apart.

**Cache Rules** - Caching > Cache Rules > Create rule (volgorde zoals hieronder):

1. *Paspoorten (HTML)* - Edit expression:
   ```
   (http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/p/") and http.request.uri.query eq "" and any(http.request.headers["accept"][*] contains "text/html"))
   ```
   Cache eligibility: **Eligible for cache**. Edge TTL: **Ignore cache-control header and
   use this TTL** > **2 hours** (het minimum op het gratis plan; wijzigingen worden toch
   direct ververst). Browser TTL: **Respect origin** (1 minuut).
2. *Nooit cachen: API en downloads*:
   ```
   (http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/"))
   ```
   Cache eligibility: **Bypass cache**.

Productfoto's (`/products/*.webp`) en `/_next/static/*` cachet Cloudflare standaard al op
extensie, met de 1 jaar uit de origin-headers; daar is geen regel voor nodig.

**Transform Rule** - Rules > Transform Rules > Modify Request Header > Create rule:
- Expression: `(http.host eq "qr.veripasso.com")`
- **Set static**: header `X-Edge-Verify`, waarde = het geheim uit stap 2.3.

**Rate limiting** - Security > WAF > Rate limiting rules (1 regel gratis):
- Expression: `(http.host eq "qr.veripasso.com" and starts_with(http.request.uri.path, "/api/scan/"))`
- 20 requests per 10 seconden per IP > **Block** 10 seconden. Remt het opblazen van
  scancijfers door bots; echte bezoekers sturen één beacon per weergave.

**API-token voor de Worker** - My Profile > API Tokens > Create Token > Custom token:
permissie **Zone > Cache Purge > Purge**, zone `veripasso.com`. Verder niets.

**Worker uitrollen** (in een terminal, in de projectmap):
```bash
cd edge/cloudflare
npx wrangler login
```
Zet in `wrangler.toml` de `CF_ZONE_ID` (Cloudflare > veripasso.com > Overview, rechterkolom).
```bash
npx wrangler secret put EDGE_SYNC_TOKEN
npx wrangler secret put CF_API_TOKEN
npx wrangler deploy
```
Daarna: Workers & Pages > `veripasso-qr-edge` > Settings > Domains & Routes > route
`qr.veripasso.com/api/scan/*` > failure mode **Fail open (proceed)**.

## Stap 4 - Live: qr.veripasso.com via Cloudflare

DNS > record `qr` > **Proxied** (oranje wolk). Laat `@`, `www` en `app` op DNS only.

## Stap 5 - Testen (direct na stap 4)

Vervang `<ID>` door de public_id van een gepubliceerd paspoort (hoofdletters, zoals op de QR-code).

```bash
curl -s -o /dev/null -D - https://qr.veripasso.com/p/<ID>
```
Twee keer uitvoeren: de tweede keer `cf-cache-status: HIT`.

```bash
curl -s -D - -H "Accept: application/ld+json" https://qr.veripasso.com/p/<ID>
```
JSON-LD, en `cf-cache-status` is **niet** `HIT` (machineleesbaar gaat altijd naar de app).

Verder controleren:
- [ ] Een niet-openbaar document (`/api/public/products/<ID>/documents/<n>/file`): 404, `cf-cache-status: BYPASS`.
- [ ] Een openbaar document: 302 naar een kortlevende S3-link, `BYPASS` (nooit gecachet).
- [ ] `https://qr.veripasso.com/login` stuurt door naar app.veripasso.com; de app zelf loopt niet via Cloudflare.
- [ ] Geen `Set-Cookie` in het antwoord van `/p/<ID>`.
- [ ] Paspoort openen, ~1 minuut wachten: de scan staat in het dashboard. Worker-logs
      (Workers > veripasso-qr-edge > Logs): `edge_sync` met `sent`/`recorded`.
- [ ] Paspoort wijzigen in de app, ~1 minuut wachten: de pagina toont de wijziging
      (eerste keer `cf-cache-status: MISS`). Zelfde voor archiveren.
- [ ] CloudWatch: geen `edge_cache_queue_failed`.

## Terugdraaien

DNS > `qr` > **DNS only** (grijze wolk). Binnen enkele minuten gaat het verkeer weer
rechtstreeks naar CloudFront. Scans worden dan door de app zelf geteld; CloudFront cachet
`/p/*` niet zolang `cloudflareInFront` aan staat. Voor de oude CloudFront-cache:
`cloudflareInFront` op `false` en opnieuw uitrollen.
