# Infrastructuur VeriPasso

Stand: 2026-10-08. Eén productieomgeving, volledig op gratis plannen (ontwikkelfase).
Dit document is de bron van waarheid voor hoe de omgeving is ingericht. Wijzig je
iets in een dashboard, werk dan ook dit document bij.

## 1. Overzicht

```
                    TransIP (DNS, nameservers bij TransIP)
      veripasso.com · www · app.veripasso.com · qr.veripasso.com
                                  │
                                  ▼
 ┌─────────────────────────── Vercel (Hobby) ──────────────────────────┐
 │ Project dpp-platform · team robertalk072s-projects · regio dub1      │
 │                                                                      │
 │  Next.js-pagina's  (app/)              Express-API  (pages/api/[[...path]].js → src/app.js) │
 │  Cron 03:15 UTC → /api/cron/daily                                    │
 └──────────────────────────────────┬───────────────────────────────────┘
                                    │ pg (Supavisor transaction pooler :6543)
                                    │ @supabase/supabase-js (service role, alleen Storage)
                                    ▼
 ┌─────────────────────────── Supabase (Free) ─────────────────────────┐
 │ Project veripasso · ref zpiydcjttekonzwsfcey · eu-west-1 (Ierland)    │
 │  Postgres 17: schema dbo (16 tabellen, RLS aan, geen publieke toegang)│
 │  Storage: product-images (5 MB), product-documents (10 MB) – privé    │
 └───────────────────────────────────────────────────────────────────────┘

 GitHub RobertDev072/dpp-platform: broncode · CI (build) · nachtelijke DB-back-up
```

Alle data staat in de EU: Vercel-functies in Dublin, de database in Ierland.

## 2. Domeinen en DNS (TransIP)

| Naam | Type | Waarde | Doel |
|---|---|---|---|
| `@` | A | `216.198.79.1` | Landingspagina |
| `@` | A | `64.29.17.1` | Landingspagina |
| `www` | CNAME | `b46a5e75e147940c.vercel-dns-017.com.` | Stuurt door (308) naar `veripasso.com` |
| `app` | CNAME | `b46a5e75e147940c.vercel-dns-017.com.` | App (`APP_BASE_URL`) |
| `qr` | CNAME | `b46a5e75e147940c.vercel-dns-017.com.` | **Op elke gedrukte QR-code** (`QR_BASE_URL`) |

- De nameservers blijven bij TransIP. Certificaten maakt Vercel automatisch aan.
- `qr.veripasso.com` mag **nooit** verdwijnen of naar iets anders wijzen; gedrukte codes verwijzen er voorgoed naar.
- Er staan geen MX-records. Gebruik je e-mail op dit domein, zet dan de MX/SPF/DKIM-records van je mailprovider terug.

## 3. Vercel

| Instelling | Waarde | Waarom |
|---|---|---|
| Framework | Next.js, root = repo-root | Standaard; geen eigen build-commando's |
| Node.js | 24.x (`package.json` → `engines`) | Gelijk aan lokaal |
| Regio | `dub1` (`vercel.json` + projectstandaard) | Naast de database in Ierland |
| Productie-branch | `main` | Push naar `main` = productiedeploy |
| Max. functieduur | 30 s (`vercel.json`) | Ruim genoeg; voorkomt hangende requests |
| Cron | `/api/cron/daily`, 03:15 UTC | Dagelijkse metrics-snapshot en opschonen (Hobby: max. 1×/dag) |
| Deployment Protection | Vercel Authentication op alles behalve eigen domeinen | Preview-URL's alleen voor jou |
| Fork-bescherming | Aan | Pull requests uit forks krijgen geen secrets |
| Beveiligingsheaders | `next.config.mjs` + HSTS van Vercel | nosniff, geen framing, referrer-policy, permissions-policy |

### Environment variables

