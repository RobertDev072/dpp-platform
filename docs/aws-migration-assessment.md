# AWS-migratie: assessment van de huidige applicatie

Bijgewerkt: 2026-10-10. Status: code en infrastructuurcode zijn klaar voor een
**niet-productie**-uitrol op AWS. Er zijn nog **geen** AWS-resources aangemaakt, er is
niets gedeployed en DNS is niet gewijzigd. Zie de runbook voor de stappen die een
mens met AWS-toegang moet uitvoeren.

## 1. Wat er bij de start van deze migratie draaide

| Onderdeel | Bevestigd in de repository |
|---|---|
| Framework | Next.js 16 (App Router) voor de UI; één Express 5-API in `pages/api/[[...path]].js` → `src/app.js` |
| Runtime | Node.js 24 (`package.json` engines), CommonJS in `src/` |
| Hosting | Vercel (`vercel.json`: regio `dub1`, functies max. 30 s, Vercel Cron 03:15 UTC) |
| Database | PostgreSQL 17 op Supabase (`DATABASE_URL` via de Supavisor-pooler), schema `dbo`, eigen migratierunner (`scripts/migrate.js`), geen ORM (repositories met SQL) |
| Bestandsopslag | Supabase Storage (2 privé-buckets), `@supabase/supabase-js` met service-role-key, signed upload/download-URL's; metadata via `storage.objects` |
| Authenticatie | Lokaal: bcrypt + eigen sessietabel (httpOnly-cookie). Restant: Microsoft Entra-overgangslogin (`src/config/entra.js`, `src/services/nativeAuth.service.js`) |
| MFA | Geen (Entra-MFA verviel bij de vorige migratie) |
| Rollen / tenants | `platform_owner`, `partner_admin`, `company_admin`, `company_user`; tenant-isolatie via `assertCompanyAccess` (404 bij andermans data) |
| E-mail | Bewust geen e-maildienst (activatielinks en tijdelijke wachtwoorden worden handmatig gedeeld) |
| QR | `qrcode` + `pdfkit`; URL `{QR_BASE_URL}/p/{PUBLIC_ID}` met GUID in hoofdletters (Azure-erfenis) |
| Scans | `dbo.scanevents` (ruwe events, user-agent/referrer, geen IP) |
| Achtergrondwerk | In-process telemetrie + `waitUntil` (Vercel) en Vercel Cron voor dagelijks onderhoud; imports in hervatbare chunks van 250 rijen (rij-lock) |
| Tests | `node --test` (17 bestanden) tegen een echte PostgreSQL; lokaal via PGlite, nooit tegen `.env` (productie) |
| CI | GitHub Actions: alleen `npm run build`; nachtelijke Supabase-dump als artifact |

### Azure
De applicatiecode was al van Azure af (App Service, Azure SQL, Blob, Graph). Wat restte:
de Entra-overgangslogin (code + env-vars `ENTRA_TENANT_NAME`, `ENTRA_WEB_CLIENT_ID`), de
Entra-kolommen in `dbo.users` (`entra_object_id`, `entra_subject_id`) en commentaar over
hoofdletter-GUID's. In de git-index stonden al verwijderingen van Azure-bestanden klaar
(van de eigenaar); die zijn ongemoeid gelaten.

## 2. Afhankelijkheden en AWS-doel

