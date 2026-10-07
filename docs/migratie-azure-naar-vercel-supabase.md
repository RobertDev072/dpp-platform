# Draaiboek: van Azure naar Vercel + Supabase

Doel: VeriPasso volledig van Azure af, **zonder dat één gedrukte QR-code, activatielink
of productfoto breekt**. De code is al omgebouwd (zie README §2, §3 en §7); dit
document beschrijft de eenmalige overstap.

| Was (Azure) | Wordt |
|---|---|
| App Service `dpp-platform-dev` (B1, Central US) | Vercel-project, regio `dub1` (Dublin) |
| Azure SQL serverless | Supabase Postgres (`eu-west-1`, Ierland), schema `dbo` |
| Blob Storage `stveripassodev01` (Managed Identity) | Supabase Storage, privé-buckets |
| Entra External ID + Graph | Lokale wachtwoorden (bcrypt); Entra alleen nog tijdelijk als overgang |
| GitHub Actions → `az webapp deploy` | Git-koppeling van Vercel |
| In-process scheduler | Vercel Cron (`/api/cron/daily`) + flush na requests |
| App Service Managed Certificates | Automatische certificaten van Vercel |

Bijkomend voordeel: data staat voortaan in de EU (Ierland) i.p.v. Central US.

---

## 0. Vooraf beslissen (kosten — eerst akkoord)

- **Vercel Pro** (± $20/maand per teamlid). Hobby mag niet commercieel gebruikt worden.
- **Supabase Pro** (± $25/maand). Free pauzeert na 7 dagen zonder activiteit — dan
  werken QR-codes niet — en heeft geen dagelijkse back-ups.
- **Oude Azure-hostnaam** (zie §6): zijn er QR-codes gedrukt met
  `dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net`? Zo ja, dan blijft
  er één gratis Azure-onderdeel nodig, of die codes moeten worden vervangen.

## 1. Supabase inrichten

1. Nieuw project, regio **West EU (Ireland)**, sterk databasewachtwoord.
2. Noteer (Project → Connect / Settings → API):
   - `DATABASE_URL` → **Transaction pooler** (poort 6543) voor Vercel;
   - de **Session pooler** of directe URL (poort 5432) voor migraties/scripts;
   - `SUPABASE_URL` (`https://<ref>.supabase.co`) en de **service_role**-key.
3. Lokaal in `.env` zetten (README §6) en draaien:
   ```
   npm install
   npm run test:db
   npm run migrate          # schema dbo + buckets product-images / product-documents
   ```
4. Controleer in Supabase → Storage dat beide buckets **niet** publiek zijn.
5. Database → Backups: controleer dat dagelijkse back-ups aan staan (Pro), en zet
   eventueel Point-in-Time Recovery aan (meerprijs).

## 2. Vercel inrichten (nog zonder eigen domeinen)

1. Vercel → Add New Project → deze GitHub-repo, framework **Next.js**, root = repo-root.
   Build/Install commando's standaard laten.
2. Environment Variables (Production), zie README §7:
   `DATABASE_URL` (pooler 6543), `DATABASE_MAX_BYTES=8589934592`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `COOKIE_SECRET` (dezelfde waarde als op Azure),
   `APP_BASE_URL=https://app.veripasso.com`, `QR_BASE_URL=https://qr.veripasso.com`,
   `CRON_SECRET` (nieuw, lange random string),
   `ENTRA_TENANT_NAME=DPPPlatform` en `ENTRA_WEB_CLIENT_ID` (de bestaande web-app-
   registratie; alleen het client-id, geen secret).
3. Deploy. Test op het `*.vercel.app`-adres met een lege database: inloggen als
   owner werkt pas na stap 3 hieronder (of na `npm run seed:owner`).
   > Gebruik het `*.vercel.app`-adres **nooit** als `QR_BASE_URL`.

## 3. Data overzetten (onderhoudsvenster, ± 15–30 min)

1. Kondig een kort onderhoudsvenster aan; laat niemand meer wijzigen op Azure.
2. Tijdelijk de Azure-pakketten installeren (komen niet in `package.json`) en inloggen:
   ```
   npm install --no-save mssql @azure/storage-blob @azure/identity
   az login
   ```
3. In `.env` aanvullen met de oude Azure-gegevens:
   `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD`,
   `AZURE_STORAGE_ACCOUNT_NAME=stveripassodev01`. Gebruik voor `DATABASE_URL` hier de
   **Session pooler** of directe URL.
4. Draaien:
   ```
   npm run migrate:from-azure
   ```
   Het script kopieert alle tabellen (zelfde id's en `public_id`'s) in één transactie,
   kopieert alle bestanden (zelfde objectnamen), vergelijkt aantallen per tabel en
   controleert dat elk bestand waar een product/document naar verwijst in Supabase staat.
   Faalt de databasestap, dan blijft Supabase leeg (opnieuw proberen kan). De
   bestandsstap kan los herhaald worden: `node scripts/migrate-from-azure.js --files-only`.
5. Sessies worden niet meegenomen: iedereen logt na de overstap opnieuw in.
6. Na afloop de `AZURE_*`-regels weer uit `.env` halen.

## 4. Testen vóór de DNS-wissel

