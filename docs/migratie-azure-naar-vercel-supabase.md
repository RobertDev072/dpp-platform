# Draaiboek: migratie Azure → Vercel + Supabase

Dit document beschrijft de eenmalige overstap van de live Azure-omgeving naar
**Vercel** (hosting) en **Supabase** (Postgres, Auth, Storage), en daarna het
opruimen van Azure. De code in deze repository is al omgebouwd; dit draaiboek gaat
over de portal-, DNS- en datastappen die alleen jij kunt uitvoeren.

> **Belangrijkste regel: geprinte QR-codes moeten blijven werken.** Ze bevatten
> `https://qr.veripasso.com/p/{public_id}`. Na de migratie wijst `qr.veripasso.com`
> naar Vercel en bestaat elke `public_id` ongewijzigd in Supabase. Het
> migratiescript controleert dat expliciet (stap 4 "verificatie").

---

## 0. Wat verandert er (overzicht)

| Onderdeel | Was (Azure) | Wordt |
|---|---|---|
| Hosting | App Service `dpp-platform-dev` (B1, Central US), `server.js` | Vercel (Next.js + Express als één function `/api/*`), regio `fra1` |
| Deploy | GitHub Actions → `az webapp deploy` | Vercel Git-integratie (push naar `main` = productie, PR = preview); GitHub Actions draait alleen nog CI (tests + build) |
| Database | Azure SQL serverless (T-SQL) | Supabase Postgres (EU, Frankfurt) — schema in `migrations/001_initial_schema.sql` |
| Inloggen | Entra External ID (Native Auth + Graph) | Supabase Auth (server-side; de browser praat nooit met Supabase) |
| Bestanden | Blob Storage `stveripassodev01` (privé, Managed Identity) | Supabase Storage, privé buckets `product-images` en `product-documents` |
| Up-/downloads | via de server gestreamd | upload rechtstreeks naar Storage via eenmalige upload-URL; download via redirect naar een signed URL die 2 minuten geldig is (Vercel-limiet: max 4,5 MB per request/response) |
| Scheduler | `setInterval` in het serverproces | Vercel Cron (`/api/cron/daily`, dagelijks 03:17 UTC) + telemetrie-flush per request |
| Rate limiting | in het geheugen van het proces | tabel `rate_limits` in Postgres (geldt over alle Vercel-instances) |
| Health check | App Service Health check op `/api/health` | zelfde endpoint; eventueel een externe uptime-monitor erop zetten |

Tabelnamen zijn nu snake_case: `dbo.Users` → `users`, `dbo.AuditLogs` →
`audit_logs`, `dbo.ScanEvents` → `scan_events`, `dbo.CompanyAdminInvites` →
`company_admin_invites`, `dbo.ProductParts` → `product_parts`, enz.
`Users.entra_object_id`/`entra_subject_id` zijn vervangen door `users.auth_user_id`
(id in Supabase Auth).

### Kosten (eerst lezen — kostenprincipe)

- **Vercel Hobby (gratis) is volgens de voorwaarden alleen voor niet-commercieel
  gebruik.** VeriPasso is een commerciële SaaS → **Vercel Pro** (ca. $20 per
  teamlid per maand). (Hobby laat cronjobs ook maar één keer per dag draaien; voor
  deze app is dat genoeg.)
- **Supabase Free pauzeert een project na een week zonder activiteit en heeft geen
  back-ups.** Een gepauzeerd project = alle QR-codes offline. Voor productie:
  **Supabase Pro** (ca. $25 per maand; 8 GB database, 100 GB opslag, dagelijkse
  back-ups met 7 dagen retentie inbegrepen; point-in-time-recovery is een betaalde
  add-on).
- Daartegenover vervallen: App Service B1, Azure SQL, Blob Storage en Entra.

Controleer de actuele prijzen op vercel.com/pricing en supabase.com/pricing.

---

## 1. Supabase-project inrichten

1. Maak een project aan in regio **Central EU (Frankfurt)** (`eu-central-1`) — EU-
   data, en dicht bij Vercel-regio `fra1`. Kies een sterk databasewachtwoord en
   bewaar het in je wachtwoordmanager.
