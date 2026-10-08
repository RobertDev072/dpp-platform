# VeriPasso (DPP Platform)

Multi-tenant SaaS-platform voor Digital Product Passports (DPP) in de EU.
Bedrijven beheren hun producten, documenten en QR-codes in een eigen, volledig
geïsoleerde omgeving; consumenten scannen een QR-code en zien het publieke
productpaspoort zonder account.

Laatst bijgewerkt: 2026-10-07. Dit document beschrijft hoe het platform nú werkt.
**Sinds oktober 2026 draait VeriPasso op Vercel (hosting) en Supabase (Postgres,
Auth, Storage) in plaats van Azure.** Het draaiboek voor de overstap staat in
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
  Fysiek verwijderen is verboden (QR- en auditcontinuïteit). Elke niet-actieve
  status blokkeert ook het gekoppelde Supabase Auth-account. `deleted` mag alleen de
  owner zetten, verwijdert het Supabase-account definitief en verdwijnt uit alle lijsten.
- Per bedrijf moet altijd ≥ 1 actieve Bedrijfsbeheerder overblijven (409 `LAST_COMPANY_ADMIN`).
- Company-rollen kunnen niet op een partnerbedrijf terechtkomen en andersom
  (anders zou een partner via een omweg productmodules krijgen).
- Impersonatie ("Inloggen als"): owner mag iedereen (ook partner admins),
  een Bedrijfsbeheerder alleen eigen medewerkers/beheerders; max 1 uur; nooit
  genest; alles herleidbaar in de auditlog (beide identiteiten).

### Partner-/resellerlaag

- `companies.kind` = `'customer' | 'partner'`; klanten kunnen een `partner_id`
  hebben (FK naar het partnerbedrijf; CHECK: alleen op klanten).
- `partner_id` is uitsluitend een **relatiespoor** ("aangebracht door") — geen
  aggregatieniveau. Limieten, verbruik en data blijven strikt per klant-tenant.
- Partnertoegang loopt uitsluitend via `/api/partner/*` (eigendomscheck
  `customer.partner_id === eigen bedrijf`; andermans klanten geven bewust 404):
  klanten aanmaken (alleen plannen met `partner_assignable = true`), licentie-inzage,
  invites voor de eerste beheerder, en wachtwoordreset van Bedrijfsbeheerders
  van eigen klanten (zie §2).
- Klant verhuizen (naar direct of een andere partner) doet alleen de owner via
  de bedrijvenpagina; data/producten/QR blijven onaangeroerd.

### Licenties/abonnementen

- Plannen (`plans`: `max_users`, `max_products`, `partner_assignable`) beheert
  alleen de owner. Per bedrijf: `plan_id` + `license_start`/`license_end`.
- `src/services/license.service.js` is de enige bron van waarheid:
  status `Actief` / `Bijna limiet` (≥ 80%) / `Limiet bereikt` / `Verlopen`.
  Verlopen blokkeert alleen **aanmaken** (bestaande data en publieke QR's blijven
  werken — bewuste keuze). Reactiveren van een gearchiveerde gebruiker telt mee
  voor de seat-limiet (geen gratis omweg).

---

## 2. Authenticatie (Supabase Auth, volledig server-side)

- **Login** loopt volledig via onze eigen API: de server controleert e-mail +
  wachtwoord bij Supabase Auth en maakt daarna een **eigen** sessie (httpOnly-cookie,
  alleen de hash in de tabel `sessions`). De browser praat nooit met Supabase; de
  tijdelijke Supabase-sessie wordt direct weer ingetrokken. Accounts worden bij
  aanmaak via de Auth-admin-API (service role) aangemaakt; het DPP-record koppelt via
  `users.auth_user_id` (= `auth.users.id`).
- Rol, bedrijf en status staan uitsluitend in VeriPasso's eigen `users`-tabel.
  Blokkeren/archiveren blokkeert ook het Supabase-account (ban), `deleted` verwijdert
  het. Zelfregistratie staat in Supabase uit ("Allow new users to sign up").
