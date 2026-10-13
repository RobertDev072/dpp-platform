# VeriPasso (DPP Platform)

Multi-tenant SaaS-platform voor Digital Product Passports (DPP) in de EU.
Bedrijven beheren hun producten, documenten en QR-codes in een eigen, volledig
geïsoleerde omgeving; consumenten scannen een QR-code en zien het publieke
productpaspoort zonder account. Systemen kunnen hetzelfde paspoort op dezelfde URL
machineleesbaar opvragen (JSON, JSON-LD, XML).

Laatst bijgewerkt: 2026-10-13. **Status: lokale ontwikkeling.** Er is (nog) geen
hosting gekozen; AWS, Supabase, Azure en Vercel worden niet meer gebruikt. De laatste
versie met AWS-infrastructuur staat onder de git-tag `aws-laatste-versie`.

Domeinen (DNS bij Cloudflare):

| Adres | Rol |
|---|---|
| https://www.veripasso.com (en veripasso.com) | landingspagina |
| https://app.veripasso.com | de SaaS-applicatie (inloggen, dashboards, beheer) |
| https://qr.veripasso.com | QR-scans en publieke productpaspoorten (permanent: staat op elke gedrukte code) |

Verder: [compliance-matrix](docs/compliance/requirements-matrix.md),
[Cloudflare vóór qr.veripasso.com](docs/cloudflare.md) (paspoortcache en gebundelde scans).

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
- Microsoft Entra is volledig verwijderd. Accounts die nog geen lokaal wachtwoord hebben
  (oud Entra), krijgen vóór de overstap een tijdelijk wachtwoord (runbook §5.3).
- Bescherming: rate limiting (login, MFA, resets, publieke API), 1,2 s vloer op mislukte
  logins, dummy-bcrypt bij onbekende accounts, gesaneerde gestructureerde logging.

---

## 3. Producten, paspoorten, documenten en QR

- Producten per tenant met duurzaamheid, compliance, onderdelen, batches en documenten;
  compleetheid op 7 criteria; import (Excel/CSV, hervatbaar), bulkacties en labelprint.
