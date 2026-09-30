# VeriPasso (DPP Platform)

Multi-tenant SaaS-platform voor Digital Product Passports (DPP) in de EU.
Bedrijven beheren hun producten, documenten en QR-codes in een eigen, volledig
geïsoleerde omgeving; consumenten scannen een QR-code en zien het publieke
productpaspoort zonder account.

Laatst bijgewerkt: 2026-09-30. Dit document beschrijft hoe het platform nú werkt,
inclusief de partner-/resellerlaag, het licentiesysteem en de monitoring die eind
september 2026 zijn toegevoegd.

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
  Fysiek verwijderen is verboden (QR- en auditcontinuïteit). Elke niet-actieve
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

## 2. Authenticatie (Microsoft Entra External ID, Native Auth)

- **Login** is volledig server-side (Native Authentication REST-flow): de
  gebruiker ziet nooit een Microsoft-pagina. Accounts worden bij aanmaak direct
  in Entra geprovisioneerd via Graph (app-only); het DPP-record koppelt via
  `entra_object_id` (JIT-linking op de `sub`-claim; let op: tokens van
  Graph-aangemaakte gebruikers hebben geen `email`-claim → `preferred_username`).
- **Break-glass**: het Platform Owner-account gebruikt bcrypt (lokaal wachtwoord)
  en werkt dus ook als Entra stuk is. In productie weigert de server te starten
  zonder volledige Entra-configuratie (bewust: nooit stil terugvallen op bcrypt).
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
- **Bescherming**: rate limiting op login/MFA (alleen mislukte pogingen tellen),
  1,2 s ondergrens op mislukte logins (timing/enumeratie), dummy-bcrypt bij
  onbekende accounts, gesaneerde logging (nooit bodies/tokens), sessies als
  httpOnly-cookies (alleen hashes in de DB).
- **Uitnodigingen**: eenmalige activatielink (7 dagen geldig, token alleen in de
  API-respons, alleen de hash in de DB). Activatie maakt de eerste
  Bedrijfsbeheerder aan (Entra-account inbegrepen). Er is bewust **geen**
  automatische e-mailverzending (SMTP verwijderd op verzoek) — de link wordt
  handmatig gedeeld. Partnerbedrijven krijgen geen invites (partner admins maakt
  de owner aan via Gebruikers).

---

## 3. Producten, documenten en QR

- Producten per tenant, met tabbladen (algemeen/duurzaamheid/compliance/
  onderdelen/batches/documenten), voortgang op 6 volledigheidscriteria
  (klikbaar: toont wat ontbreekt), en statussen incl. archiveren (soft).
- **Uploads**: foto's (JPEG/PNG/WEBP/GIF, max 5 MB) en documenten (PDF/JPEG/PNG/
  SVG/WEBP, max 10 MB) naar privé Blob-containers; de server streamt downloads
  zelf (Managed Identity) — er gaat nooit een SAS-link of accountkey naar de
  browser. `Documents.file_size`/`mime_type` worden vastgelegd (o.a. voor de
  opslagverdeling in de monitoring).
- **QR**: formaat `{QR_BASE_URL}/p/{public_id}` (PNG/SVG/label-PDF te downloaden).
  Gedrukte QR-codes moeten eeuwig werken: de App Service nooit verwijderen of
  hernoemen, en `QR_BASE_URL` alleen met heel goede reden wijzigen.
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

## 5. Monitoring & Systeemstatus (migratie 017, 2026-09-30)

Owner-only observability-dashboard op `/admin/systeemstatus`, volledig gebouwd op
bestaande infrastructuur (**geen Application Insights, € 0 extra kosten**):

- **Request-telemetrie in-process** (`src/monitoring/requestMetrics.js`): per
  request alleen tellers + duur-histogram. Routes worden tot patronen
  genormaliseerd (id's/GUID's/tokens eruit); query strings, headers, bodies en
  cookies worden nooit vastgelegd. Express meet de API; `server.js` meet de
  Next-pagina's (publieke paspoortpagina's als eigen scope).
- **Persistentie**: uurlijkse flush naar `SystemRequestMetricsHourly` (90 dagen
  retentie) en een dagelijkse snapshot naar `SystemMetricsSnapshots` (DB-grootte/
  max via catalogusviews, per-tabel rijen/bytes, entiteitstellingen, volledige
  blob-enumeratie per container; 400 dagen retentie). Scheduler
  (`src/monitoring/scheduler.js`) draait alleen in het serverproces; de
  leeftijdscheck (> 22 uur) voorkomt dubbele snapshots bij herstarts.
