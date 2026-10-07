# VeriPasso (DPP Platform)

Multi-tenant SaaS-platform voor Digital Product Passports (DPP) in de EU.
Bedrijven beheren hun producten, documenten en QR-codes in een eigen, volledig
geïsoleerde omgeving; consumenten scannen een QR-code en zien het publieke
productpaspoort zonder account.

Laatst bijgewerkt: 2026-10-07. Dit document beschrijft hoe het platform nú werkt:
gehost op **Vercel**, met **Supabase** (Postgres + Storage) als database en
bestandsopslag (inrichting en instellingen: [docs/infrastructuur.md](docs/infrastructuur.md)).
Azure (App Service, Azure SQL, Blob Storage, Entra/Graph) is
uitgefaseerd; het draaiboek voor die overstap staat in
[docs/migratie-azure-naar-vercel-supabase.md](docs/migratie-azure-naar-vercel-supabase.md).

---

## 1. Businessmodel en rollen

VeriPasso wordt op twee manieren verkocht:

- **Route A — via een Partner/Reseller** (bijv. Certification B.v): de partner
  onboardt klantbedrijven, wijst een (door de owner opengesteld) abonnement toe
  en nodigt de eerste beheerder uit. De partner beheert **nooit** producten,
  documenten of gebruikerslijsten van klanten.
- **Route B — direct**: de Platform Owner maakt het klantbedrijf handmatig aan,
  wijst een abonnement toe en nodigt de eerste beheerder uit. (Publieke
  zelfregistratie is bewust verwijderd; selfservice + betaling is toekomstwerk.)

### Rollenmodel (technische naam → UI-label)

| Rol | UI-label | Kort |
|---|---|---|
| `platform_owner` | Platform Owner | Precies één account (geseed, bcrypt break-glass). Ziet en beheert alles. Voor alle anderen onzichtbaar (API geeft 404, geen 403). Rol/status via de API onwijzigbaar; er is geen enkel API-pad dat deze rol kan toekennen. |
| `partner_admin` | Partner Admin | Alleen door de owner toekenbaar, en uitsluitend op een bedrijf met `kind='partner'`. Werkt in `/partner`; heeft nergens anders toegang (overal 403). |
| `company_admin` | Bedrijfsbeheerder | Beheert het eigen bedrijf: medewerkers, producten, documenten. Mag medewerkers promoveren naar beheerder; beheerders onderling beheert alleen de owner. Mag gebruikers archiveren maar niet definitief verwijderen. |
| `company_user` | Medewerker | Werkt aan producten/documenten/QR van het eigen bedrijf. Ziet geen abonnement, medewerkersbeheer of bedrijfsinstellingen. |

Aanvullende regels (afgedwongen in code én database):

- **Soft delete only**: gebruikersstatussen zijn `active/blocked/suspended/archived/deleted`.
  status blokkeert inloggen direct (ook lopende sessies). `deleted` mag alleen de owner
  status schakelt ook het gekoppelde Entra-account uit. `deleted` mag alleen de owner
  zetten en verdwijnt uit alle lijsten.
- Per bedrijf moet altijd ≥ 1 actieve Bedrijfsbeheerder overblijven (409 `LAST_COMPANY_ADMIN`).
- Company-rollen kunnen niet op een partnerbedrijf terechtkomen en andersom
  (anders zou een partner via een omweg productmodules krijgen).
- Impersonatie ("Inloggen als"): owner mag iedereen (ook partner admins),
  een Bedrijfsbeheerder alleen eigen medewerkers/beheerders; max 1 uur; nooit
  genest; alles herleidbaar in de auditlog (beide identiteiten).

### Partner-/resellerlaag (migratie 016)

- `Companies.kind` = `'customer' | 'partner'`; klanten kunnen een `partner_id`
  hebben (FK naar het partnerbedrijf; CHECK: alleen op klanten).
- `partner_id` is uitsluitend een **relatiespoor** ("aangebracht door") — geen
  aggregatieniveau. Limieten, verbruik en data blijven strikt per klant-tenant.