2. **Project Settings → API**: noteer de Project URL (`SUPABASE_URL`), de
   `service_role`-key (`SUPABASE_SERVICE_ROLE_KEY`, geheim!) en de `anon`-key
   (`SUPABASE_ANON_KEY`).
3. **Connect**: noteer de connection strings:
   - *Transaction pooler* (poort **6543**) → `DATABASE_URL` op Vercel;
   - *Session pooler* (poort **5432**) → lokaal voor `npm run migrate` en het
     migratiescript (werkt ook via IPv4; de "direct connection" is alleen IPv6).
4. **Authentication → Sign In / Providers**:
   - **"Allow new users to sign up" UIT** — accounts ontstaan alleen via VeriPasso
     (uitnodiging of beheerder). De server maakt accounts aan via de admin-API,
     die werkt ook met signups uit.
   - Email-provider aan; **"Confirm email"** maakt niet uit (de server bevestigt zelf).
   - **Minimum password length: 12** (gelijk aan de eisen in de app); vink bij
     voorkeur kleine letters/hoofdletters/cijfers/symbolen aan.
5. **Authentication → URL Configuration**: Site URL `https://app.veripasso.com`.
6. **Authentication → Emails → "Reset Password"**-template: VeriPasso gebruikt een
   **code**, geen link. Vervang de inhoud door bijvoorbeeld:
   ```html
   <h2>Wachtwoord opnieuw instellen</h2>
   <p>Je code voor VeriPasso is: <strong>{{ .Token }}</strong></p>
   <p>De code is 1 uur geldig. Heb je dit niet aangevraagd? Dan kun je deze mail negeren.</p>
   ```
   (Afwijkende codelengte ingesteld? Zet dan `SUPABASE_OTP_LENGTH`.)
7. **E-mail (SMTP)**: de ingebouwde mailer van Supabase verstuurt alleen naar
   teamleden en maar een paar mails per uur. "Wachtwoord vergeten" werkt voor
   klanten pas met een **eigen SMTP-server** (Authentication → Emails → SMTP
   Settings; bijv. de mailserver van het eigen domein of een dienst als Resend/
   Postmark — kosten eerst afwegen). **Zonder SMTP werkt al het andere gewoon**:
   uitnodigingen (link handmatig delen, beheerder kiest zelf een wachtwoord) en
   wachtwoordresets door een beheerder/partner (tijdelijk wachtwoord).
8. **Authentication → Rate Limits**: alle logins lopen via de server, dus Supabase
   ziet ze vanaf de IP-adressen van Vercel. Zet de limiet voor sign-ins ruim (bijv.
   1800 per uur). De echte brute-force-bescherming zit in de app (per e-mail en per
   IP, in Postgres).
9. Database-schema en buckets (lokaal, met de Supabase-gegevens in `.env`):
   ```bash
   npm install
   npm run test:db          # verbinding
   npm run migrate          # schema (idempotent)
   npm run setup:storage    # privé buckets met grootte-/typelimieten
   ```
   Het schema zet **Row Level Security aan op alle tabellen zonder policies** en
   trekt de rechten van de rollen `anon`/`authenticated` in: niets is via de
   publieke Supabase-REST-API leesbaar, alle toegang loopt via de server.

---

## 2. Vercel-project inrichten

1. **Add New → Project** → importeer de GitHub-repo. Framework: Next.js (automatisch),
   Root Directory: de repo-root, Build Command: standaard (`next build`).
2. **Settings → Environment Variables** (Production; voor Preview bij voorkeur een
   aparte Supabase-testomgeving, nooit de productie-database):

   | Variabele | Waarde |
   |---|---|
   | `DATABASE_URL` | Transaction pooler-URL (poort 6543) |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role-key (Sensitive aanvinken) |
   | `SUPABASE_ANON_KEY` | anon-key |
   | `COOKIE_SECRET` | nieuwe lange willekeurige string (Sensitive) |
   | `CRON_SECRET` | nieuwe lange willekeurige string (Sensitive) |
   | `APP_BASE_URL` | `https://app.veripasso.com` |
   | `QR_BASE_URL` | `https://qr.veripasso.com` — **nooit wijzigen** |
   | `SUPABASE_DB_MAX_BYTES` | optioneel, bijv. `8589934592` (8 GB, Pro) |
   | `DATABASE_SSL_CA` | optioneel, CA-certificaat voor volledige TLS-verificatie |

   In productie weigert de API te draaien als een van de verplichte variabelen
   ontbreekt (`CONFIG_INCOMPLETE`) — bewust, zodat er nooit stil een halve
   configuratie live staat.
