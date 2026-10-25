# VeriPasso (DPP Platform)

Multi-tenant SaaS-platform voor Digital Product Passports (DPP) in de EU.
Bedrijven beheren hun producten, documenten en QR-codes in een eigen, volledig
geïsoleerde omgeving; consumenten scannen een QR-code en zien het publieke
productpaspoort zonder account. Systemen kunnen hetzelfde paspoort op dezelfde URL
machineleesbaar opvragen (JSON, JSON-LD, XML).

Laatst bijgewerkt: 2026-10-21 (avond). **Status: live.** Applicatie en database op een eigen Linux-server
(STRATO, Duitsland), bestanden en QR-rand bij Cloudflare (EU), derde back-up bij Hetzner (Finland).
Bewaking met pushmeldingen en een geteste noodherstelprocedure: zie §7.

Domeinen (DNS bij Cloudflare):

| Adres | Rol |
|---|---|
| https://www.veripasso.com (en veripasso.com) | landingspagina |
| https://app.veripasso.com | de SaaS-applicatie (inloggen, dashboards, beheer) |
| https://qr.veripasso.com | QR-scans en publieke productpaspoorten (permanent: staat op elke gedrukte code) |

Documentatie:

| Onderwerp | Document |
|---|---|
| **Alle functies, in gewone taal** | **[docs/functies.md](docs/functies.md)** |
| **Wat de eigenaar nog moet doen** | **[docs/checklist-eigenaar.md](docs/checklist-eigenaar.md)** |
| Hoe alles in elkaar zit | **[docs/infrastructuur.md](docs/infrastructuur.md)** |
| Bij storingen | **[docs/noodplan.md](docs/noodplan.md)** |
| Serverbeheer (STRATO) | [docs/hosting-strato.md](docs/hosting-strato.md) |
| Cloudflare vóór qr.veripasso.com | [docs/cloudflare.md](docs/cloudflare.md) |
| DPP-datamodel en B2B-API | [docs/dpp-datamodel.md](docs/dpp-datamodel.md), [docs/api-v1.md](docs/api-v1.md) |
| Back-up-dienstverlener en EU-register | [docs/eu-register-en-backup.md](docs/eu-register-en-backup.md) |
| Rollen, accounts en QR-scans | [docs/accounts.md](docs/accounts.md), [docs/scans.md](docs/scans.md) |
| Wet en normen | [docs/compliance/wettelijke-matrix.md](docs/compliance/wettelijke-matrix.md), [normmatrix](docs/compliance/requirements-matrix.md) |
| Juridische documenten (concepten) | [docs/juridisch/](docs/juridisch/) |
| Tests en hersteltest | [docs/verification/](docs/verification/) |

---

## 1. Businessmodel en rollen

VeriPasso wordt op twee manieren verkocht:

- **Route A — via een Partner/Reseller** (bijv. een certificatie-instelling): de partner
  onboardt klantbedrijven, wijst een (door de owner opengesteld) abonnement toe
  en nodigt de eerste beheerder uit. De partner beheert **nooit** producten,
  documenten of gebruikerslijsten van klanten.
- **Route B — direct**: de Platform Owner maakt het klantbedrijf handmatig aan,
  wijst een abonnement toe en nodigt de eerste beheerder uit.

### Rollenmodel (technische naam → UI-label)

| Rol | UI-label | Kort |
|---|---|---|
| `platform_owner` | Platform Owner | Precies één account (geseed). Ziet en beheert alles. Voor alle anderen onzichtbaar (API geeft 404, geen 403). |
| `partner_admin` | Partner Admin | Alleen door de owner toekenbaar, alleen op een bedrijf met `kind='partner'`. Werkt in `/partner`. |
| `company_admin` | Bedrijfsbeheerder | Beheert het eigen bedrijf: medewerkers, producten, documenten, export. |
| `company_user` | Medewerker | Werkt aan producten/documenten/QR van het eigen bedrijf. |

Aanvullende regels (in code én database): soft delete van gebruikers
(`active/blocked/suspended/archived/deleted`); per bedrijf altijd ≥ 1 actieve
Bedrijfsbeheerder; company-rollen niet op een partnerbedrijf en andersom;
impersonatie ("Inloggen als") max. 1 uur, nooit genest, volledig in de auditlog.