- Partnertoegang loopt uitsluitend via `/api/partner/*` (eigendomscheck
  `customer.partner_id === eigen bedrijf`; andermans klanten geven bewust 404):
  klanten aanmaken (alleen plannen met `partner_assignable=1`), licentie-inzage,
  invites voor de eerste beheerder, en wachtwoordreset van Bedrijfsbeheerders
  van eigen klanten (zie §3).
- Klant verhuizen (naar direct of een andere partner) doet alleen de owner via
  de bedrijvenpagina; data/producten/QR blijven onaangeroerd.

### Licenties/abonnementen (migratie 015)

- Plannen (`Plans`: `max_users`, `max_products`, `partner_assignable`) beheert
  alleen de owner. Per bedrijf: `plan_id` + `license_start`/`license_end`.
- `src/services/license.service.js` is de enige bron van waarheid:
  status `Actief` / `Bijna limiet` (≥ 80%) / `Limiet bereikt` / `Verlopen`.
  Verlopen blokkeert alleen **aanmaken** (bestaande data en publieke QR's blijven
  werken — bewuste keuze). Reactiveren van een gearchiveerde gebruiker telt mee
  voor de seat-limiet (geen gratis omweg).

---

## 2. Authenticatie (lokaal: bcrypt + eigen sessies)

- **Login** is volledig server-side: e-mail + wachtwoord, gecontroleerd tegen een
  bcrypt-hash in `dbo.users`; een geslaagde login geeft een eigen sessie
  (httpOnly-cookie, alleen de sha256-hash van het token staat in `dbo.sessions`).
  E-mailadressen zijn hoofdletterongevoelig (uniek op `lower(email)`).
- **Microsoft Entra External ID is uitgefaseerd.** Er is geen Graph-provisioning
  meer; nieuwe accounts, resets en activaties maken altijd een lokaal wachtwoord.
  - **Overgangsfase**: accounts die nog in Entra zijn aangemaakt hebben geen lokale
    hash. Zolang `ENTRA_TENANT_NAME` + `ENTRA_WEB_CLIENT_ID` gezet zijn, controleert
    de login hun wachtwoord nog één keer bij Entra (Native Auth, geen secrets) en
    slaat het daarna als bcrypt-hash op (auditactie `password_migrated`). Bestaande
    gebruikers merken dus niets. Een Entra-MFA-stap vervalt daarbij (lokale MFA is
    toekomstwerk, zie §10).
  - **Einde overgangsfase**: `npm run temp-passwords` toont wie nog niet is
    overgezet; met `-- --apply` krijgen zij een tijdelijk wachtwoord (CSV, buiten
    git). Daarna beide `ENTRA_*`-variabelen weghalen; de Entra-tenant kan weg.
- **Platform Owner** gebruikt altijd een lokaal wachtwoord (geseed via
  `npm run seed:owner`).
- **Tijdelijke wachtwoorden**: bij aanmaak/reset genereert de server een
  eenmalig getoond tijdelijk wachtwoord en zet `must_change_password`. Inloggen
  met een tijdelijk wachtwoord geeft géén sessie maar `{ mustChangePassword: true }`;
  de gebruiker zet eerst via `/api/auth/change-password` een eigen wachtwoord.
- **Wachtwoordresets**: owner en Bedrijfsbeheerder (eigen bedrijf) via
  `/api/users/:id/reset-password`; Partner Admin voor Bedrijfsbeheerders van
  eigen klanten via `/api/partner/customers/:id/admins/:userId/reset-password`
  (geblokkeerde accounts worden nooit stilzwijgend gereactiveerd; alle sessies
  van het doelwit worden ingetrokken; rate limit 15/15 min per partner; volledig
  geauditeerd zónder het wachtwoord).
- **"Wachtwoord vergeten"** (zelfservice via e-mailcode) werkt alleen tijdens de
  overgangsfase (Entra verstuurt de code). Daarna geeft de route een nette 503
  ("vraag je beheerder") — VeriPasso heeft bewust geen eigen e-mailverzending.
