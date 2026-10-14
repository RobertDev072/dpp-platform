# QR-scans: wat telt, en wat niet

Stand: 2026-10-14. Productregel: **alleen een echte scan van de QR-code telt**. Openen
vanuit de app, previews, verversen, bots en scripts tellen niet.

## De beperking eerst

Een bezoek na een camera-scan is technisch hetzelfde HTTP-verzoek als een gewoon
webbezoek: een camera-app opent gewoon de URL. VeriPasso kan een camera-scan dus **niet
bewijzen**. Besloten is (2026-10-14) de inhoud van de QR-code niet te wijzigen (geen
kenmerk in de URL). Daarom wordt uitgesloten wat aantoonbaar géén scan is; wat overblijft
telt. Gevolg: iemand die de paspoort-URL deelt of overtypt en opent, telt als scan.

## Hoe het werkt

```
camera opent qr.veripasso.com/p/<ID>
  └─ Cloudflare Worker: pagina uit de cache (2 uur) of van de server
       └─ browser: ScanBeacon beslist of er gemeld wordt ──> POST /api/scan/<ID>
            └─ Worker: bot/andere site? weg. Zelfde apparaat < 30 min? weg. Anders bufferen
                 └─ 1× per minuut gebundeld naar de app (/api/edge/sync) ──> dbo.scanevents
```
Zonder Cloudflare (of als de Worker faalt) gaat de melding rechtstreeks naar de app, die
dezelfde regels toepast (`src/services/scanPolicy.service.js`, `scanDedup.service.js`).

| Situatie | Telt? | Hoe |
|---|---|---|
| QR-code gescand met een telefoon (camera of scanner-app) | **ja**, 1× per apparaat per paspoort per 30 min | — |
| Paspoort openen vanuit de app of het dashboard | nee | interne links hebben `?src=app`; daarnaast telt een bezoek met verwijzer `app.veripasso.com` niet (`components/passport/ScanBeacon.js`) |
| Verversen, terug/vooruit | nee | Navigation Timing (`reload`, `back_forward`) in de browser; daarnaast 30-minutenregel |
| Dubbele verzoeken, retries, dubbelklik | nee | 30-minutenregel op server en Worker (anonieme hash) |
| Linkpreviews (WhatsApp, Slack, Teams, Facebook…) | nee | voeren geen JavaScript uit; daarnaast user-agentfilter |
| Bots, crawlers, scripts (curl, Python…) | nee | user-agentfilter + verplichte browserheader `Sec-Fetch-Site: same-origin` |
| Geautomatiseerde browsers (Selenium, Playwright…) | nee | `navigator.webdriver` |
| Prerender, tabblad op de achtergrond | pas bij zichtbaar worden | `visibilitychange` / `prerenderingchange` |
| Machineleesbaar ophalen (JSON/JSON-LD/XML, `/api/dpp`) | nee | geen camera-scan |
| Pagina uit de cache | ja, als het een scan is | de melding loopt los van de pagina |
| Ongeldige of ingetrokken QR-bestemming | nee | 404; melding wordt geweigerd |

## Privacy en bewaren

- **Niets op het apparaat**: geen cookie, geen localStorage. Daarmee valt het tellen niet
  onder de toestemmingsplicht van artikel 11.7a Telecommunicatiewet.
- **Geen IP-adres opgeslagen.** Voor de 30-minutenregel wordt een anonieme sleutel
  gebruikt: een HMAC/SHA-256 van IP + user-agent + paspoort met een geheim dat **elke dag
  wisselt** en alleen in het geheugen (server) of in de Worker bestaat. Na een dag is de
  sleutel niet meer te herleiden.
- **Per scan opgeslagen** (`dbo.scanevents`): tijdstip, user-agent, verwijzer. Bewaard
  **90 dagen** (besluit 2026-10-14), daarna alleen het aantal per product per dag
  (`dbo.scandaily`, geen persoonsgegevens). Opruimen gebeurt automatisch in het dagelijkse
  onderhoud (`src/services/scanRollup.service.js`).
- Rechtsgrond en vermelding in de privacyverklaring: **nog juridisch te beoordelen** (zie
  `docs/compliance/wettelijke-matrix.md`).

## Bekende beperkingen (bewust)

- Gedeelde of overgetypte links tellen als scan (zie boven).
- Wisselt een telefoon binnen 30 minuten van netwerk (wifi ↔ 4G, of IPv4 ↔ IPv6), dan kan
  een tweede scan geteld worden. Bij een test met curl bleek dit na IPv4/IPv6-wisseling.
- Zeer oude browsers zonder `Sec-Fetch-Site` (o.a. Safari vóór 16.4) worden niet geteld.
- Wie JavaScript uitzet, wordt niet geteld.
- Iemand met kwade bedoelingen kan met een echte browser scans opblazen; de rate limit
  (Cloudflare: 20 meldingen per 10 s per IP) en de 30-minutenregel beperken dat.

## Tests

`tests/scan-policy.test.js` (regels, gelijk patroon in Worker en server, geen opslag op
het apparaat), `tests/roles-accounts-scans.test.js` (scenario I/J/K), `tests/evidence-qr-saas.test.js`
(SCAN-01), `tests/media-scans-snapshots.test.js` (30-minutenregel, samenvatten).
Live gecontroleerd 2026-10-13: 5 meldingen van één apparaat via Cloudflare = 1 scan.