- **Break-glass**: het Platform Owner-account gebruikt bcrypt (lokaal wachtwoord) en
  werkt dus ook als Supabase Auth stuk is. In productie weigert de API te draaien
  zonder volledige configuratie (`CONFIG_INCOMPLETE`; zie
  `src/config/productionCheck.js`) — bewust: nooit stil terugvallen op bcrypt.
- **Tijdelijke wachtwoorden**: bij aanmaak/reset genereert de server een eenmalig
  getoond tijdelijk wachtwoord en zet `must_change_password`. Inloggen met een
  tijdelijk wachtwoord geeft géén sessie maar `{ mustChangePassword: true }`; de
  gebruiker zet eerst via `/api/auth/change-password` een eigen wachtwoord.
- **Wachtwoordresets**: owner en Bedrijfsbeheerder (eigen bedrijf) via
  `/api/users/:id/reset-password`; Partner Admin voor Bedrijfsbeheerders van eigen
  klanten via `/api/partner/customers/:id/admins/:userId/reset-password`
  (geblokkeerde accounts worden nooit stilzwijgend gereactiveerd; alle sessies van
  het doelwit worden ingetrokken; rate limit 15/15 min per partner; volledig
  geauditeerd zónder het wachtwoord).
- **Wachtwoord vergeten** (`/wachtwoord-vergeten`): Supabase Auth mailt een eenmalige
  code; tussen de stappen gaat een kortlevend, door de server ondertekend token
  (HMAC met `COOKIE_SECRET`). Vereist een eigen SMTP-server in Supabase (zie het
  draaiboek); zonder SMTP resetten beheerders het wachtwoord.
- **Bescherming**: rate limiting op login/reset (alleen mislukte pogingen tellen;
  tellers in de Postgres-tabel `rate_limits` zodat ze over alle Vercel-instances
  gelden), 1,2 s ondergrens op mislukte logins (timing/enumeratie), dummy-bcrypt bij
  onbekende accounts, gesaneerde logging (nooit bodies/tokens).
- **Uitnodigingen**: eenmalige activatielink (7 dagen geldig, token alleen in de
  API-respons, alleen de hash in de DB). Bij activatie kiest de eerste
  Bedrijfsbeheerder direct zijn eigen wachtwoord (het Supabase-account wordt dan
  aangemaakt). Er is bewust **geen** automatische e-mailverzending door de app — de
  link wordt handmatig gedeeld. Partnerbedrijven krijgen geen invites (partner
  admins maakt de owner aan via Gebruikers).
- MFA per e-mailcode (een Entra-functie) bestaat sinds de migratie niet meer.

---

## 3. Producten, documenten en QR

- Producten per tenant, met tabbladen (algemeen/duurzaamheid/compliance/
  onderdelen/batches/documenten), voortgang op 6 volledigheidscriteria
  (klikbaar: toont wat ontbreekt), en statussen incl. archiveren (soft).
- **Uploads**: foto's (JPEG/PNG/WEBP/GIF, max 5 MB) en documenten (PDF/JPEG/PNG/
  SVG/WEBP, max 10 MB) gaan **rechtstreeks van de browser naar een privé Supabase
  Storage-bucket** (een Vercel Function accepteert max. 4,5 MB per request):
  1. `POST /api/products/:id/photo/upload-url` (of `/documents/upload-url`) — de
     server controleert rechten, type en grootte en geeft een eenmalige upload-URL
     voor een door de server gekozen pad `{companyId}/{productId}/{uuid}.{ext}`;
  2. de browser PUT het bestand naar die URL;
  3. `POST /api/products/:id/photo` (of `/documents/upload`) — de server controleert
     het object (pad hoort bij dit product, type, grootte) en legt het dan pas vast.
  De buckets dwingen type en grootte ook zelf af (`npm run setup:storage`).
- **Downloads**: de server controleert de rechten en stuurt een redirect naar een
  signed URL die 2 minuten geldig is. De service-role-key verlaat nooit de server;
  zonder geldige sessie of `public_id` is er niets te raden of te benaderen.
