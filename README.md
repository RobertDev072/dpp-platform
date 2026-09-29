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

   # Optioneel: Azure Blob Storage voor productfoto-uploads (naast de bestaande optie om
   # een externe URL te plakken). Er staat GEEN storage-accountkey of connection string
   # in de app: authenticatie loopt via DefaultAzureCredential (@azure/identity), dat in
   # Azure App Service automatisch de system-assigned Managed Identity gebruikt. Zolang
   # AZURE_STORAGE_ACCOUNT_NAME niet is gezet, geeft de upload-knop een duidelijke
   # foutmelding i.p.v. stil te falen; de URL-optie blijft altijd werken.
   #
   # De containers ("product-images", "product-documents") zijn en blijven PRIVE - geen
   # anonieme/publieke blob-toegang. Productfoto's zijn zonder login zichtbaar op de
   # publieke DPP-paspoortpagina via een eigen media-endpoint
   # (/api/public/products/:publicId/photo): de server haalt de blob zelf op met de
   # Managed Identity en streamt de bytes door, er wordt nooit een directe blob-URL of
   # SAS-link naar de browser gestuurd.
   #
   # Benodigde RBAC-roltoewijzing (Azure Portal > het storage account > Access control
   # (IAM) > Add role assignment), toegekend aan de Managed Identity van de App Service:
   #   - "Storage Blob Data Contributor" (lezen/schrijven van blobs)
   # Lokaal ontwikkelen zonder een App Service-identity: draai `az login` met een
   # AAD-account dat dezelfde rol heeft op het storage account, of zet
   # AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID voor een service principal
   # (DefaultAzureCredential probeert beide automatisch).
   AZURE_STORAGE_ACCOUNT_NAME=
   AZURE_STORAGE_IMAGES_CONTAINER=product-images
   AZURE_STORAGE_DOCUMENTS_CONTAINER=product-documents
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

Dezelfde variabelen (`DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `PORT`, en indien gebruikt
`AZURE_STORAGE_ACCOUNT_NAME`/`AZURE_STORAGE_IMAGES_CONTAINER`/`AZURE_STORAGE_DOCUMENTS_CONTAINER`)
worden ingesteld als Application Settings in de Azure Portal, niet in een `.env`-bestand. Er worden
nooit secrets gecommit naar GitHub - voor Blob Storage is dat ook niet nodig: met de system-assigned
Managed Identity van de App Service (Identity-blad > System assigned > On) plus de RBAC-roltoewijzing
hierboven is er helemaal geen storage-accountkey of connection string om te bewaren.
Zet `NODE_ENV=development` **niet** als Application Setting op Azure — de sessie-cookie
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