- **Databaseperformance** via DMV's (`sys.dm_exec_query_stats`, sessies,
  tarn-poolstatus) — geen query-instrumentatie nodig.
- **API** onder `/api/admin/system/*`: `health`, `overview`, `performance`,
  `database`, `growth` (incl. trendprognoses en dagen-tot-capaciteit), `storage`,
  `usage`, `errors`, `infra`, `POST snapshot` ("Nu meten"). Drempelwaarden staan
  centraal in `src/config/monitoring.js`.
- **Publieke health**: `GET /api/health` → alleen `OK` (voor de gratis App
  Service Health check-feature). Geen infrastructuurdetails publiek.
- **Eerlijkheid**: geen nepdata — metrics zonder historie tonen "Nog geen
  gegevens"; monitoring is gestart op 2026-09-30, 7/30/90-dagenanalyses vullen
  zich vanzelf.
- **Beveiliging**: alle routes 401 anoniem / 403 voor partner-, beheerders- en
  medewerkersrollen (getest); responses bevatten aantoonbaar geen secrets;
  foutmeldingen worden gesaneerd (tokens/lange reeksen gestript). Recente
  foutdetails leven in het procesgeheugen (weg na herstart); aantallen per uur
  blijven bewaard.

---

## 6. Lokale setup

1. `npm install`
2. Maak `.env` in de projectroot (wordt nooit gecommit):
   ```
   PORT=3000

   # Lokaal draait de app over http://localhost; zonder dit staat de sessie-cookie
   # op secure=true en werkt inloggen in de browser niet over plain http.
   # NOOIT zetten op de echte (Azure) omgeving.
   NODE_ENV=development

   # Azure SQL
   DB_SERVER=
   DB_DATABASE=
   DB_USER=
   DB_PASSWORD=

   # Alleen nodig om eenmalig scripts/seed-system-owner.js te draaien (dit is het
   # Platform Owner-account; de env-namen heten historisch nog SYSTEM_OWNER_*).
   # Verwijder deze regels weer uit .env zodra het account bestaat.
   SYSTEM_OWNER_EMAIL=
   SYSTEM_OWNER_PASSWORD=
   SYSTEM_OWNER_FIRST_NAME=
   SYSTEM_OWNER_LAST_NAME=

   # Microsoft Entra External ID als identity provider. Zolang deze niet
   # (volledig) zijn ingevuld blijft de bcrypt/sessie-login werken (alleen lokaal;
   # productie start bewust niet zonder). Zie docs/entra-external-id-setup.md.
   ENTRA_TENANT_NAME=
   ENTRA_TENANT_ID=
   ENTRA_WEB_CLIENT_ID=
   ENTRA_WEB_CLIENT_SECRET=
   ENTRA_GRAPH_CLIENT_ID=
   ENTRA_GRAPH_CLIENT_SECRET=
   ENTRA_REDIRECT_URI=
   ENTRA_POST_LOGOUT_REDIRECT_URI=
   COOKIE_SECRET=

   # Basis-URL's: APP_BASE_URL voor activatielinks, QR_BASE_URL voor QR-codes.
   # Op Azure staan deze als Application Settings (app./qr.veripasso.com).
   APP_BASE_URL=
   QR_BASE_URL=

   # Azure Blob Storage (foto's + documenten). Er staat GEEN storage-accountkey of
   # connection string in de app: authenticatie loopt via DefaultAzureCredential
   # (in App Service automatisch de system-assigned Managed Identity; lokaal via
   # `az login` of AZURE_CLIENT_ID/SECRET/TENANT_ID). Containers zijn en blijven
   # PRIVÉ; downloads worden door de server gestreamd. Benodigde RBAC-rol op het
   # storage account voor de identity: "Storage Blob Data Contributor".
   AZURE_STORAGE_ACCOUNT_NAME=
   AZURE_STORAGE_IMAGES_CONTAINER=product-images
   AZURE_STORAGE_DOCUMENTS_CONTAINER=product-documents
   ```
3. `npm run test:db` — check de databaseverbinding
4. `npm run migrate` — voert de idempotente migraties uit (t/m 017)
5. `npm run seed:owner` — maakt/actualiseert het Platform Owner-account
6. `npm start`

Achter de zakelijke proxy (Zscaler): zet `NODE_EXTRA_CA_CERTS` naar het
geëxporteerde root-CA-bestand (zie `scripts/export-zscaler-ca.ps1`), anders
falen alle TLS-verbindingen (DB, Entra, tests).