- **Bescherming**: rate limiting op login (alleen mislukte pogingen tellen),
  1,2 s ondergrens op mislukte logins (timing/enumeratie), dummy-bcrypt bij
  onbekende accounts, gesaneerde logging (nooit bodies/tokens). Let op: de
  rate-limiter houdt tellers in het geheugen van één Vercel-instance bij (zie §10).
- **Uitnodigingen**: eenmalige activatielink (7 dagen geldig, token alleen in de
  API-respons, alleen de hash in de DB). Bij activatie kiest de eerste
  Bedrijfsbeheerder direct een eigen wachtwoord (min. 12 tekens). Er is bewust
  **geen** automatische e-mailverzending — de link wordt handmatig gedeeld.

---

## 3. Producten, documenten en QR

- Producten per tenant, met tabbladen (algemeen/duurzaamheid/compliance/
  onderdelen/batches/documenten), voortgang op 6 volledigheidscriteria
  (klikbaar: toont wat ontbreekt), en statussen incl. archiveren (soft).
- **Uploads** (foto's JPEG/PNG/WEBP/GIF max 5 MB; documenten PDF/JPEG/PNG/SVG/WEBP
  max 10 MB) gaan naar de **privé**-buckets `product-images` en
  `product-documents` in Supabase Storage. Omdat een Vercel-functie maximaal 4,5 MB
  per request accepteert, uploadt de browser **rechtstreeks** naar Storage:
  1. `POST /api/products/:id/{photo|documents}/upload-url` — rol, tenant, type en
     grootte worden gecontroleerd; de server geeft een eenmalige upload-URL voor
     precies één object (`products/{productId}/{uuid}.{ext}`);
  2. de browser zet het bestand op die URL;
  3. `POST .../complete` — de server controleert in `storage.objects` dat het object
     bestaat, bij dít product hoort en binnen type/grootte valt, en koppelt het.
  De buckets dwingen grootte en MIME-types daarnaast zelf af. De oude multipart-
  endpoints (`POST /photo`, `/documents/upload`) bestaan nog voor kleine bestanden.
- **Downloads**: onze eigen, stabiele API-route controleert eerst de toegang
  (tenant, of "gepubliceerd + publiek") en verwijst dan door naar een **signed URL
  die 5 minuten geldig is**. De service-role-key verlaat de server nooit.
  `Documents.file_size`/`mime_type` worden vastgelegd.
- **QR** — gedrukte QR-codes moeten eeuwig werken:
  - formaat `{QR_BASE_URL}/p/{PUBLIC_ID}` (PNG/SVG/label-PDF te downloaden), met
    `QR_BASE_URL=https://qr.veripasso.com`;
  - de `public_id` staat in de QR-code in **hoofdletters** — zo leverde Azure SQL
    hem toen de eerste codes werden gedrukt; een opnieuw gedownloade code is dus
    identiek aan de gedrukte. Postgres slaat hem op als `uuid`; opzoeken werkt met
    hoofd- én kleine letters, een kapotte id geeft 404 (geen 500);
  - `public_id` en product-id's zijn bij de migratie 1-op-1 overgenomen;
  - gearchiveerde producten blijven publiek bereikbaar (met melding);
  - `QR_BASE_URL` alleen met heel goede reden wijzigen, en nooit naar een
    `*.vercel.app`-adres; de DNS-record van `qr.veripasso.com` nooit weghalen.
  - Vastgelegd in `tests/qr-continuity.test.js`.
- Publieke paspoortpagina registreert een ScanEvent (user-agent/referrer, geen
  persoonsgegevens) — bron voor de QR-statistieken.

---

## 4. Menu's per rol (rolgestuurd, sinds 2026-09-30)

- **Platform Owner**: Overzicht, Partners, Klantbedrijven, Alle gebruikers,
  Abonnementen, Auditlog, Systeemstatus, Instellingen.