Op het `*.vercel.app`-adres:
- [ ] Inloggen als owner (lokaal wachtwoord).
- [ ] Inloggen met een bestaand Entra-account → lukt met het oude wachtwoord en in
      Systeemstatus/auditlog verschijnt `password_migrated`.
- [ ] Partner- en bedrijfsomgeving: producten, documenten, QR-overzicht.
- [ ] Productfoto en document openen (doorverwijzing naar Supabase werkt).
- [ ] Nieuwe foto (> 4,5 MB werkt ook) en nieuw PDF-document uploaden.
- [ ] Publiek paspoort: `https://<project>.vercel.app/p/<PUBLIC_ID>` voor een product
      waarvan een **gedrukte** QR-code bestaat — met de id exact zoals in de code
      (hoofdletters).
- [ ] QR-PNG van datzelfde product downloaden: de URL erin moet nog steeds
      `https://qr.veripasso.com/p/<ZELFDE ID>` zijn (Systeemstatus → Configuratie toont
      `QR_BASE_URL`).
- [ ] Systeemstatus: database, opslag en "Nu meten" werken.

## 5. DNS omzetten (TransIP)

In Vercel → Project → Settings → Domains de domeinen toevoegen; Vercel toont per
domein de exacte record (de waarden hieronder zijn de gebruikelijke).

| Domein | Record bij TransIP | Opmerking |
|---|---|---|
| `qr.veripasso.com` | CNAME → `cname.vercel-dns.com.` (of de waarde die Vercel toont) | **Op elke gedrukte QR-code.** |
| `app.veripasso.com` | CNAME → idem | Activatielinks, login |
| `veripasso.com` | A → `76.76.21.21` (of wat Vercel toont) | Landingspagina; `www` eventueel als redirect |

Werkwijze om downtime voor QR-scans te minimaliseren:
1. Zet de TTL van de drie records bij TransIP een dag vooraf op 300 seconden.
2. Laat Vercel het domein eerst verifiëren (eventueel via de TXT-record die Vercel
   vraagt) zodat het certificaat klaar staat.
3. Wissel `qr.` als eerste, en controleer direct via **mobiele data** (Zscaler
   onderschept veripasso.com op het zakelijke netwerk):
   - een gedrukte QR-code scannen → paspoort verschijnt, met foto en documenten;
   - `https://qr.veripasso.com/api/health` → `OK`.
4. Daarna `app.` en de apex.
5. Laat de App Service nog minimaal een week draaien (zelfde data is bevroren, maar
   resolvers met oude DNS-cache komen er nog even uit). Zet daarna de TTL terug.

## 6. Het oude `*.azurewebsites.net`-adres

`dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net` is een Microsoft-
domein: alleen een draaiende App Service met precies die naam kan het beantwoorden.

- **Zijn er nooit QR-codes met dit adres gedrukt** (alle codes gebruiken
  `qr.veripasso.com`)? Dan kan de App Service na de overgangsweek gewoon weg.
- **Wel gedrukt?** Kies:
  - (a) de App Service houden op het **gratis F1-plan** met alleen een permanente
    redirect `/p/*` → `https://qr.veripasso.com/p/*` (€ 0, maar wel een Azure-
    abonnement aanhouden); of
  - (b) die specifieke codes vervangen (opnieuw printen) en daarna Azure opzeggen.
- **Nooit** de App Service verwijderen voordat dit besloten is: een verwijderde naam
  met dit unieke achtervoegsel krijg je niet terug.

## 7. Einde Entra-overgangsfase (na een paar weken)

1. `npm run temp-passwords` — wie heeft nog geen lokaal wachtwoord?
2. Die mensen vragen in te loggen, of `npm run temp-passwords -- --apply` en de
   tijdelijke wachtwoorden (CSV, buiten git) veilig delen; CSV daarna verwijderen.
3. `ENTRA_TENANT_NAME` en `ENTRA_WEB_CLIENT_ID` uit Vercel halen → Redeploy.
   Vanaf nu: "wachtwoord vergeten" = beheerder geeft een tijdelijk wachtwoord.
4. Entra External ID-tenant verwijderen.

## 8. Azure opzeggen (checklist)

- [ ] App Service `dpp-platform-dev` + App Service Plan (zie §6 vóór verwijderen!)
- [ ] Azure SQL-server + database (eerst een laatste export/back-up bewaren)
- [ ] Storage account `stveripassodev01`
- [ ] Managed Certificates / custom domains in de App Service
- [ ] Entra External ID-tenant `DPPPlatform` (na §7)
- [ ] Resource group `dpp-platform-dev_group`
- [ ] GitHub: secrets `AZUREAPPSERVICE_*` en de federated credential; het
      workflowbestand `.github/workflows/main_dpp-platform-dev.yml`
- [ ] Azure-abonnement zelf (tenzij §6a)

## Terugvalplan

Tot en met stap 5 is alles omkeerbaar: de Azure-omgeving blijft onaangeroerd draaien
op de oude code (laatste Azure-deploy) en data. Terug = DNS-records bij TransIP weer naar
de App Service zetten. Let op: wijzigingen die ná de DNS-wissel in Supabase zijn gedaan,
staan dan niet in Azure.
