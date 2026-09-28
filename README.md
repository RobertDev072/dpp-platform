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

## Voor Azure App Service

Dezelfde variabelen (`DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `PORT`) worden ingesteld als
Application Settings in de Azure Portal, niet in een `.env`-bestand. Er worden nooit secrets gecommit
naar GitHub. Zet `NODE_ENV=development` **niet** als Application Setting op Azure — de sessie-cookie
staat dan onterecht op `secure=false`. Zet in de Azure Portal onder "TLS/SSL settings" ook "HTTPS Only"
aan, zodat de sessie-cookie nooit onversleuteld over het netwerk kan gaan.

## Microsoft Entra External ID (identity provider)

Zie [docs/entra-external-id-setup.md](docs/entra-external-id-setup.md) voor de volledige,
handmatige Azure-configuratie (tenant, app-registraties, Graph-permissies, Conditional
Access/MFA, SSPR). De code schakelt automatisch over zodra alle `ENTRA_*`-variabelen
gezet zijn — er hoeft niets in de code aangepast te worden.

## Projectstructuur

```
server.js                     Entrypoint: laadt .env en start de Express-app
src/
  app.js                      Express-app: middleware en routes
  config/
    db.js                     Herbruikbare Azure SQL connection pool
    entra.js                  Entra-configuratie + isEntraConfigured()-schakelaar
  middleware/
    auth.js                   Sessies (login/logout), requireAuth/requireRole
    errorHandler.js           Centrale error handling (HttpError, notFoundHandler, errorHandler)
    validate.js                Input-validatie op basis van zod-schema's
  repositories/                SQL-toegang per entiteit (companies/users/products/plans)
  routes/                     Express routers
  services/
    msalClients.js             MSAL Node confidential clients (web + Graph-daemon)
    graphClient.js              Microsoft Graph-aanroepen (user create/enable/reset)
    entraLogin.service.js       Zuivere JIT-koppeling van Entra sub-claim aan DPP-user
  utils/
    password.js                Wachtwoord hashen/verifiëren (bcrypt, legacy login)
    tempPassword.js             Genereert tijdelijke wachtwoorden (nooit opgeslagen)
    oauthState.js               Signed cookie voor de korte OIDC-state-handshake
    tenant.js, auditLog.js      Tenant-isolatie en audit logging
migrations/                   Idempotente SQL-migraties, uitgevoerd door scripts/migrate.js
scripts/
  migrate.js                  Migratierunner (houdt bij welke migraties al zijn toegepast)
  seed-system-owner.js        Maakt/werkt het eerste System Owner-account bij
  check-db-connection.js      Losse check van de databaseverbinding
docs/
  entra-external-id-setup.md  Handmatige Azure-configuratie voor Entra External ID
tests/                        Geautomatiseerde tests (node --test): auth, tenant-isolatie,
                               Entra just-in-time linking, license-limits
```
