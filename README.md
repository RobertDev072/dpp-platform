# DPP Platform

Multi-tenant SaaS-platform voor Digital Product Passport (DPP) implementatie in de EU.

## Lokale setup

1. Installeer dependencies:
   ```
   npm install
   ```
2. Maak een `.env`-bestand in de projectroot (dit bestand wordt nooit gecommit) met:
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

   # Alleen lokaal, voor een SQL Server-container met een self-signed certificaat (zie
   # "Tests"). NOOIT zetten op Azure: dan wordt het servercertificaat niet meer gecontroleerd.
   DB_TRUST_SERVER_CERTIFICATE=

   # Alleen nodig om eenmalig scripts/seed-system-owner.js te draaien.
   # Verwijder deze twee regels weer uit .env zodra de System Owner is aangemaakt.
   SYSTEM_OWNER_EMAIL=
   SYSTEM_OWNER_PASSWORD=
   SYSTEM_OWNER_FIRST_NAME=
   SYSTEM_OWNER_LAST_NAME=

   # Optioneel: Microsoft Entra External ID als identity provider. Zolang deze niet
   # (volledig) zijn ingevuld blijft de bcrypt/sessie-login hierboven gewoon werken.
   # Zie docs/entra-external-id-setup.md voor de volledige, handmatige Azure-setup.
   ENTRA_TENANT_NAME=
   ENTRA_TENANT_ID=
   ENTRA_WEB_CLIENT_ID=
   ENTRA_WEB_CLIENT_SECRET=
   ENTRA_GRAPH_CLIENT_ID=
   ENTRA_GRAPH_CLIENT_SECRET=
   ENTRA_REDIRECT_URI=
   ENTRA_POST_LOGOUT_REDIRECT_URI=
   COOKIE_SECRET=

   # Optioneel, in productie sterk aanbevolen: vaste basis-URL voor publieke DPP-links,
   # QR-codes en activatielinks (bijv. https://dpp.voorbeeld.nl, zonder slash aan het eind).
   # Zonder deze waarde komt de basis-URL uit de Host-header van het verzoek; een geprinte
   # QR-code mag daar nooit van afhangen.
   PUBLIC_BASE_URL=

   # Optioneel: naam van een header die een vertrouwde proxy vóór de app zet met een
   # ISO-landcode (twee letters) voor de scanstatistieken. Leeg laten als zo'n proxy er niet
   # is: dan kan iedere bezoeker de header vervalsen en slaat de app geen land op.
   SCAN_COUNTRY_HEADER=

   # Alleen achter een reverse proxy (zoals Azure App Service) op true zetten, zodat de app
   # het echte client-IP ziet. Lokaal leeg laten.
   TRUST_PROXY=
   ```
3. Test de databaseverbinding:
   ```
   npm run test:db
   ```
4. Voer de database-migraties uit (maakt de tabellen aan):
   ```
   npm run migrate
   ```
5. Maak het eerste System Owner-account aan (vereist `SYSTEM_OWNER_EMAIL`/`SYSTEM_OWNER_PASSWORD` in `.env`):
   ```
   npm run seed:owner
   ```
6. Start de app:
   ```
   npm start
   ```

## Tests

De testsuite (`npm test` = `node --test`, bestanden in `tests/*.test.js`) bestaat uit
integratietests: elke test start de Express-app op een willekeurige poort en praat met een
echte SQL Server. De tests maken hun eigen data aan (bedrijven/gebruikers met `test-…`-namen)
en ruimen die daarna weer op. **Draai ze nooit tegen de Azure- of productiedatabase**, maar
tegen een lokale SQL Server-container:

1. Start SQL Server in Docker (of Podman) en maak een lege testdatabase aan. Kies zelf een
   sterk wachtwoord (SQL Server eist minimaal 8 tekens met hoofdletters, kleine letters,
   cijfers en symbolen) en zet het nergens in de repo:
   ```
   docker run -d --name dpp-sql -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<sterk-wachtwoord>" \
     -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
   docker exec dpp-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "<sterk-wachtwoord>" -C \
     -Q "CREATE DATABASE dpp_test"
   ```
2. Zet de verbinding als environment variables in je shell. Die gaan vóór `.env` (dotenv
   overschrijft bestaande variabelen niet), zodat je `.env` voor de echte omgeving kunt laten staan:
   ```
   export DB_SERVER=127.0.0.1 DB_DATABASE=dpp_test DB_USER=sa DB_PASSWORD='<sterk-wachtwoord>' \
     DB_TRUST_SERVER_CERTIFICATE=true NODE_ENV=development
   ```
   `DB_TRUST_SERVER_CERTIFICATE=true` is nodig omdat de container een self-signed certificaat
   heeft (de verbinding blijft versleuteld). Laat alle `ENTRA_*`-variabelen leeg: de tests
   loggen in via de lokale login (`POST /api/auth/login`), en die is in Entra-modus dicht.
   De Node-waarschuwing `DEP0123` (TLS ServerName met een IP-adres) is onschuldig.
3. Migraties draaien en de tests starten:
   ```
   npm run migrate
   npm test
   ```
   Eén bestand los: `node --test tests/products-flow.test.js`.

De GitHub Actions-workflow draait de tests bewust niet: daar is geen database beschikbaar.
Draai `npm test` daarom lokaal vóór elke push.

## Voor Azure App Service

Dezelfde variabelen (`DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `PORT`) worden ingesteld als
Application Settings in de Azure Portal, niet in een `.env`-bestand. Er worden nooit secrets gecommit
naar GitHub. Zet daar ook `PUBLIC_BASE_URL` (de publieke https-URL van de app) en `TRUST_PROXY=true`:
App Service zet altijd een reverse proxy vóór de app. Zonder `TRUST_PROXY=true` ziet de app voor
iedereen hetzelfde proxy-IP. De publieke DPP-API (`/api/public/dpp/...`, 120 verzoeken per minuut
per IP) blokkeert dan alle bezoekers tegelijk zodra de limiet op is, en de login-limiet (per IP +
e-mailadres) kan dan door iedereen voor elk account worden opgebruikt. Zet `NODE_ENV=development` **niet** als Application Setting op Azure — de sessie-cookie
staat dan onterecht op `secure=false` en de app stuurt dan geen HSTS-header meer. Zet in de Azure Portal onder "TLS/SSL settings" ook "HTTPS Only"
aan, zodat de sessie-cookie nooit onversleuteld over het netwerk kan gaan. "HTTPS Only" geeft alleen een
301 van http naar https; de app stuurt zelf `Strict-Transport-Security` mee (`src/middleware/securityHeaders.js`),
zodat de browser na het eerste bezoek niet meer via http begint.

## Microsoft Entra External ID (identity provider)

Zie [docs/entra-external-id-setup.md](docs/entra-external-id-setup.md) voor de volledige,
handmatige Azure-configuratie (tenant, app-registraties, Graph-permissies, Conditional
Access/MFA, SSPR). De code schakelt automatisch over zodra alle `ENTRA_*`-variabelen
gezet zijn — er hoeft niets in de code aangepast te worden.

## Projectstructuur

```
server.js                       Entrypoint: laadt .env en start de Express-app
src/
  app.js                        Express-app: middleware, alle routers en de statische frontend
  auth/permissions.js           Rollen, permissies en ASSIGNABLE_BY_COMPANY_ADMIN (bron van de matrix)
  config/
    db.js                       Herbruikbare SQL Server connection pool
    entra.js                    Entra-configuratie + isEntraConfigured()-schakelaar
  middleware/
    auth.js                     Sessies, requireAuth, requirePermission
    errorHandler.js             HttpError, notFoundHandler, centrale errorHandler
    validate.js                 validateBody op basis van zod-schema's
    rateLimit.js                In-memory rate limiter (login, uitnodigingen, publieke DPP)
    securityHeaders.js          CSP, HSTS en overige security-headers
  routes/
    home.routes.js              / en /login.html (ingelogd -> door naar de eigen omgeving)
    auth.routes.js              /api/auth: config, lokale login, logout, me
    entraAuth.routes.js         /auth: Entra-login, callback /auth/redirect, logout
    companies.routes.js         /api/admin/companies (+ uitnodigingen per bedrijf)
    plans.routes.js             /api/admin/plans
    adminInvitations.routes.js  /api/admin/invitations (lijst, intrekken, opnieuw versturen)
    adminStats.routes.js        /api/admin/stats en /api/admin/settings
    invitations.routes.js       /api/invitations/lookup|accept (publiek, token in de body)
    audit.routes.js             /api/audit (System Owner)
    users.routes.js             /api/users (Company Admin: eigen company; SO: alle)
    company.routes.js           /api/company: eigen bedrijf, dashboard, rapportages, audit
    products.routes.js          /api/products: CRUD, statusflow, checklist, QR, documenten
    documents.routes.js         /api/documents
    public.routes.js            /p/:publicId en /api/public/dpp/:publicId (geen login)
  repositories/                 SQL per entiteit, alleen geparametriseerde queries
  schemas/                      zod-schema's per domein
  services/
    msalClients.js              MSAL Node confidential clients (web + Graph-daemon)
    graphClient.js              Microsoft Graph-aanroepen (user create/enable/reset)
    entraLogin.service.js       JIT-koppeling van de Entra sub-claim aan een DPP-user
    invitation.service.js       Company Admin-uitnodigingen (token, accepteren, Entra-account)
    seats.service.js            Licentie-/seattelling
    productWorkflow.js          Statusovergangen en publicatie-checklist
    qr.service.js               QR-codes (PNG/SVG) voor de publieke URL
  utils/
    tenant.js, auditLog.js      Tenant-isolatie (cross-tenant = 404) en audit logging
    params.js                   parseId voor ids in de URL
    publicUrl.js                Basis-URL voor publieke links (PUBLIC_BASE_URL)
    password.js                 Wachtwoord hashen/verifiëren (bcrypt, lokale login)
    tempPassword.js             Tijdelijke wachtwoorden (nooit opgeslagen)
    oauthState.js               Gesigneerde cookie voor de korte OIDC-state-handshake
public/
  login.html, activate.html     Inloggen en uitnodiging activeren (DPP-huisstijl)
  admin/                        System Owner-omgeving (dashboard, bedrijven, plannen, audit, ...)
  app/                          Company-omgeving (dashboard, producten, gebruikers, QR, ...)
  dpp.html                      Publieke, mobiel-first DPP-pagina (/p/<public_id>)
  js/                           api.js, dom.js (DPP.el e.d.), layout.js (DPP.initPage) + per omgeving
  css/                          styles.css (basis) + admin.css, app.css, dpp.css
migrations/                     Idempotente SQL-migraties, uitgevoerd door scripts/migrate.js
scripts/
  migrate.js                    Migratierunner (houdt bij welke migraties al zijn toegepast)
  seed-system-owner.js          Maakt/werkt het eerste System Owner-account bij
  check-db-connection.js        Losse check van de databaseverbinding
docs/
  architecture-roles.md         Bron van waarheid: rollen, permissies, statusflow en API-contract
  entra-external-id-setup.md    Handmatige Azure-configuratie voor Entra External ID
tests/                          Integratietests (node --test), zie "Tests"; helpers/ = testserver + fixtures
```