| Naam | Production | Preview | Bron / opmerking |
|---|---|---|---|
| `DATABASE_URL` | ✅ | – | Transaction pooler (:6543). Bewust niet op Preview: previews mogen nooit productiedata raken |
| `DATABASE_MAX_BYTES` | ✅ | ✅ | `524288000` (Free: 500 MB) |
| `SUPABASE_URL` | ✅ | – | Door de Supabase-integratie beheerd |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | – | Door de integratie beheerd. Geheim, alleen server-side |
| `COOKIE_SECRET` | ✅ | – | Random |
| `CRON_SECRET` | ✅ | – | Random; Vercel Cron stuurt hem mee |
| `APP_BASE_URL` | ✅ | – | `https://app.veripasso.com` |
| `QR_BASE_URL` | ✅ | ✅ | `https://qr.veripasso.com` |
| `POSTGRES_*`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_*` | ✅ | – | Automatisch gezet door de Supabase-integratie; **niet gebruikt door de app**. Laten staan (de integratie beheert ze) |

Niet zetten op Vercel: `NODE_ENV`, `SYSTEM_OWNER_*`. De `ENTRA_*`-variabelen zijn niet nodig: er zijn geen Entra-accounts meer.
Een gewijzigde variabele werkt pas na een nieuwe deploy (Redeploy).

## 4. Supabase

| Onderdeel | Inrichting |
|---|---|
| Database | Postgres 17. Alle tabellen in schema `dbo`, aangemaakt door `supabase/migrations/` (`npm run migrate`) |
| Toegang | De app verbindt als tabeleigenaar via de pooler. `anon`/`authenticated` hebben geen rechten op `dbo`; RLS staat aan op alle 16 tabellen (zonder policies) als tweede slot |
| Data API (PostgREST) | Ontsluit alleen `public`; daar staat niets van VeriPasso |
| Supabase Auth | Niet gebruikt (VeriPasso heeft eigen login en sessies) |
| Storage | Twee privé-buckets met grootte- en MIME-limieten op bucketniveau. Uploads via eenmalige signed upload-URL's; downloads via signed URL's van 5 minuten |
| Verbindingen | Vercel: transaction pooler `:6543`, max. 3 per instance. Scripts/migraties: session pooler `:5432` |
| Back-ups | Free plan: geen. Daarom de GitHub-workflow `database-backup.yml` (zie §6) |

## 5. Omgevingen en werkwijze

| Omgeving | Waar | Database |
|---|---|---|
| Lokaal | `npm run dev` → http://localhost:3000 | Productie-Supabase (zie verbeterpunt 1) |
| Preview | Elke branch/PR op Vercel | Geen (bewust) |
| Productie | `main` → veripasso.com | Productie-Supabase |

Vaste volgorde voor een wijziging:
1. lokaal bouwen en `npm test` (draait tegen de database uit `.env`, ruimt eigen testdata op);
2. schemawijziging? Nieuw bestand in `supabase/migrations/` en `npm run migrate`;
3. commit en push naar `main`; CI bouwt, Vercel deployt;
4. live controleren: inloggen, een QR-code scannen, een foto/document openen.

## 6. Beheer en monitoring

- **Systeemstatus** (`/admin/systeemstatus`, alleen de owner): gezondheid, performance, databasegroei, opslag, fouten, deployment.
- **Publieke health**: `https://qr.veripasso.com/api/health` → `OK`.
- **CI** (`.github/workflows/ci.yml`): `npm ci` + build bij elke push en PR.
- **Back-up** (`.github/workflows/database-backup.yml`): elke nacht een versleutelde dump van `dbo`, 14 dagen bewaard. Vereist de GitHub-secrets `SUPABASE_DB_URL` en `BACKUP_PASSPHRASE`.

## 7. Wat beter en professioneler kan

### Nu doen (gratis, belangrijk)
1. **Sleutels roteren.** Het databasewachtwoord, de Supabase service-role-key en het Vercel-token zijn in een chat gedeeld.
   - Supabase: Database → Settings → Reset password, en Settings → API Keys → roteren.
   - Daarna `DATABASE_URL` (en de integratievariabelen) in Vercel bijwerken, plus je lokale `.env`.
   - Vercel-token intrekken.
2. **Back-up activeren.** Zet de twee GitHub-secrets (§6) en draai de workflow één keer handmatig (Actions → Database-back-up → Run workflow).
3. **Supabase-instellingen dichtzetten.**
   - Authentication → Sign In / Providers: zet "Allow new users to sign up" uit; Supabase Auth wordt niet gebruikt.
   - Database → Settings: zet "Enforce SSL on incoming connections" aan.
   - Optioneel: download daar het SSL-certificaat en zet het als `DATABASE_CA_CERT` voor volledige certificaatcontrole.
4. **Externe uptime-monitor.** Bijvoorbeeld UptimeRobot of Better Stack (gratis) op `https://qr.veripasso.com/api/health`, elke 5 minuten, met mail bij storing.

### Binnenkort
5. **Aparte test-database.** Een tweede gratis Supabase-project (`veripasso-dev`) voor lokaal ontwikkelen, tests en Preview-deploys. Nu draaien tests tegen productie.
6. **Opruimen van verouderde bestanden** (README §10): `server.js`, `web/package.json`, de Azure-workflow, `graphClient.js`/`msalClients.js`, de Entra-tests en `entraLogin.service.js`. Er zijn geen Entra-accounts meer, dus ook de Entra-overgangscode (`nativeAuth.service.js`, de `ENTRA_*`-paden) kan weg.
7. **Branch-bescherming op `main`** (GitHub → Settings → Branches): CI moet groen zijn vóór een merge.
8. **Rate limiting over alle instances heen.** Nu telt elke Vercel-instance apart; tellers in Postgres maken de inlogbescherming waterdicht.

### Bij de eerste betalende klant
9. **Vercel Pro** (Hobby is niet voor commercieel gebruik) en **Supabase Pro** (geen pauze na 7 dagen inactiviteit, dagelijkse back-ups, 8 GB database).
10. **Back-up van Storage-bestanden**, bijvoorbeeld periodiek kopiëren naar een tweede opslag.
11. **E-mailverzending** (bijv. Resend) voor uitnodigingen en "wachtwoord vergeten", met SPF/DKIM op `veripasso.com`.
12. **Lokale MFA (TOTP)** voor beheerders en partners.
13. **Content-Security-Policy-header**, eerst in report-only-modus.
14. **Verwerkersovereenkomsten (DPA)** met Vercel en Supabase vastleggen (AVG), en een privacyverklaring.