- **Partner Admin**: Overzicht, Mijn klanten, Uitnodigingen, Licenties
  (Klantlicenties), Activiteiten, Instellingen, Help & support.
- **Bedrijfsbeheerder**: Overzicht, Producten, Documenten, QR-codes, Medewerkers,
  Abonnement, Bedrijfsinstellingen, Help & support.
- **Medewerker**: Overzicht, Producten, Documenten, QR-codes, Mijn profiel,
  Help & support.

Menu's verbergen is UI-comfort; élk endpoint dwingt de rol ook server-side af.

---

## 5. Monitoring & Systeemstatus

Owner-only observability-dashboard op `/admin/systeemstatus`, gebouwd op bestaande
infrastructuur (geen betaalde telemetriedienst):

- **Request-telemetrie in-process** (`src/monitoring/requestMetrics.js`): per
  request alleen tellers + duur-histogram. Routes worden tot patronen
  genormaliseerd (id's/GUID's/tokens eruit); query strings, headers, bodies en
  cookies worden nooit vastgelegd. Scopes: `api`, `public` (de publieke
  paspoort-API die `/p/:id` gebruikt). Paginaverkeer van Next.js zelf is
  zichtbaar in Vercel → Observability.
- **Serverless-aanpak**: elke Vercel-instance houdt zijn eigen tellers bij en
  schrijft ze elke ~5 minuten (of bij een nieuw uur) op de achtergrond weg naar
  `SystemRequestMetricsHourly` (`waitUntil`). Meerdere rijen per uur/route zijn
  normaal; alle leesqueries tellen ze op. "Live"-cijfers (lopend uur, minuut-
  grafiek, recente fouten) gelden alleen voor de instance die je request afhandelt.
- **Dagelijks onderhoud**: Vercel Cron roept om 03:15 UTC `/api/cron/daily` aan
  (beveiligd met `CRON_SECRET`): metrics-snapshot naar `SystemMetricsSnapshots`
  (DB-grootte, per-tabel rijen/bytes, entiteitstellingen, opslag per bucket/
  extensie uit `storage.objects`) en opschonen (90 dagen uurdata, 400 dagen
  snapshots). "Nu meten" (`POST /api/admin/system/snapshot`) blijft beschikbaar.
- **Databaseperformance** via `pg_stat_statements` en `pg_stat_activity`; de
  maximale databasegrootte hangt af van het Supabase-plan en staat in
  `DATABASE_MAX_BYTES`.
- **API** onder `/api/admin/system/*`: `health`, `overview`, `performance`,
  `database`, `growth`, `storage`, `usage`, `errors`, `infra` (Vercel-commit/
  omgeving/regio), `POST snapshot`. Drempelwaarden centraal in
  `src/config/monitoring.js`.
- **Publieke health**: `GET /api/health` → alleen `OK` (voor een externe
  uptime-monitor). Geen infrastructuurdetails publiek.
- **Beveiliging**: alle routes 401 anoniem / 403 voor andere rollen; responses
  bevatten geen secrets; foutmeldingen worden gesaneerd.

---

## 6. Lokale setup