| Huidige afhankelijkheid | Doel | AWS-dienst | Inspanning | Risico | Codewijziging |
|---|---|---|---|---|---|
| Vercel (hosting Next.js + API) | Container | **ECS Fargate** achter **ALB**, met **CloudFront** | Middel | Cold start n.v.t.; altijd ≥ 1 taak (vaste kosten) | Ja: `output: "standalone"`, `Dockerfile`, `instrumentation.js` |
| Vercel Cron | In-process scheduler met lease-lock | — (geen extra dienst) | Klein | Bij 0 taken geen onderhoud (nooit: min. 1 taak) | Ja: `src/monitoring/scheduler.js`, tabel `dbo.joblocks` |
| `@vercel/functions` (`waitUntil`, pool) | Langlopend proces | — | Klein | — | Ja |
| Supabase Postgres | Zelfde engine | **RDS for PostgreSQL 17** | Klein-middel | Supabase-specifieke SQL (alleen in de init-migratie, met guards) | Ja: `src/config/db.js` (TLS met RDS-CA, wachtwoord uit Secrets Manager) |
| Supabase Storage | Objectopslag | **S3** (2 privé-buckets, versioning) | Middel | Uploads via presigned **POST** i.p.v. PUT | Ja: `src/services/blobStorage.service.js`, `lib/api.js` |
| `storage.objects` (opslagstatistiek) | S3 ListObjectsV2 | S3 | Klein | Telling stopt na `S3_STATS_MAX_PAGES` (gemarkeerd) | Ja: `src/monitoring/collectors.js` |
| Supabase-service-role-key | IAM-rol van de taak | IAM | Klein | — | Ja (geen sleutels meer) |
| Vercel env-vars | Taakdefinitie + **Secrets Manager** | Secrets Manager | Klein | Rotatie van RDS-wachtwoord: app leest bij elke nieuwe verbinding | Ja |
| GitHub-artifact-back-up (Supabase) | RDS-back-ups (PITR) + **AWS Backup** (maandelijks, lange bewaartermijn, kopie naar DR-regio) | RDS, AWS Backup | Klein | Back-up ≠ hoge beschikbaarheid | Infra |
| Entra-overgangslogin | Verwijderd | — | Klein | Accounts zonder lokaal wachtwoord moeten een tijdelijk wachtwoord krijgen | Ja |
| (geen) | WAF, alarmen, budget, anomaliedetectie | WAF, CloudWatch, SNS, Budgets, Cost Explorer | Klein | Budgetten zijn géén harde limiet | Infra |

### Afgewezen alternatieven (kort)
- **AWS App Runner**: eenvoudiger, maar minder controle over netwerk (geen ALB-headercontrole,
  beperkte WAF/HTTP-instellingen) en twijfel over de toekomst van de dienst. ECS Fargate is
  standaard en goed te automatiseren.
- **Lambda + API Gateway / OpenNext**: goedkoper bij weinig verkeer, maar de app heeft
  langlopende verzoeken (label-PDF's, imports, NDJSON-export), `pdfkit`-fonts en een
  in-process scheduler. Meer herbouw dan nodig.
- **Amplify Hosting**: minder controle over TLS/HTTP-versies en netwerk; zelfde nadelen als Vercel.
- **EKS**: onnodig complex voor één service.
- **Aurora PostgreSQL**: hogere minimumkosten; RDS volstaat voor de geschatte omvang.
  Overstappen kan later met een snapshot-migratie.
- **Cognito**: zou alle bestaande wachtwoorden, rollen en sessies raken. De lokale auth
  blijft; MFA is lokaal toegevoegd (TOTP).
- **SQS + workers**: niet nodig. Imports zijn al hervatbaar en idempotent (rij-lock +
  chunks), PDF/ZIP-generatie is begrensd (500 per verzoek). Bij groei de eerste kandidaat.

### Regio
`eu-west-1` (Ierland): dichtbij de huidige data (Supabase eu-west-1), alle gebruikte
diensten beschikbaar, iets goedkoper dan Frankfurt. DR-kopieën in `eu-central-1`. De
eigenaar moet bevestigen dat EU-hosting volstaat (zie §6).

## 3. Omgevingsvariabelen (alleen namen)

| Naam | Oud | Nieuw / AWS |
|---|---|---|
| `DATABASE_URL` | Supabase-pooler | Alleen lokaal/scripts. Op AWS: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SECRET_ARN`, `DATABASE_CA_CERT_FILE` |
| `DATABASE_CA_CERT` | optioneel | blijft (alternatief voor het CA-bestand) |
| `DATABASE_MAX_BYTES` | plan-limiet | RDS max. opslag (gezet door infra) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_*_BUCKET` | opslag | **vervallen** → `AWS_REGION`, `S3_IMAGES_BUCKET`, `S3_DOCUMENTS_BUCKET` (+ lokaal `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`) |
| `CRON_SECRET` | Vercel Cron | **vervallen** (scheduler in-process) |
| `ENTRA_TENANT_NAME`, `ENTRA_WEB_CLIENT_ID` | overgangslogin | **vervallen** |
| `COOKIE_SECRET` | env-var | Secrets Manager (`veripasso-<env>-app`) |
| — | — | **nieuw** `MFA_ENCRYPTION_KEY` (Secrets Manager) |
| `APP_BASE_URL`, `QR_BASE_URL` | env-var | ongewijzigd (taakdefinitie). `QR_BASE_URL` blijft `https://qr.veripasso.com` |
| — | — | **nieuw** `TRUST_PROXY_HOPS` (2), `INTERNAL_API_ORIGIN`, `PUBLIC_RATE_LIMIT_PER_MINUTE`, `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`, `CONTAINER_MEMORY_MB`, `APP_ENV`, `GIT_SHA`, `LOG_FORMAT`, `DISABLE_BACKGROUND_JOBS`, `S3_STATS_MAX_PAGES` |
| `SYSTEM_OWNER_*` | eenmalig seed | ongewijzigd (alleen lokaal/eenmalige taak) |

## 4. Datamodel: model-QR of item-QR

**Bevestigd: elke QR identificeert een productmodel**, niet een individueel exemplaar.
`dbo.products.public_id` (uuid) is de permanente sleutel; `dbo.productbatches` bevat
batchnummers maar heeft geen eigen QR of paspoort.

Voorstel als item-QR's nodig blijken (niet geïmplementeerd, eerst besluit van de
certificeerder/eigenaar):