Licenties: `src/services/license.service.js` is de enige bron van waarheid. Een
verlopen licentie blokkeert alleen **aanmaken**; bestaande data en publieke paspoorten
blijven werken (ook verplicht vanuit DPP-persistentie, zie §3).

---

## 2. Authenticatie

- **Login** volledig server-side: e-mail + wachtwoord tegen een bcrypt-hash in
  `dbo.users`; een geslaagde login geeft een eigen sessie (httpOnly-cookie,
  `SameSite=Lax`, alleen de sha256-hash van het token in `dbo.sessions`).
- **Tweestapsverificatie (TOTP)**, optioneel per account, sterk aanbevolen voor
  beheerders. Instellen via het eigen profiel (QR-code + eerste code + 10 eenmalige
  herstelcodes). Na het wachtwoord geeft de API alleen een kortlevend ondertekend
  ticket; pas met een geldige code ontstaat een sessie. Codes zijn eenmalig
  (replaybescherming), geheimen staan AES-256-GCM-versleuteld in de database.
  Beheerders kunnen MFA van een gebruiker resetten (`POST /api/users/:id/mfa/reset`).
- **Tijdelijke wachtwoorden**: bij aanmaak/reset; inloggen daarmee geeft eerst de
  verplichte wachtwoordwijziging (met MFA ook de code, zodat een reset MFA niet omzeilt).
- **Geen e-mailverzending** (bewuste keuze): "Wachtwoord vergeten" verwijst naar de
  beheerder; uitnodigingslinks worden handmatig gedeeld.
- Bescherming: rate limiting (login, MFA, resets, publieke API), 1,2 s vloer op mislukte
  logins, dummy-bcrypt bij onbekende accounts, gesaneerde gestructureerde logging.

---

## 3. Producten, paspoorten, documenten en QR

- Producten per tenant met duurzaamheid, compliance, onderdelen, batches en documenten;
  compleetheid op 7 criteria; bulkacties, export naar Excel en QR-downloads (PNG/SVG/ZIP).