1. Node.js 22, dan `npm install`
2. Maak `.env` in de projectroot (wordt nooit gecommit):
   ```
   # Lokaal draait de app over http://localhost; zonder dit staat de sessie-cookie
   # op secure=true en werkt inloggen in de browser niet over plain http.
   # NOOIT zetten op Vercel.
   NODE_ENV=development

   # Supabase Postgres. Supabase → Project → Connect → "Transaction pooler"
   # (poort 6543) voor de app; voor migraties/scripts mag ook "Session pooler"
   # of de directe verbinding (poort 5432).
   DATABASE_URL=postgresql://postgres.<ref>:<wachtwoord>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
   # Optioneel: CA-certificaat (Supabase → Database → SSL) voor volledige
   # certificaatcontrole; zonder dit is de verbinding wel versleuteld.
   DATABASE_CA_CERT=
   # Inbegrepen DB-grootte van je Supabase-plan (voor de capaciteitsmeter).
   DATABASE_MAX_BYTES=8589934592

   # Supabase Storage (en project-URL). De service-role-key is geheim, alleen
   # server-side, nooit in de browser of in NEXT_PUBLIC_-variabelen.
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=
   # Optioneel, standaard product-images / product-documents:
   SUPABASE_STORAGE_IMAGES_BUCKET=
   SUPABASE_STORAGE_DOCUMENTS_BUCKET=

   COOKIE_SECRET=

   # Basis-URL's: APP_BASE_URL voor activatielinks, QR_BASE_URL voor QR-codes.
   APP_BASE_URL=http://localhost:3000
   QR_BASE_URL=http://localhost:3000

   # Alleen tijdens de Entra-overgangsfase (zie §2); anders leeg laten.
   ENTRA_TENANT_NAME=
   ENTRA_WEB_CLIENT_ID=

   # Alleen voor eenmalig `npm run seed:owner` (Platform Owner-account); daarna
   # weer uit .env halen. De namen heten historisch SYSTEM_OWNER_*.
   SYSTEM_OWNER_EMAIL=
   SYSTEM_OWNER_PASSWORD=
   SYSTEM_OWNER_FIRST_NAME=
   SYSTEM_OWNER_LAST_NAME=
   ```
3. `npm run test:db` — check de databaseverbinding
4. `npm run migrate` — voert de Postgres-migraties uit `supabase/migrations/` uit
   (idempotent; maakt ook de twee privé-buckets aan)
5. `npm run seed:owner` — maakt/actualiseert het Platform Owner-account
6. `npm run dev` — app op http://localhost:3000 (Next.js + de Express-API)

Achter de zakelijke proxy (Zscaler): zet `NODE_EXTRA_CA_CERTS` naar het
geëxporteerde root-CA-bestand (zie `scripts/export-zscaler-ca.ps1`), anders
falen alle TLS-verbindingen (Supabase, tests).

---

## 7. Infrastructuur en deploy (Vercel + Supabase)

Geen van onderstaande gegevens is een secret.

- **Hosting: Vercel**, één project, framework Next.js, regio `dub1` (Dublin,
  dicht bij de database; EU-data). Next.js draait de pagina's; de complete
  Express-API zit in één functie: `pages/api/[[...path]].js` → `src/app.js`.
  Config in `vercel.json` (regio, max. 30 s per request, dagelijkse cron).
- **Deploy**: Git-koppeling van Vercel. Push naar `main` = productie; elke andere
  branch/PR krijgt automatisch een preview-URL. Er is geen GitHub Actions-
  workflow meer nodig. Tests draaien lokaal vóór elke push (geen DB-secrets in CI).
- **Domeinen** (DNS bij TransIP, certificaten automatisch via Vercel):
  - `app.veripasso.com` → `APP_BASE_URL` (CNAME naar Vercel)
  - `qr.veripasso.com` → `QR_BASE_URL` (CNAME naar Vercel) — **staat op elke
    gedrukte QR-code; nooit weghalen of laten verlopen**
  - `veripasso.com` (apex, A-record naar Vercel) → landingspagina
  - Het oude `dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net`
    werkt alleen zolang er in Azure iets draait; zie het draaiboek voor QR-codes
    die (eventueel) met dat adres zijn gedrukt.
- **Database: Supabase Postgres** (regio `eu-west-1`, Ierland). Alle tabellen staan in
  schema `dbo` — níet in `public`, dus onbereikbaar via Supabase's publieke Data
  API; RLS staat daarnaast aan zonder policies. De app verbindt via de
  Supavisor-pooler (transaction mode) met maximaal 3 verbindingen per instance.
  Migraties: `npm run migrate` lokaal tegen de live database. Er is (nog) geen
  aparte staging-DB, dus `npm test` draait tegen de live data (suites ruimen hun
  eigen testdata op).