```
dbo.productitems (
  id bigint PK, product_id int FK, company_id int FK,
  public_id uuid UNIQUE NOT NULL,      -- eigen QR: {QR_BASE_URL}/i/{PUBLIC_ID}
  serial_number varchar(100) NOT NULL, -- uniek per product
  batch_id int NULL FK, produced_at date NULL,
  attributes jsonb NULL,               -- alleen item-specifieke afwijkingen
  status varchar(20)                   -- active / recalled / end_of_life
)
```
Een item-paspoort = de snapshot van het model + item-attributen; documenten worden niet
gedupliceerd. Bestaande `/p/{id}`-URL's blijven ongewijzigd (nieuwe prefix `/i/`).
Geen massale seed; hooguit enkele items per test.

## 5. Build, test en tooling

| Commando | Doel |
|---|---|
| `npm ci` / `npm run build` | Installatie (lockfile) en productiebuild (standalone) |
| `npm run migrate` | Migraties uit `db/migrations` |
| `npm test` | Volledige suite tegen een **test**database (`DATABASE_URL`) |
| `cd infra && npm ci && npm run synth:staging && npm test` | CDK-synth + infrastructuurtests (geen AWS-account nodig) |
| `docker build .` | Container-image (Docker niet lokaal geïnstalleerd; draait in CI) |

Lokaal ontbreken: Docker, AWS CLI, Python (cfn-lint). Zie het eindrapport voor wat
daardoor niet lokaal geverifieerd is.

## 6. Open vragen vóór een productie-overstap

1. **Normen en licentie**: de EVS-licentie van de EN 182xx-normen verbiedt gebruik in
   AI-toepassingen zonder schriftelijke toestemming. Daardoor zijn EN 18219, 18220, 18222
   en 18223 niet door Claude gelezen. Zie `docs/compliance/requirements-matrix.md`.
2. **Back-up-dienstverlener (ESPR art. 10 / EN 18221 §4.3)**: wie wordt de onafhankelijke
   back-up-DPP-dienstverlener? Technisch is een replicatie-export aanwezig; de partij en het
   contract ontbreken.
3. **Bewaartermijn (DPP lifetime)**: per productgroep vast te stellen (gedelegeerde
   handeling). Nu: niets wordt automatisch verwijderd; maandelijkse back-ups 10 jaar.
4. **Model- of item-QR** per productgroep (§4).
5. **HTTP/1.1**: EN 18216 §4 eist minimaal HTTP/2; CloudFront kan HTTP/1.1 voor oude
   clients niet uitschakelen. Interpretatie door de certificeerder nodig.
6. **Regio/data-residency**: is `eu-west-1` (+ DR `eu-central-1`) akkoord?
7. **Piekverkeer**: is 50 scans/s de juiste ontwerpwaarde? (loadtest op staging nodig)
8. **QR-codes met het oude `*.azurewebsites.net`-adres**: zijn die ooit gedrukt?
9. **Accounts zonder lokaal wachtwoord** (oud Entra): lijst opvragen vóór de overstap en
   tijdelijke wachtwoorden uitdelen (zie runbook).