- **QR**: formaat `{QR_BASE_URL}/p/{public_id}` (PNG/SVG/label-PDF te downloaden).
  Gedrukte QR-codes moeten eeuwig werken:
  - `QR_BASE_URL` = `https://qr.veripasso.com` en alleen met heel goede reden
    wijzigen (en dan met een permanente doorverwijzing);
  - een `public_id` wordt nooit gewijzigd, ook niet bij archiveren;
  - de `public_id` staat in de QR-URL in **hoofdletters** — zo gaf Azure SQL hem
    terug, dus een opnieuw gedownloade QR is identiek aan een al geprinte. De lookup
    is hoofdletterongevoelig (Postgres-`uuid`), dus beide schrijfwijzen werken.
- **QR reserveren vóór publicatie**: een concept kan al een `public_id` krijgen
  (knop "QR genereren", ook in bulk) zodat labels vooraf geprint kunnen worden. Die
  URL toont "nog niet gepubliceerd" tot het product gepubliceerd is.
- **Import** (`/company/import`, historie in `/company/imports`): Excel (.xlsx) of
  CSV wordt in de browser gelezen; rijen gaan in blokken van 250 naar
  `/api/imports/:id/rows`, waar de server alles opnieuw valideert, duplicaten op
  SKU/GTIN herkent (overslaan / bijwerken / toch aanmaken) en licentielimieten
  bewaakt. Geïmporteerde producten zijn altijd concept. Max. 20.000 rijen per import.
- **Bulkacties** (`POST /api/products/bulk`): publiceren (alleen complete
  producten), archiveren, herstellen, categorie, QR reserveren — op een selectie of
  op "alle resultaten van dit filter", max. 1.000 per actie, altijd binnen het
  bedrijf uit de sessie.
- **Print & labels** (`/company/instellingen/print`): printprofielen per bedrijf
  (papier/labelindeling, media, printer, QR-grootte/foutcorrectie/kleur, template).
  Te kleine QR (< 10 mm) of te weinig contrast wordt geweigerd, twijfelgevallen
  geven een waarschuwing. PDF/PNG/SVG-ZIP worden in de browser gemaakt (vector-QR in
  de PDF); de server levert de officiële QR-URL.
- **Documenten** hebben versie, taal, vervaldatum, uploader en kunnen gearchiveerd
  worden (dan niet meer op het paspoort en niet meer meegeteld voor compleetheid).
  Verlopen documenten geven een melding.
- De publieke paspoortpagina (`/p/[id]`) roept de paspoort-service rechtstreeks aan
  (geen tweede HTTP-call naar de eigen API) en registreert een scan in `scan_events`
  (user-agent/referrer, geen persoonsgegevens) — bron voor de QR-statistieken.

---

## 4. Menu's per rol (rolgestuurd)

- **Platform Owner**: Overzicht, Partners, Klantbedrijven, Alle gebruikers,
  Abonnementen, Auditlog, Systeemstatus, Instellingen.
- **Partner Admin**: Overzicht, Mijn klanten, Uitnodigingen, Licenties
  (Klantlicenties), Activiteiten, Instellingen, Help & support.
- **Bedrijfsbeheerder**: Overzicht, Producten, Documenten, QR-codes, Importeren,
  Print & labels, Medewerkers, Abonnement, Bedrijfsinstellingen, Help & support.
- **Medewerker**: Overzicht, Producten, Documenten, QR-codes, Importeren,
  Print & labels (alleen gebruiken, niet wijzigen), Mijn profiel, Help & support.
- Header (alle rollen): globale zoekfunctie (`/` of Ctrl+K) en meldingen.

Menu's verbergen is UI-comfort; élk endpoint dwingt de rol ook server-side af.

---

## 5. Monitoring & Systeemstatus

Owner-only observability-dashboard op `/admin/systeemstatus`, gebouwd zonder
externe (betaalde) telemetriedienst:

- **Request-telemetrie** (`src/monitoring/requestMetrics.js`): per request alleen
  tellers + duur-histogram. Routes worden tot patronen genormaliseerd (id's/GUID's/
  tokens eruit); query strings, headers, bodies en cookies worden nooit vastgelegd.
  Express meet de API, de paspoortpagina meet zichzelf (scope "public").