- **Bestandsopslag: Supabase Storage**, privé-buckets `product-images` en
  `product-documents` (grootte-/typelimieten op bucketniveau).
- **Environment variables in Vercel** (Production; voor Preview bij voorkeur een
  aparte Supabase-branch/project): `DATABASE_URL`, `DATABASE_CA_CERT` (optioneel),
  `DATABASE_MAX_BYTES`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `COOKIE_SECRET`, `APP_BASE_URL`, `QR_BASE_URL`, `CRON_SECRET`, en tijdens de
  overgangsfase `ENTRA_TENANT_NAME` + `ENTRA_WEB_CLIENT_ID`. Niet zetten:
  `NODE_ENV=development`.
- **Kosten** (eerst melden, pas na akkoord): Vercel **Hobby is alleen voor
  niet-commercieel gebruik** — voor VeriPasso is **Vercel Pro** nodig
  (± $20/maand per teamlid). Supabase **Free pauzeert een project na een week
  zonder activiteit** (dan werken QR-codes niet meer) en heeft geen dagelijkse
  back-ups — voor productie is **Supabase Pro** nodig (± $25/maand, incl. 8 GB
  database, 100 GB opslag, dagelijkse back-ups). Prijzen live checken.
- **Bekende valkuilen**:
  - Een env-var wijzigen in Vercel werkt pas na een nieuwe deploy (Redeploy).
  - Zakelijk netwerk (Zscaler) her-signeert TLS en onderschept veripasso.com —
    live testen via mobiele data.
  - Route-volgorde in Express: letterlijke routes vóór parameterroutes
    registreren (`/impersonate/stop` vóór `/:userId`, `/stats` vóór `/:id`).
  - Postgres vouwt ongequote namen naar kleine letters: kolomaliassen in
    camelCase altijd quoten (`AS "activeCount"`).
  - Supavisor in transaction mode: geen sessie-instellingen (`SET ...`) of
    LISTEN/NOTIFY gebruiken.

---

## 8. Projectstructuur (hoofdlijnen)

```
app/                           Next.js App Router: admin (owner), partner, company,
                               login, p/[id] (publiek paspoort), ...
components/, lib/              UI-componenten en frontend-helpers (lib/api.js incl. directe upload)
pages/api/[[...path]].js       Eén Vercel-functie die alle /api/*-requests aan Express geeft
src/
  app.js                       Express-app: telemetrie, routes, cron, publieke /api/health
  config/                      db (pg-pool + compatibiliteitslaag), storage (Supabase),
                               entra (alleen overgangsfase), monitoring (drempels), zod-NL
  middleware/                  auth (sessies, requireAuth/requireRole, impersonatieblokken),
                               rateLimit, validate, errorHandler
  monitoring/                  requestMetrics (in-memory telemetrie), collectors (DB/opslag/
                               tellingen), health (checks, 30s cache), scheduler (flush + dagonderhoud)
  repositories/                SQL per entiteit (Postgres)
  routes/                      auth, companies (owner), users, products (incl. directe uploads),
                               plans, partner (/api/partner), admin, systemMonitoring, cron,
                               dashboard, company, audit, inviteActivation, passwordReset,
                               publicProducts
  services/                    license.service (één bron van waarheid), blobStorage
                               (Supabase Storage), qrCode, nativeAuth (overgangsfase)
  utils/                       roles, tenant (assertCompanyAccess), auditLog, password,
                               tempPassword, baseUrl (incl. QR-paspoortlink)
supabase/migrations/           Postgres-schema (dbo) + Storage-buckets
migrations/                    Historisch: de oude Azure SQL-migraties 001–017 (draaien niet meer)
scripts/                       migrate, seed-system-owner, check-db-connection, cleanup-test-data,
                               issue-temp-passwords, migrate-from-azure (eenmalig),
                               e2e-partner-reset-live, e2e-monitoring-live
tests/                         node --test (auth, tenant-isolatie, licenties, partnerlaag,
                               wachtwoordresets, impersonatie, documenten/foto's, QR-continuïteit,
                               user-delete, systeemmonitoring)
vercel.json                    Regio, functieduur, cron
```