- **Uploads** (foto's ≤ 15 MB, verkleind opgeslagen; documenten PDF/JPEG/PNG/SVG/WEBP ≤ 25 MB)
  gaan rechtstreeks van de browser naar **privé buckets in S3-compatibele opslag**
  (live: Cloudflare R2; lokaal bijv. MinIO; zonder ingestelde opslag staan uploads uit):
  1. `POST /api/products/:id/{photo|documents}/upload-url`: rol, tenant, type en grootte
     worden gecontroleerd; de server geeft een **presigned PUT** voor precies één object
     (`products/{productId}/{uuid}.{ext}`); type en exacte grootte zitten in de handtekening,
     dus de opslag dwingt ze af (werkt ook met Cloudflare R2, dat geen presigned POST kent);
  2. de browser stuurt het bestand naar de opslag;
  3. `POST .../complete`: de server controleert het object (HeadObject) en koppelt het.
- **Downloads**: eigen stabiele API-route → toegangscontrole → presigned URL (5 minuten).
  Objecten worden nooit overschreven of door de app verwijderd (zet bij de opslag
  versioning aan als tweede slot).
- **QR**: formaat `{QR_BASE_URL}/p/{PUBLIC_ID}` met `QR_BASE_URL=https://qr.veripasso.com`.
  De GUID staat in **hoofdletters** (zo staat hij op de gedrukte codes); opzoeken werkt
  hoofdletterongevoelig. In de app heeft een product **één QR-code** (het model). Batch- en
  exemplaarpaspoorten (eigen permanente id per productieronde of serienummer) bestaan technisch
  nog en bestaande codes blijven werken, maar het tabblad is op 2026-10-25 uit de app gehaald
  (te ingewikkeld); aanmaken kan alleen nog via de API. Vrije ruimte 4 modules (ISO/IEC 18004); ook **Data Matrix** (ISO/IEC 16022) en
  **GS1 Digital Link** (`qr.veripasso.com/01/{GTIN}/10/{lot}/21/{serie}`, met resolver).
  `qr.veripasso.com` nooit weghalen of laten verlopen.
- **Persistentie**: gepubliceerde paspoorten blijven publiek, ook na archiveren (met
  melding) en ongeacht licentie- of bedrijfsstatus. Een gepubliceerd paspoort kan niet
  terug naar concept (409 `PASSPORT_PERSISTENCE`); een gearchiveerd concept met
  gereserveerde QR wordt nooit openbaar.
- **Versie-archief (EN 18221 §4.2)**: elke inhoudelijke wijziging van een paspoort dat op
  de markt is, wordt een onveranderlijke versie in `dbo.passportversions` (SHA-256 van de
  inhoud + hash-keten; UPDATE/DELETE/TRUNCATE geweigerd door een trigger). Opvragen:
  - publiek (alleen openbare velden): `GET /api/dpp/:publicId/versions`,
    `/api/dpp/:publicId/versions/:n`, `/api/dpp/:publicId?at=<ISO-tijdstip>`;
  - eigen bedrijf (incl. niet-openbare documentmetadata): `GET /api/products/:id/versions`,
    `/versions/:n`, `/versions/verify` (ketencontrole).
- **Machineleesbaar paspoort (EN 18216 §5)**: `GET /api/dpp/:publicId` met
  content negotiation (`application/json`, `application/ld+json`, `application/xml`) of
  `?format=json|jsonld|xml`; een browser wordt naar de HTML-pagina gestuurd. Ook de
  gedrukte URL `/p/:publicId` levert JSON/JSON-LD/XML als het systeem daarom vraagt.
- **Export voor replicatie/back-up-dienstverlener (EN 18221 §4.5)**:
  `GET /api/products/passports/export` (Company Admin; owner met `?companyId=`) levert
  NDJSON met alle paspoorten, de actuele stand en alle versies incl. hashes.
- **DPP-header en interoperabiliteit**: `digitalProductPassportId`, `uniqueProductIdentifier`,
  `granularity`, `dppSchemaVersion`, `dppStatus`, `lastUpdated`, `economicOperatorId` (LEI/GLN/
  KvK/btw, per bedrijf), `facilityId`, `contentSpecificationIds`, meertalige naam/omschrijving,
  `dataElements` met `dictionaryReference`, `relatedResources`. Zie docs/dpp-datamodel.md.
- **B2B-API `/api/v1`** met API-sleutels per bedrijf (ReadDPPById, ReadDPPByProductId,
  ReadDPPIdsByProductIds, CreateDPP, UpdateDPPById, DeleteDPPById, Read/UpdateDataElement,
  RegisterProductDPP); OpenAPI op `/api/v1/openapi.json`. Zie docs/api-v1.md.
- **UPI**: `uniqueProductIdentifier` is altijd een persistente https-URL die naar het paspoort
  leidt (GS1 Digital Link op `qr.veripasso.com` met de GTIN erin, anders de paspoort-URL).
- **Toegang per niveau**: publiek, professional (reparateurs, recyclers) en autoriteit, via
  toegangstokens (`vpa_…`) die het bedrijf uitgeeft; per document *Zichtbaar voor*. Antwoorden
  met een token worden nooit gedeeld gecachet. Zie docs/dpp-datamodel.md.
- **EU DPP-register**: de klant registreert zelf (EU Login + QSeal). VeriPasso levert de
  registratiegegevens (UPI en modelnummer; CSV-werklijst), controleert ze vooraf en
  legt de uitkomst vast (URI, correlation ID, status, foutcode, paspoortversie). Productgroep per
  product (registerkaart alleen actief bij batterijen); verificatiedatums van het bedrijf met een
  melding 60 dagen voor het verlopen. Zie docs/eu-register-en-backup.md en de
  [checklist voor klanten](docs/eu-register-checklist-klant.md).
- **Back-up-dienstverlener**: koppeling gebouwd, staat uit tot er een partij is.
- **Scans**: alleen echte QR-scans tellen (niet vanuit de app, geen refresh, geen bots;
  1× per apparaat per paspoort per 30 minuten; geen IP, niets op het apparaat). Zie docs/scans.md.

---

## 4. Menu's per rol

- **Platform Owner**: Overzicht, Partners, Klantbedrijven, Organisaties & gebruikers (boom partners → klantbedrijven → gebruikers, server-side gepagineerd),
  Abonnementen, Auditlog, Systeemstatus, Instellingen.
- **Partner Admin**: Overzicht, Mijn klanten, Uitnodigingen, Licenties, Activiteiten,
  Instellingen, Help & support.
- **Bedrijfsbeheerder**: Overzicht, Producten, Documenten, QR-codes, Medewerkers,
  Abonnement, Bedrijfsinstellingen, Help & support.
- **Medewerker**: Overzicht, Producten, Documenten, QR-codes, Mijn profiel, Help & support.

Menu's verbergen is UI-comfort; élk endpoint dwingt de rol ook server-side af.

---

## 5. Monitoring

- **Owner-dashboard** `/admin/systeemstatus`: request-telemetrie in-process (alleen
  tellers en duur, routes genormaliseerd), elke ~5 minuten per serverproces weggeschreven naar
  `SystemRequestMetricsHourly`; dagelijkse snapshot (DB-grootte, tabellen, opslag per
  bucket/extensie) en opschonen van oude telemetrie.
- **Achtergrondtaken**: timers in het serverproces (`instrumentation.js` →
  `src/monitoring/scheduler.js`). Het dagelijkse onderhoud gebruikt een lease-lock in
  `dbo.joblocks`, zodat er altijd precies één proces het doet. Het onderhoud vult ook
  ontbrekende paspoortversies aan.
- **Scans**: de publieke paspoortpagina meldt een scan met een lichte beacon
  (`POST /api/scan/:id`), zodat scans ook kloppen als Cloudflare de pagina uit de cache
  serveert; de Worker ontdubbelt en bundelt (docs/scans.md, docs/cloudflare.md).
- **Health**: `GET /api/health` (liveness, alleen `OK`) en `GET /api/health/ready`
  (database bereikbaar). Gedetailleerd: owner-only `/api/admin/system/health`.
- **Logs**: JSON-regels op stdout (`src/utils/logger.js`); gevoelige velden worden altijd
  gemaskeerd.

---

## 6. Lokale setup

1. Node.js 24, dan `npm ci`.
2. Lokale database starten in een eigen terminal: `npm run db:local` (echte PostgreSQL 17,
   zonder installatie; data in `.localdb/`, poort 5433). **Nooit een productiedatabase.**
3. `.env` in de projectroot (wordt nooit gecommit; zie [`.env.example`](.env.example)):
   ```
   NODE_ENV=development
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/veripasso
   COOKIE_SECRET=<lange random string>
   APP_BASE_URL=http://localhost:3000
   QR_BASE_URL=http://localhost:3000
   # Bestanden (optioneel): S3-compatibele opslag, bijv. MinIO met S3_ENDPOINT,
   # S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY, de twee buckets en S3_FORCE_PATH_STYLE=true.
   # Zonder deze waarden werkt alles behalve foto-/documentuploads.
   ```
4. `npm run test:db` → `npm run migrate` → `npm run seed:owner` (met `SYSTEM_OWNER_*`,
   daarna weer weghalen) → `npm run dev` (http://localhost:3000).

Lokaal is er geen domeinverdeling: alle pagina's (landingspagina, app, paspoorten) staan
op `localhost:3000`.

---

## 7. Infrastructuur, back-ups en noodherstel

Volledig overzicht: **[docs/infrastructuur.md](docs/infrastructuur.md)** · bij storingen:
**[docs/noodplan.md](docs/noodplan.md)** · serverbeheer: [docs/hosting-strato.md](docs/hosting-strato.md).

```
  Scanner / extern systeem ─► Cloudflare (DNS · QR-rand: cache + noodkopie · R2-bestanden, EU)
  Gebruiker (browser) ──────► STRATO-server (Docker: Caddy HTTPS → app → PostgreSQL 17)
                                    │ elke nacht, versleuteld
                                    ▼
                    server · Cloudflare R2 · Hetzner Storage Box (+ snapshots)
```

| Onderdeel | Hoe het werkt |
|---|---|
| **App en database** | Eén Linux-server met Docker (app, PostgreSQL 17, Caddy voor HTTPS). Alleen poort 22/80/443 open, inloggen alleen met sleutel. Uitrollen met `deploy/update.sh` (maakt eerst een back-up); migraties draaien automatisch. |
| **Bestanden** | Foto's en documenten in Cloudflare R2 (EU), privé; downloads via de app met toegangscontrole. |
| **QR-codes** | `qr.veripasso.com` loopt via een Cloudflare Worker: paspoortpagina in de cache, en bij serveruitval een **noodkopie** (ook voor batch- en itemcodes en machineleesbare JSON). Getest: QR-codes blijven werken als de server plat ligt. |
| **Beveiliging** | TLS 1.2+ op alle domeinen, HSTS, rollen en bedrijfsscheiding server-side (getest), MFA beschikbaar, rate limits, auditlog. |
| **Back-ups** | Elke nacht: database versleuteld naar de server, R2 en een **Hetzner Storage Box**; daar ook de configuratie en **alle bestanden, versleuteld**, plus dagelijkse snapshots die vanaf de server niet te wissen zijn. De back-up gebruikt een beperkte sleutel. Een server die na een noodherstel niet meer de actieve is, uploadt geen back-ups meer. |
| **Bewaking** | Cloudflare controleert elke 5 minuten app, database, website, noodkopieën en capaciteit (los van de server); het back-upscript meldt elke fout. Pushmeldingen naar de telefoon; Systeemstatus in de app. |
| **Noodherstel** | In stappen, niets automatisch: diagnose → STRATO herstarten → (alleen als het echt nodig is) nieuwe server bij Hetzner Cloud met alle gegevens uit de back-up → DNS omzetten. Via `scripts/noodherstel.mjs` of het **noodpakket** (ZIP met klikbestanden, buiten git bewaard). Hersteltest 2026-10-19: alles terug in ca. 3 minuten, alle gegevens gelijk aan live ([verslag](docs/verification/hersteltest-2026-10-19.md)). |
| **Code en CI** | GitHub; elke push: tests op PostgreSQL 17, build, beveiligingscontrole, container-rooktest. Reservekopie van de code op de Storage Box. |

Geheimen (wachtwoorden, sleutels, tokens) staan nooit in de repository, alleen op de server
(`deploy/.env`, rechten 600), in het beveiligde gegevensdocument en het noodpakket.
Valkuilen: `QR_BASE_URL` en de DNS van `qr.veripasso.com` nooit wijzigen of verwijderen (staan op
elke gedrukte code); migraties altijd additief.

---

## 8. Projectstructuur (hoofdlijnen)

```
app/                      Next.js App Router (admin, partner, company, login, p/[id] = publiek paspoort)
components/, lib/         UI-componenten en frontend-helpers (lib/api.js incl. presigned upload)
pages/api/[[...path]].js  Eén API-route die alle /api/*-verzoeken aan Express geeft
instrumentation.js        Start achtergrondtaken; nette afsluiting bij SIGTERM
proxy.js                  Domeinverdeling (www / app / qr)
src/
  app.js                  Express: health/readiness, telemetrie, routes
  config/                 db (pg + TLS), storage (S3-compatibel), monitoring, zod-NL
  middleware/             auth, rateLimit, validate, errorHandler
  monitoring/             requestMetrics, collectors, health, scheduler
  repositories/           SQL per entiteit
  routes/                 o.a. products (incl. versies, export), dpp (machineleesbaar + versies),
                          publicProducts, auth (incl. MFA), users, partner, admin, systemMonitoring
  services/               passport (inhoud + JSON/JSON-LD/XML), passportArchive (versies, hash-keten),
                          mfa (TOTP), blobStorage (S3-compatibel), edgeCache (Cloudflare),
                          license, onboarding, scanPolicy, qrCode
  utils/                  logger, roles, tenant, auditLog, password, baseUrl
db/migrations/            PostgreSQL-migraties (oplopend; bijgehouden in dbo.schemamigrations)
deploy/                   Serveropzet: compose.yaml (app + PostgreSQL + Caddy), Caddyfile, .env.example,
                          backup.sh (nachtelijke back-up), update.sh (uitrollen), recover.sh (herstel);
                          Dockerfile in de root
edge/cloudflare/          Cloudflare Worker voor qr.veripasso.com (cache, noodkopie, scans, bewaking)
scripts/                  migrate, seed-system-owner, backfill-passport-versions, local-db,
                          check-db-connection, noodherstel (noodherstel in stappen),
                          maak-noodpakket (ZIP met klikbestanden)
tests/                    node --test (zie §9)
docs/                     zie de tabel bovenaan
```

---

## 9. Tests en verificatie

- `npm test`: volledige suite tegen de database uit `DATABASE_URL`, **altijd een
  testdatabase** (de fixtures ruimen hun eigen data op; paspoortversies worden in tests
  als superuser verwijderd omdat de tabel append-only is). In CI draait de suite tegen een
  tijdelijke PostgreSQL 17-service.
- Live S3-tests (echte upload/download) alleen met `TEST_S3_LIVE=true` en test-buckets;
  de S3-logica zelf is altijd getest met een nep-client (`tests/s3-storage.test.js`).
- Compliance-tests: `tests/passport-compliance.test.js` (ID's verwijzen naar de matrix).
- Regel: nooit uitrollen zonder groene suite; na elke uitrol live controleren
  (inloggen, een gedrukte QR-code scannen, foto/document op een publiek paspoort openen).

---

## 10. Openstaand

Afvinklijst voor de eigenaar (wat jij nog moet doen of beslissen):
**[docs/checklist-eigenaar.md](docs/checklist-eigenaar.md)**. Hieronder het volledige overzicht.

### Organisatie en wet (geen code; zie [docs/compliance/wettelijke-matrix.md](docs/compliance/wettelijke-matrix.md))
- [ ] Juridische concepten invullen, laten controleren en publiceren ([docs/juridisch/](docs/juridisch/)):
      privacyverklaring, algemene voorwaarden, verwerkersovereenkomst, subverwerkers,
      bewaartermijnen, datalekprocedure, verwerkingsregister. Daarna pagina's /privacy en /voorwaarden.
- [ ] Verwerkersovereenkomsten met STRATO, Cloudflare en Hetzner afsluiten/controleren; partnerovereenkomst.
- [ ] Back-up-dienstverlener voor paspoorten contracteren (koppeling gebouwd, staat uit).
- [ ] EU-register: officieel uploadsjabloon (JSON/XML) ophalen uit de testomgeving van het register
      en de bestandsexport daarop bouwen; batterijvelden en openbaarheid per veld (Bijlage XIII)
      zodra de semantische catalogus van de EU er is.
- [ ] Per klant: productgroep en toepasselijke gedelegeerde handeling (ESPR) vaststellen.
- [ ] Certificeerder: toetsing tegen EN 18216–18223 (normteksten niet door AI gelezen i.v.m. de
      EVS-licentie), levensduur paspoort per productgroep, digitale handtekeningen (EN 18246).
- [ ] RPO/RTO als afspraak met klanten vastleggen (nu: max. 1 dag dataverlies, herstel binnen uren).

### Techniek
- [ ] Storingsmeldingen vanuit Cloudflare via Telegram (ntfy heeft een dagquotum voor gedeelde Cloudflare-IP's:
      een proef op 2026-10-20 kort na middernacht UTC kwam door, eerder op de dag niet;
      meldingen vanaf de server werken altijd).
- [ ] Eén keer de echte omschakeling oefenen (nieuwe server + DNS en terug).
- [ ] Hersteltest elk kwartaal (volgende: 2027-01).
- [ ] Toegankelijkheidsaudit van de publieke paspoortpagina (WCAG 2.1 AA / EN 301 549).
- [ ] NFC/RFID-export, IEC 61406-kader, meertaligheid voor alle tekstvelden.
- [ ] Content-Security-Policy, aparte database-rol met minimale rechten, loadtest.
- [ ] Oud AWS-account opruimen (CDK-code onder tag `aws-laatste-versie`).
- [ ] E-mailverzending voor uitnodigingen/wachtwoordherstel (eerst overleg).

### Afgerond (oktober 2026)
- [x] STRATO-server, R2, nachtelijke versleutelde back-ups, capaciteitsbewaking en noodplan.
- [x] DPP-header en interoperabiliteit (EN 18223-richting), B2B-API `/api/v1` met API-sleutels.
- [x] Batch- en itempaspoorten, GS1 Digital Link, Data Matrix, QR met 4 modules vrije ruimte.
- [x] TLS 1.0/1.1 uit; derde back-up bij Hetzner (versleuteld, met snapshots); beperkte back-upsleutel.
- [x] Bewaking vanuit Cloudflare, meldingen vanaf de server, noodherstel in stappen + noodpakket.
- [x] Storings- en hersteltest: QR blijft werken, volledig herstel zonder STRATO in ca. 3 minuten.
- [x] AVG: eigen gegevens downloaden in het profiel; concepten van alle juridische documenten.