- **Persistentie op Vercel**: elke function-instance telt zijn aggregaten hooguit
  elke minuut op bij `system_request_metrics_hourly` (upsert, `src/monitoring/flush.js`,
  via `waitUntil`), 90 dagen retentie. Dagelijks om 03:17 UTC roept **Vercel Cron**
  `/api/cron/daily` aan (beveiligd met `CRON_SECRET`): snapshot naar
  `system_metrics_snapshots` (DB-grootte, per-tabel rijen/bytes, entiteitstellingen,
  opslag per bucket uit `storage.objects`; 400 dagen retentie) en opschonen van oude
  meetdata, verlopen sessies en rate-limit-tellers.
- **Databaseperformance** via `pg_stat_statements` en `pg_stat_activity`.
- **API** onder `/api/admin/system/*`: `health`, `overview`, `performance`,
  `database`, `growth` (incl. trendprognoses en dagen-tot-capaciteit; zet
  `SUPABASE_DB_MAX_BYTES` op het quotum van je plan), `storage`, `usage`, `errors`,
  `infra` (incl. commit/branch/deployment van Vercel), `POST snapshot` ("Nu meten").
  Drempelwaarden staan centraal in `src/config/monitoring.js`.
- **Healthchecks**: database (`SELECT 1`), Supabase Storage (bucket bestaat) en
  Supabase Auth (`/auth/v1/health`).
- **Publieke health**: `GET /api/health` → alleen `OK` (geschikt voor een externe
  uptime-monitor). Geen infrastructuurdetails publiek.
- **Per-instance-gegevens**: live-minuutgrafiek, recente foutdetails, geheugen en
  uptime gelden voor de Vercel-instance die het verzoek afhandelde; de uur- en
  dagcijfers in de database zijn volledig. Dat staat ook zo in de UI.
- **Beveiliging**: alle routes 401 anoniem / 403 voor partner-, beheerders- en
  medewerkersrollen (getest); responses bevatten aantoonbaar geen secrets;
  foutmeldingen worden gesaneerd.

---

## 6. Lokale setup

1. `npm install`
2. Een Postgres-database: een eigen (gratis) Supabase-ontwikkelproject, of lokaal
   Postgres 16 (`DATABASE_SSL=false`). Gebruik **nooit** de productie-database
   voor ontwikkeling of tests.