---

## 9. Tests en verificatie

- `npm test` — volledige suite tegen de database uit `DATABASE_URL` (fixtures
  ruimen zichzelf op via `tests/helpers/fixtures.js`;
  `scripts/cleanup-test-data.js` veegt restanten). Opslagtests draaien alleen
  met `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; Entra-tests alleen tijdens de
  overgangsfase.
- Live E2E-scripts (tegen productie, wegwerp-testaccounts, ruimen alles op):
  `scripts/e2e-partner-reset-live.js`, `scripts/e2e-monitoring-live.js`
  (standaard tegen `https://app.veripasso.com`).
- Regel: **nooit pushen zonder groene suite**; live verifiëren na elke deploy
  (minimaal: inloggen, een bestaande gedrukte QR-code scannen, foto/document
  openen op een publiek paspoort).

---

## 10. TODO / openstaand werk

Bijgewerkt 2026-10-07 (na de migratie naar Vercel + Supabase).

### Migratie afronden (zie draaiboek)
- [ ] Supabase Pro + Vercel Pro afnemen (zie §7, kosten).
- [ ] Data overzetten met `npm run migrate:from-azure`, DNS omzetten, QR-codes live testen.
- [ ] Besluit over QR-codes die met het oude `*.azurewebsites.net`-adres zijn gedrukt.
- [ ] Na de overgangsfase: `npm run temp-passwords -- --apply`, `ENTRA_*` weghalen,
      Entra-tenant en alle Azure-resources opzeggen.
- [ ] Opruimen (bestanden die niet meer gebruikt worden): `server.js`,
      `web/package.json`, `.github/workflows/main_dpp-platform-dev.yml`,
      `src/services/graphClient.js`, `src/services/msalClients.js`,
      `scripts/e2e-full-account-test.js`, `docs/entra-external-id-setup.md`, en na de
      overgangsfase ook `src/services/entraLogin.service.js`,
      `tests/entra-linking.test.js`, `tests/native-auth-login.test.js`.

### Product / features
- [ ] Lokale MFA (TOTP) — vervangt de Entra-MFA die met de migratie is vervallen.
- [ ] E-mailverzending (bijv. Resend) voor "wachtwoord vergeten" en uitnodigingen
      na de overgangsfase (kosten: eerst overleg).
- [ ] Paginering + server-side filters op de productenlijst (breekt bij duizenden
      producten; `listProducts` haalt nu alles op).
- [ ] Zelf-beheerde categorieën (echte `categories`-tabel i.p.v. vrij tekstveld).
- [ ] Uitbreidbare productvelden — architectuurkeuze (kolommen vs. JSON vs. EAV)
      eerst samen maken.
- [ ] Selfservice-registratie + online betaling (Route B-voorkant).
- [ ] "Geschiedenis"-tab per product (auditdata bestaat al, UI ontbreekt).
- [ ] Retentiebeleid auditlogs (geen automatische verwijdering zonder akkoord).

### Infra / later
- [ ] Aparte staging-database (Supabase-branch) voor Preview-deploys en tests.
- [ ] Rate limiting instance-overstijgend maken (bijv. tellers in Postgres): nu
      telt elke Vercel-instance apart.
- [ ] Bij verwijderen van een document ook het object uit Storage halen (nu blijft
      het als wees achter, net als voorheen in Azure).
- [ ] Externe uptime-monitor op `https://qr.veripasso.com/api/health`.

### Back-up buiten git (zelf doen, bijv. wachtwoordmanager)
- [ ] De volledige inhoud van je lokale `.env` (Supabase-URL's/keys, `COOKIE_SECRET`,
      `CRON_SECRET`).
- [ ] Welke Environment Variables in Vercel staan (namen hierboven; waarden zijn
      secret en staan nergens anders).