3. **Settings → Functions**: regio staat via `vercel.json` op `fra1` (Frankfurt).
4. Deploy en test eerst op de `*.vercel.app`-URL (zonder echte data is de app leeg;
   met een kopie van de data na stap 3 kun je alles doorklikken).
5. **Settings → Cron Jobs**: controleer dat `/api/cron/daily` er staat (komt uit
   `vercel.json`).

---

## 3. Data migreren (generale repetitie, daarna echt)

Het script `scripts/migrate-from-azure.js` doet alles in vier stappen: **db**
(alle tabellen, ids ongewijzigd), **blobs** (alle bestanden, zelfde objectnamen),
**auth** (Supabase-accounts voor alle voormalige Entra-gebruikers) en **verify**
(aantallen per tabel, élke QR-`public_id`, elk bestand, elk account).

Zet in `.env` de Azure-bron (`AZURE_SQL_*`, `AZURE_STORAGE_ACCOUNT_NAME` + `az login`
of `AZURE_STORAGE_CONNECTION_STRING`) en het Supabase-doel (`DATABASE_URL` via de
session pooler, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Zet tijdelijk je
eigen IP in de Azure SQL-firewall als dat nodig is.

**Generale repetitie** (aanrader): doe het eerst tegen een tweede, wegwerp-
Supabase-project. Dan weet je hoe lang het duurt en of de verificatie groen is.

```bash
node scripts/migrate-from-azure.js --dry-run   # alleen tellen
node scripts/migrate-from-azure.js             # db, blobs, auth, verify
```

### Wachtwoorden (belangrijk)

Entra kan geen wachtwoorden exporteren. Na de migratie:
- het **Platform Owner**-account (bcrypt) werkt ongewijzigd met hetzelfde wachtwoord;
- **alle andere gebruikers** krijgen een tijdelijk wachtwoord en moeten bij de eerste
  login een eigen wachtwoord kiezen. De tijdelijke wachtwoorden staan in
  `migration-output/tijdelijke-wachtwoorden-<datum>.csv` (in `.gitignore`). Deel ze
  veilig, één per persoon, en **verwijder het bestand daarna**.
- Alternatief: `--auth-mode=reset` (geen tijdelijke wachtwoorden; iedereen gebruikt
  "Wachtwoord vergeten") — alleen als de SMTP uit stap 1.7 werkt.
- Iedereen moet opnieuw inloggen (sessies worden niet gemigreerd).

---

## 4. Overstap (cutover)

1. **Dag(en) vooraf**: zet bij TransIP de TTL van `app`, `qr` en de apex
   `veripasso.com` op 300 seconden. Voeg in Vercel (**Settings → Domains**) de drie
   domeinen toe; Vercel toont per domein welke DNS-records nodig zijn (en eventueel
   een `_vercel` TXT-record om het domein te verifiëren terwijl het nog naar Azure
   wijst).
2. **Rustig moment kiezen, korte onderhoudsmelding.** QR-codes zijn offline vanaf
   het stoppen van de App Service tot de DNS-wijziging is doorgekomen (met TTL 300:
   enkele minuten + de duur van de migratie).
3. Stop de App Service (portal: *Stop*) — zo komt er geen nieuwe data meer bij in Azure.
4. `node scripts/migrate-from-azure.js` → verificatie moet **volledig groen** zijn.
5. DNS bij TransIP (exacte waarden: zie Vercel → Domains):
   - `app` en `qr`: CNAME naar het Vercel-adres (bijv. `cname.vercel-dns.com`);
   - apex `veripasso.com`: A-record naar het Vercel-IP (bijv. `76.76.21.21`);
   - verwijder de oude records naar Azure en de `asuid.*` TXT-records.
   Vercel geeft automatisch TLS-certificaten uit zodra de records kloppen.
6. Controle (via mobiele data, buiten Zscaler):
   - `https://qr.veripasso.com/p/<bestaande-public-id>` uit een **echte geprinte QR**;
   - inloggen als owner; een tijdelijk-wachtwoordaccount testen;
   - `E2E_BASE_URL=https://app.veripasso.com node scripts/e2e-supabase-live.js`
     (maakt wegwerpdata aan en ruimt alles op);
   - **Systeemstatus**: database, Supabase Storage en Supabase Auth op groen.
7. Zet de TTL weer op een normale waarde (bijv. 3600).

### Let op: QR-codes met de `azurewebsites.net`-hostname

Een QR-code die ooit is gedownload terwijl `QR_BASE_URL` nog niet op
`https://qr.veripasso.com` stond, bevat
`https://dpp-platform-dev-h2dag0asawh9eyhg.centralus-01.azurewebsites.net/p/...`.
Die hostname is van Microsoft en **kan niet naar Vercel verhuizen**: zodra de App
Service weg is, werken zulke codes niet meer.

- Weet je zeker dat alle geprinte codes `qr.veripasso.com` bevatten (scan een paar
  oude labels), dan kun je Azure volledig opruimen.
- Zo niet: laat alleen een **gratis (F1) App Service** met dezelfde naam bestaan met
  een minimale doorverwijzing, bijvoorbeeld als enige bestand `server.js`:
  ```js
  require("http")
    .createServer((req, res) => {
      res.writeHead(301, { Location: `https://qr.veripasso.com${req.url}` });
      res.end();
    })
    .listen(process.env.PORT || 8080);
  ```
  Downgrade daarvoor `dpp-platform-dev` naar F1 (eerst de custom domains en
  certificaten van deze App Service verwijderen; F1 ondersteunt die niet) en deploy
  alleen dit bestand. Kosten: € 0.

---

## 5. Azure opruimen (pas na een paar dagen stabiel draaien)

1. Bewaar eerst een eindback-up: Azure SQL → *Export* (bacpac) naar je eigen opslag,
   en eventueel een kopie van de blob-containers.
2. Verwijder (of laat alleen de F1-redirect uit §4 staan):
   - App Service `dpp-platform-dev` en het App Service-plan;
   - Azure SQL-database + server;
   - storage account `stveripassodev01`;
   - de resource group `dpp-platform-dev_group` (als die verder leeg is);
   - de Entra External ID-tenant `DPPPlatform` (eerst de app-registraties, dan de tenant).
3. GitHub: verwijder de repository-secrets `AZUREAPPSERVICE_*` (Settings → Secrets).
4. Verwijder de Azure-variabelen uit je lokale `.env` en, als je wilt, de
   dev-dependencies `mssql`, `@azure/storage-blob` en `@azure/identity` (alleen nodig
   voor het migratiescript).

---

## 6. Bewust gewijzigd gedrag (ter info)

- **Bestandsdownloads** gaan via een redirect naar een signed URL die 2 minuten
  geldig is (de bucket blijft privé, rechten worden per request door de server
  gecontroleerd). Onder Azure streamde de server de bytes zelf door; dat kan op Vercel
  niet voor bestanden boven 4,5 MB.
- **Uitnodigingen**: de nieuwe beheerder kiest bij activatie direct zijn eigen
  wachtwoord (vroeger: daarna een e-mailcode via Entra). Er wordt nog steeds geen
  e-mail door de app verstuurd.
- **MFA per e-mailcode** (een Entra-functie) bestaat niet meer.
- **Monitoring**: live-minuutgrafieken, recente foutdetails, geheugen en uptime gelden
  per Vercel-instance (er draaien er meerdere, en ze worden regelmatig vervangen);
  de uur- en dagcijfers in de database zijn wel volledig. Databaseperformance komt uit
  `pg_stat_statements`, opslag uit `storage.objects`.
- **Documenten verwijderen** ruimt nu ook het bestand in Storage op, en controleert dat
  het document bij het opgegeven product hoort.
- **Lokaal en in CI** draait de testsuite tegen een eigen Postgres — nooit meer tegen
  de live database.