- **Uploads** (foto's JPEG/PNG/WEBP/GIF ≤ 5 MB; documenten PDF/JPEG/PNG/SVG/WEBP ≤ 10 MB)
  gaan rechtstreeks van de browser naar **privé buckets in S3-compatibele opslag**
  (lokaal bijv. MinIO, later bijv. Cloudflare R2; zonder ingestelde opslag staan uploads uit):
  1. `POST /api/products/:id/{photo|documents}/upload-url`: rol, tenant, type en grootte
     worden gecontroleerd; de server geeft een **presigned POST** voor precies één object
     (`products/{productId}/{uuid}.{ext}`), waarbij S3 zelf sleutel, type en max. grootte afdwingt;
  2. de browser stuurt het bestand naar S3;
  3. `POST .../complete`: de server controleert het object (HeadObject) en koppelt het.
- **Downloads**: eigen stabiele API-route → toegangscontrole → presigned URL (5 minuten).
  Objecten worden nooit overschreven of door de app verwijderd (zet bij de opslag
  versioning aan als tweede slot).
- **QR**: formaat `{QR_BASE_URL}/p/{PUBLIC_ID}` met `QR_BASE_URL=https://qr.veripasso.com`.
  De GUID staat in **hoofdletters** (zo gedrukt in de Azure-tijd); opzoeken werkt
  hoofdletterongevoelig. Elke QR identificeert een **productmodel**.
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
- **Scans**: de publieke pagina registreert per bezoek precies één ScanEvent
  (user-agent/referrer, geen IP).

---

## 4. Menu's per rol

- **Platform Owner**: Overzicht, Partners, Klantbedrijven, Alle gebruikers,
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
- **Scans**: de publieke paspoortpagina meldt elke weergave met een lichte beacon
  (`POST /api/scan/:id`), zodat scans ook kloppen als een CDN de pagina uit de cache
  serveert. Met Cloudflare vangt een Worker de beacon op (zie docs/cloudflare.md).
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
op `localhost:3000`. Achter de zakelijke proxy (Zscaler): `NODE_EXTRA_CA_CERTS` naar het
root-CA-bestand (`scripts/export-zscaler-ca.ps1`).

---

## 7. Hosting (nog te kiezen)

Er is bewust geen hosting ingericht. De app is een gewone Next.js-server
(`npm run build` → `npm run start`, of de standalone-output) met PostgreSQL 17 en
optioneel S3-compatibele opslag; daarmee past hij op vrijwel elke host.

Bij het kiezen van een host regelen:
- **Database**: PostgreSQL 17 met back-ups; `DATABASE_URL` (of `DB_*`) als geheime variabele.
- **Migraties**: `npm run migrate` bij elke uitrol (vóór of direct na de nieuwe code;
  migraties zijn altijd additief).
- **Geheimen**: `COOKIE_SECRET`, `MFA_ENCRYPTION_KEY`, databasewachtwoord en eventueel
  `EDGE_SYNC_TOKEN` en `S3_*` als geheime variabelen van de host, nooit in de repository.
- **Domeinverdeling**: elk domein heeft één rol (zie de tabel bovenaan). Vroeger deed
  een CloudFront Function dat; bij nieuwe hosting opnieuw regelen (bijv. Cloudflare
  Redirect Rules of middleware in de app). `/api/*`, `/_next/*`, `/brand/*` op elk domein.
- **Cloudflare vóór `qr.veripasso.com`**: zie [docs/cloudflare.md](docs/cloudflare.md).
- **Valkuilen**: route-volgorde in Express (letterlijke routes vóór `/:id`); Postgres vouwt
  ongequote namen naar kleine letters (camelCase-aliassen quoten); `QR_BASE_URL` en de
  DNS van `qr.veripasso.com` nooit wijzigen of verwijderen.

De oude AWS-opzet (CDK, workflows, Lambda) staat onder de git-tag `aws-laatste-versie`.

---

## 8. Projectstructuur (hoofdlijnen)

```
app/                      Next.js App Router (admin, partner, company, login, p/[id] = publiek paspoort)
components/, lib/         UI-componenten en frontend-helpers (lib/api.js incl. presigned upload)
pages/api/[[...path]].js  Eén API-route die alle /api/*-verzoeken aan Express geeft
instrumentation.js        Start achtergrondtaken; nette afsluiting bij SIGTERM
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
                          license, import, print, qrCode
  utils/                  logger, roles, tenant, auditLog, password, baseUrl
db/migrations/            PostgreSQL-migraties (oplopend; bijgehouden in dbo.schemamigrations)
edge/cloudflare/          Cloudflare Worker voor qr.veripasso.com (scans bundelen, cache verversen)
scripts/                  migrate, seed-system-owner, backfill-passport-versions, local-db,
                          check-db-connection, cleanup-test-data
tests/                    node --test (zie §9)
docs/                     cloudflare, compliance-matrix, verificatie
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

### Compliance (zie [docs/compliance/requirements-matrix.md](docs/compliance/requirements-matrix.md))
- [ ] Oordeel van de certificeerder over de geblokkeerde punten: EN 18219/18220/18222/18223
      (niet door AI beoordeeld i.v.m. de EVS-licentie), back-up-dienstverlener, DPP-levensduur
      per productgroep, model- vs. item-paspoort, HTTP/1.1, digitale handtekeningen (EN 18246).
- [ ] Toegankelijkheidsaudit van de publieke paspoortpagina (EN 301 549 / WCAG 2.1 AA).

### Beheer
- [ ] AWS-account 707191185248 opruimen: back-up maken en de omgeving afbreken met de CDK-
      code uit de tag `aws-laatste-versie` (of het account sluiten).
- [ ] Hosting kiezen (zie §7); daarna restore-test van de database en een loadtest.
- [ ] Platform Owner: MFA koppelen.

### Product / later
- [ ] Item-niveau-paspoorten (serienummers) als de productgroep dat vereist.
- [ ] Bestandsopslag kiezen (bijv. Cloudflare R2) zodat uploads weer aan kunnen.
- [ ] Content-Security-Policy; aparte database-applicatierol met minimale rechten.
- [ ] Scan-aggregatie per dag + bewaartermijn voor ruwe scans (na besluit over bewaren).
- [ ] E-mailverzending voor uitnodigingen/wachtwoordherstel (eerst overleg).