3. Kopieer `.env.example` naar `.env` (wordt nooit gecommit) en vul in. Zonder
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` draait de app lokaal in "lokale modus":
   nieuwe accounts krijgen een bcrypt-wachtwoord en uploads geven een nette 503.
4. `npm run test:db` — check de databaseverbinding
5. `npm run migrate` — schema (idempotent, `migrations/*.sql`)
6. `npm run setup:storage` — privé buckets (alleen met Supabase)
7. `npm run seed:owner` — maakt/actualiseert het Platform Owner-account
   (`SYSTEM_OWNER_*` tijdelijk in `.env`, daarna weer verwijderen)
8. `npm run dev` — Next.js + API op http://localhost:3000

Achter de zakelijke proxy (Zscaler): zet `NODE_EXTRA_CA_CERTS` naar het
geëxporteerde root-CA-bestand (zie `scripts/export-zscaler-ca.ps1`), anders
falen alle TLS-verbindingen (Supabase, tests).

---

## 7. Infrastructuur en deploy (Vercel + Supabase)

Geen van onderstaande gegevens is een secret — dit is zodat iedereen zonder
sessie-geheugen weet hoe de live omgeving in elkaar zit.

- **Hosting: Vercel**, één project vanuit deze repo, functions in regio `fra1`
  (Frankfurt). Next.js serveert de pagina's; alle `/api/*`-verzoeken gaan naar de
  bestaande Express-app via één Vercel Function (`pages/api/[...path].js`, max.
  60 s). Configuratie: `vercel.json`, `next.config.mjs`.
- **Domeinen** (DNS bij TransIP, certificaten automatisch door Vercel):
  `app.veripasso.com` (`APP_BASE_URL`), `qr.veripasso.com` (`QR_BASE_URL`, staat in
  alle geprinte QR-codes — **dit domein moet altijd naar de app blijven wijzen**),
  apex `veripasso.com` (landingspagina). Alle drie wijzen naar hetzelfde project.
- **Deploy**: Vercel Git-integratie. Push naar `main` = productie; elke andere
  branch/PR krijgt een preview-deployment (gebruik daar een aparte Supabase-
  testomgeving, nooit de productie-database). Rollback: in Vercel een eerdere
  deployment "Promote to Production".
- **CI** (`.github/workflows/ci.yml`): bij elke push/PR `npm ci`, schema op een
  wegwerp-Postgres in de runner, `npm test` en `npm run build`. Geen secrets nodig.
- **Database: Supabase Postgres** (regio Central EU / Frankfurt). De app verbindt via
  de transaction pooler (poort 6543) met een kleine pool per instance. Migraties
  (`npm run migrate`) draai je lokaal tegen de session pooler (poort 5432). Alle
  tabellen hebben RLS aan zonder policies en `anon`/`authenticated` hebben geen
  rechten: niets is via de publieke Supabase-REST-API bereikbaar.
- **Bestanden: Supabase Storage**, privé buckets `product-images` en
  `product-documents` (limieten via `npm run setup:storage`).
- **Identity: Supabase Auth** (zelfde project). Instellingen: zie het draaiboek
  (signups uit, minimaal 12 tekens, "Reset Password"-template met `{{ .Token }}`).
- **Kosten**: Vercel Pro (commercieel gebruik; Hobby is alleen niet-commercieel) en
  Supabase Pro (geen automatische pauze, dagelijkse back-ups). Alles wat extra geld
  kost wordt eerst gemeld en pas na expliciet akkoord van de Platform Owner gebouwd.
- **Bekende valkuilen**:
  - Vercel Functions: max. 4,5 MB per request/response — bestanden dus nooit via de
    API laten lopen (zie §3).
  - Geen langlevend serverproces: niets met `setInterval`/in-memory status bouwen
    dat over requests heen moet bestaan; gebruik de database of Vercel Cron.
  - Route-volgorde in Express: letterlijke routes vóór parameterroutes
    registreren (`/impersonate/stop` vóór `/:userId`, `/stats` vóór `/:id`).
  - Postgres vergelijkt tekst hoofdlettergevoelig: e-mail en slug zijn daarom
    `citext`; zoeken gebruikt `ILIKE`.
  - Zakelijk netwerk (Zscaler) her-signeert TLS en onderschept veripasso.com —
    live testen via mobiele data.

---

## 8. Projectstructuur (hoofdlijnen)

```
app/                           Next.js App Router: admin (owner), partner, company, login,
                               wachtwoord-vergeten, activate, p/[id] (publiek paspoort)
components/, lib/              UI-componenten en frontend-helpers (lib/api.js incl. directe upload)
pages/api/[...path].js         Vercel Function: alle /api/*-verzoeken → Express (src/app.js)
src/
  app.js                       Express-app: telemetrie, routes, publieke /api/health
  config/                      db (pg-pool), supabase, productionCheck, monitoring (drempels), zod-NL
  middleware/                  auth (sessies, requireAuth/requireRole, impersonatieblokken),
                               rateLimit (+ Postgres-store), validate, errorHandler
  monitoring/                  requestMetrics (telemetrie), flush (persistentie per instance),
                               collectors (DB/opslag/tellingen), health (checks, 30s cache)
  repositories/                SQL per entiteit (companies incl. partner-join, users, products,
                               plans, invites, auditLogs, scanEvents, ...)
  routes/                      auth, companies (owner), users, products, plans, partner (/api/partner),
                               admin (impersonatie/licenties/config-status), systemMonitoring,
                               dashboard, company, audit, inviteActivation, passwordReset,
                               publicProducts, cron (Vercel Cron)
  services/                    license.service (één bron van waarheid), identity (Supabase Auth),
                               storage (Supabase Storage), publicPassport, qrCode
  utils/                       roles, tenant (assertCompanyAccess), auditLog, password,
                               tempPassword, baseUrl (incl. QR-URL), signedToken
migrations/                    001_initial_schema.sql (Postgres, idempotent)
scripts/                       migrate, seed-system-owner, check-db-connection, setup-supabase-storage,
                               cleanup-test-data (DB + Supabase Auth), e2e-supabase-live,
                               migrate-from-azure (eenmalig)
tests/                         node --test tegen een eigen Postgres (auth, tenant-isolatie,
                               licenties, partnerlaag, partner-wachtwoordreset, impersonatie,
                               documenten/foto's, user-delete, systeemmonitoring, wachtwoordherstel)
docs/                          migratie-azure-naar-vercel-supabase.md (draaiboek)
```

---

## 9. Tests en verificatie

- `npm test` — volledige suite tegen de database uit `DATABASE_URL` (een lokale/
  wegwerp-Postgres; fixtures ruimen zichzelf op via `tests/helpers/fixtures.js`).
  Stand 2026-10-08: **153 tests: 149 geslaagd, 0 gefaald, 4 overgeslagen** (de overgeslagen
  tests vereisen een echt Supabase-project voor Auth/Storage en draaien zodra
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` gezet zijn). CI draait dezelfde suite.
- Live rooktest tegen de echte omgeving (wegwerp-testaccounts, ruimt álles op:
  database, Supabase Auth, Storage):
  `E2E_BASE_URL=https://app.veripasso.com node scripts/e2e-supabase-live.js`.
- `node scripts/cleanup-test-data.js` toont achtergebleven testdata;
  `--apply` ruimt het op (database + Supabase Auth).
- Regel: **nooit pushen zonder groene suite**; live verifiëren na elke
  infrastructuurwijziging.

---

## 10. TODO / openstaand werk

Bijgewerkt 2026-10-07.

### Migratie Azure → Vercel + Supabase (portal-acties, zie het draaiboek)
- [ ] Supabase-project (EU) inrichten: Auth-instellingen, "Reset Password"-template,
      eventueel SMTP; `npm run migrate` en `npm run setup:storage`.
- [ ] Vercel-project + environment variables + domeinen.
- [ ] Generale repetitie van `scripts/migrate-from-azure.js` op een wegwerpproject.
- [ ] Cutover (App Service stoppen → migratie → DNS) en live verificatie.
- [ ] Tijdelijke wachtwoorden veilig verdelen; CSV daarna verwijderen.
- [ ] Besluit `azurewebsites.net`-QR-codes: zijn er geprinte codes met die hostname?
      Zo ja, gratis F1-redirect laten staan (zie draaiboek §4).
- [ ] Azure opruimen (na eindback-up) en GitHub-secrets `AZUREAPPSERVICE_*` verwijderen.
- [ ] Besluit Vercel Pro + Supabase Pro (kosten; Free/Hobby is niet geschikt voor productie).

### Product / features
- [ ] Zelf-beheerde categorieën (echte `categories`-tabel i.p.v. vrij tekstveld).
- [ ] Uitbreidbare productvelden — architectuurkeuze (kolommen vs. JSONB vs. EAV)
      eerst samen maken.
- [ ] Selfservice-registratie + online betaling (Route B-voorkant): vergt
      prijsvelden op plannen, betaalprovider (kosten! eerst overleg),
      e-mailverzending en automatische provisioning.
- [ ] "Geschiedenis"-tab per product (auditdata bestaat al, UI ontbreekt).
- [ ] Retentiebeleid auditlogs (geen automatische verwijdering zonder akkoord).
- [ ] Eventueel MFA terug (Supabase Auth ondersteunt TOTP).

### UX-traject (zie `docs/ux-implementatieplan.md`)
- [ ] Na deploy: `npm run migrate` draaien voor `002_import_and_print.sql` en
      `003_documents_users_billing.sql` (alleen nieuwe tabellen/kolommen/indexen).
- [ ] Prijzen en (optioneel) opslag-/scanlimieten invullen bij Abonnementen.
- [ ] Besluit betaalprovider/facturatie (nu alleen gegevens + maandbedrag).
- [ ] Eventueel MFA en documenten aan meerdere producten koppelen (eerst ontwerp).

### Infra / later
- [ ] Aparte Supabase-omgeving voor preview-deployments.
- [ ] Externe uptime-monitor op `https://qr.veripasso.com/api/health`.
- [ ] Point-in-time-recovery (Supabase add-on) overwegen — kosten eerst melden.

### Back-up buiten git (zelf doen, bijv. wachtwoordmanager)
- [ ] Inhoud van je lokale `.env` en de Vercel Environment Variables (namen staan in
      `.env.example`; waarden zijn secret en staan nergens anders).
- [ ] Supabase-databasewachtwoord en service-role-key.