---

## 7. Azure-infrastructuur en deploy

Geen van onderstaande gegevens is een secret — dit is zodat iedereen zonder
sessie-geheugen weet hoe de live omgeving in elkaar zit.

- **App Service**: `dpp-platform-dev` (resource group `dpp-platform-dev_group`,
  Central US, **B1 Basic**). Ondanks de naam "dev" is dit de enige/live omgeving.
- **Live URL**: `https://dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net`
  — altijd de volledige hostname (de korte `dpp-platform-dev.azurewebsites.net`
  bestaat niet). Deze hostname moet voor altijd blijven werken: gedrukte QR-codes
  verwijzen er permanent naar → **App Service nooit verwijderen/hernoemen**.
- **Custom domains** (TransIP, gratis App Service Managed Certificates):
  `app.veripasso.com` (`APP_BASE_URL`), `qr.veripasso.com` (`QR_BASE_URL`),
  apex `veripasso.com` (landingspagina).
- **Deploy**: push naar `main` → GitHub Actions (`main_dpp-platform-dev.yml`) →
  **Run-From-Package**: CI bouwt de complete zip (`npm ci` + `next build`),
  schrijft `build-info.json` (commit/bouwtijd/run — zichtbaar op Systeemstatus →
  Deployment) en deployt met `az webapp deploy --type zip` (`--output none`
  zodat er nooit app settings/secrets in het CI-log komen). ~3 min, atomair.
  **`wwwroot` is read-only** — daarom gaan uploads naar Blob Storage. CI draait
  bewust geen tests (geen DB-secrets in GitHub); tests draaien lokaal vóór elke push.
- **Database**: Azure SQL **serverless** (max 32 GB). Migraties handmatig lokaal
  via `npm run migrate` tegen de live database; er is geen aparte staging-DB, dus
  `npm test` draait ook tegen de live data (suites ruimen hun eigen testdata op).
  Let op: serverless pauzeert bij inactiviteit → de eerste login daarna kan
  tientallen seconden duren (zie TODO: auto-pause-afweging heeft kostenimpact).
- **Blob Storage**: account `stveripassodev01`, privécontainers `product-images`
  en `product-documents`; toegang uitsluitend via Managed Identity + RBAC.
- **Identity**: Entra External ID-tenant `DPPPlatform`
  (`dppplatform.ciamlogin.com`); volledige setup in
  [docs/entra-external-id-setup.md](docs/entra-external-id-setup.md).
- **Kostenprincipe**: uitsluitend bestaande, gratis/al betaalde Azure-resources.
  Alles wat geld kost wordt eerst gemeld en pas na expliciet akkoord van de
  Platform Owner gebouwd. (Daarom eigen telemetrie i.p.v. Application Insights.)
- **Bekende valkuilen**:
  - Application Settings opslaan herstart de App Service — nooit doen tijdens een
    lopende deploy; nooit twee deploys tegelijk laten lopen.
  - Zakelijk netwerk (Zscaler) her-signeert TLS en onderschept veripasso.com —
    live testen via mobiele data.
  - Route-volgorde in Express: letterlijke routes vóór parameterroutes
    registreren (`/impersonate/stop` vóór `/:userId`, `/stats` vóór `/:id`).
  - Migraties: nieuwe kolommen die je in dezelfde batch gebruikt moeten via
    `EXEC(N'...')` (SQL Server compileert de hele batch vooraf).

---

## 8. Projectstructuur (hoofdlijnen)

