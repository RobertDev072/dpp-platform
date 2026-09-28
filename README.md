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
naar GitHub.

## Projectstructuur

```
server.js                     Entrypoint: laadt .env en start de Express-app
src/
  app.js                      Express-app: middleware en routes
  config/db.js                Herbruikbare Azure SQL connection pool
  middleware/
    errorHandler.js           Centrale error handling (HttpError, notFoundHandler, errorHandler)
    validate.js                Input-validatie op basis van zod-schema's
  routes/                     Express routers
  utils/password.js           Wachtwoord hashen/verifiëren (bcrypt)
migrations/                   Idempotente SQL-migraties, uitgevoerd door scripts/migrate.js
scripts/
  migrate.js                  Migratierunner (houdt bij welke migraties al zijn toegepast)
  seed-system-owner.js        Maakt/werkt het eerste System Owner-account bij
  test-db-connection.js       Losse test van de databaseverbinding
```