```
server.js                      Entrypoint: Express (API) + Next.js (web/) in één proces;
                               meet paginaverkeer en start de monitoring-scheduler
src/
  app.js                       Express-app: telemetrie, routes, publieke /api/health
  config/                      db (pool + zelfherstel), entra, storage, monitoring (drempels), zod-NL
  middleware/                  auth (sessies, requireAuth/requireRole, impersonatieblokken),
                               rateLimit, validate, errorHandler
  monitoring/                  requestMetrics (in-memory telemetrie), collectors (DB/blob/tellingen),
                               health (checks, 30s cache), scheduler (uurflush + dagsnapshot)
  repositories/                SQL per entiteit (companies incl. partner-join, users, products,
                               plans, invites, auditLogs, scanEvents)
  routes/                      auth, companies (owner), users, products, plans, partner (/api/partner),
                               admin (impersonatie/licenties/config-status), systemMonitoring,
                               dashboard (rolbewust: platform/partner/company), company, audit,
                               inviteActivation, passwordReset, publicProducts
  services/                    license.service (één bron van waarheid), graphClient, nativeAuth,
                               entraLogin (JIT-link), blobStorage, qrCode, msalClients
  utils/                       roles (rollenmodel), tenant (assertCompanyAccess), auditLog,
                               password, tempPassword, baseUrl
migrations/                    001–017, idempotent (IF NOT EXISTS + EXEC-patroon)
scripts/                       migrate, seed-system-owner, check-db-connection,
                               cleanup-test-data (DB + Entra-sweep),
                               e2e-full-account-test, e2e-partner-reset-live, e2e-monitoring-live
web/                           Next.js App Router: app/admin (owner), app/partner, app/company,
                               app/login, app/p/[publicId] (publiek paspoort), components/, lib/
tests/                         node --test; 115 tests (auth, tenant-isolatie, Entra-linking,
                               licenties, partnerlaag, partner-wachtwoordreset, impersonatie,
                               documenten/foto's, user-delete, systeemmonitoring)
```

---

## 9. Tests en verificatie

- `npm test` — volledige suite tegen de live DB (fixtures ruimen zichzelf op via
  `tests/helpers/fixtures.js`; `scripts/cleanup-test-data.js` veegt restanten in
  DB én Entra-tenant). Stand 2026-09-30: **115 geslaagd, 0 gefaald, 4 geskipt**.
- Live E2E-scripts (draaien tegen productie met wegwerp-testaccounts en ruimen
  álles op, ook Entra): `scripts/e2e-full-account-test.js` (accountlevenscyclus),
  `scripts/e2e-partner-reset-live.js` (partner-wachtwoordreset incl. gedwongen
  wijziging en sessie-intrekking), `scripts/e2e-monitoring-live.js`
  (monitoringautorisatie + snapshot + blob-meting).
- Regel: **nooit pushen zonder groene suite**; live verifiëren na elke deploy.

---

## 10. TODO / openstaand werk

Bijgewerkt 2026-09-30 (afgeronde punten van de vorige lijst zijn verwijderd:
document-upload ✔, monitoring ✔, rolgestuurde menu's ✔, partnerlaag ✔).

### Portal-acties (niet vanuit code te doen)
- [ ] **Always On** aanzetten op de App Service (gratis binnen B1; voorkomt
      cold starts) en de **Health check**-feature op pad `/api/health`.
- [ ] Besluit over **SQL serverless auto-pause**: uitzetten lost de trage eerste
      login op maar kost geld (per actieve seconde; vast Basic-tier ~€5/mnd kan
      goedkoper zijn). Kosteloos alternatief: pauzevertraging verhogen.
- [ ] Bevestigen dat point-in-time-restore actief is op de Azure SQL-database.
- [ ] Entra user flow "DPP_SignIn" (zelfregistratie) verwijderen/uitschakelen in
      de portal — de app-kant is al dicht.

### Product / features
- [ ] Paginering + server-side filters op de productenlijst (breekt bij duizenden
      producten; `listProducts` haalt nu alles op).
- [ ] Zelf-beheerde categorieën (echte `Categories`-tabel i.p.v. vrij tekstveld).
- [ ] Uitbreidbare productvelden — architectuurkeuze (kolommen vs. JSON vs. EAV)
      eerst samen maken.
- [ ] Selfservice-registratie + online betaling (Route B-voorkant): vergt
      prijsvelden op plannen, betaalprovider (kosten! eerst overleg),
      e-mailverzending en automatische provisioning.
- [ ] "Geschiedenis"-tab per product (auditdata bestaat al, UI ontbreekt).
- [ ] Retentiebeleid auditlogs (geen automatische verwijdering zonder akkoord).

### Infra / later
- [ ] Aparte staging-/testdatabase (tests draaien nu tegen de live DB).
- [ ] Bij > ~100k blobs: opslagmeting omzetten van dagelijkse enumeratie naar de
      gratis capaciteitsmetric van Azure Monitor.
- [ ] Bepalen of `stveripassodev01` de definitieve productie-storage blijft.

### Back-up buiten git (zelf doen, bijv. wachtwoordmanager)
- [ ] De volledige inhoud van je lokale `.env` (DB-credentials, Entra-secrets,
      `COOKIE_SECRET`, storage-accountnaam).
- [ ] Welke Application Settings in Azure staan (namen hierboven; waarden zijn
      secret en staan nergens anders).
