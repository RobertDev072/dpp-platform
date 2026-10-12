# Runbook: VeriPasso op AWS

Voor: de eigenaar en wie AWS-, DNS- en GitHub-toegang heeft. Elke stap met
**[MENS]** vereist een account, betaling, DNS of expliciete goedkeuring en is **niet**
door Claude uitgevoerd. **[LOKAAL]** kan zonder AWS-toegang.

Niets in dit document is al uitgevoerd op AWS. Azure en de huidige
Vercel/Supabase-omgeving blijven draaien tot fase 8 is afgerond en de eigenaar
uitdrukkelijk akkoord geeft.

---

## 0. Overzicht van de fases

| Fase | Wat | Wie |
|---|---|---|
| 1 | Lokaal: code, tests, synth | [LOKAAL] (gedaan) |
| 2 | AWS-account, IAM, budgetten, CDK-bootstrap | [MENS] |
| 3 | Certificaten en domeinen | [MENS] |
| 4 | Staging uitrollen (minimaal) | [MENS] |
| 5 | Geanonimiseerde testdata migreren en controleren | [MENS] + scripts |
| 6 | Functionele, beveiligings-, performance-, restore- en kostentests | [MENS] |
| 7 | Generale repetitie productiemigratie + rollback | [MENS] |
| 8 | Cutover in een afgesproken venster | [MENS] |
| 9 | Nazorg; pas daarna oude omgeving opzeggen (apart akkoord) | [MENS] |

---

## 1. Lokaal (gedaan, opnieuw te draaien)

```bash
npm ci
npm run build
# Tests tegen een TIJDELIJKE database, nooit tegen productie:
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run migrate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test
cd infra && npm ci && npm run synth:staging && npm run synth:production && npm test
```

## 2. AWS-account en basis [MENS]

1. AWS-account (bij voorkeur AWS Organizations met aparte accounts voor staging en
   productie). Root-account: MFA aan, geen toegangssleutels, alleen voor noodgevallen.
2. IAM Identity Center (SSO) met MFA voor beheerders; geen IAM-users met vaste sleutels.
3. Billing: e-mail voor facturen; Cost Explorer aanzetten (nodig voor anomaliedetectie).
4. Vul `infra/config/<env>.json` in: `account`, domeinen, certificaat-ARN's (stap 3),
   `alarmEmail`, `monthlyBudgetUsd`, `cloudFrontPrefixListId`:
   ```bash
   aws ec2 describe-managed-prefix-lists --region eu-west-1 \
     --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
     --query 'PrefixLists[0].PrefixListId' --output text
   ```
5. CDK bootstrap (eenmalig per account/regio):
   ```bash
   cd infra
   npx cdk bootstrap aws://<ACCOUNT>/eu-west-1 aws://<ACCOUNT>/us-east-1 aws://<ACCOUNT>/eu-central-1
   ```

## 3. Certificaten en domeinen [MENS]

DNS staat bij TransIP. Er komen alleen CNAME-records bij; bestaande records blijven tot
de cutover ongewijzigd.

| Certificaat (ACM) | Regio | Namen | Gebruik |
|---|---|---|---|
| CloudFront | **us-east-1** | `veripasso.com`, `www`, `app`, `qr` (staging: eigen namen) | `cloudFrontCertificateArn` |

Vraag het aan met DNS-validatie en zet de validatie-CNAME's bij TransIP. De verbinding
CloudFront → Lambda Function URL gebruikt het certificaat van AWS zelf.

## 4. Staging uitrollen [MENS]

```bash
cd infra
npx cdk diff -c env=staging              # eerst bekijken
npx cdk deploy --all -c env=staging      # vraagt bevestiging bij IAM/security-wijzigingen
```

De eerste keer bestaat er nog geen image. Volgorde:
1. Register aanmaken: `npx cdk deploy VeriPasso-staging-Registry -c env=staging`.
2. Image bouwen en pushen naar de ECR-URI (Lambda accepteert geen
   attestation-manifest, dus `--provenance=false`):
   ```bash
   aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.eu-west-1.amazonaws.com
   docker build --provenance=false --platform linux/amd64 --build-arg GIT_SHA=$(git rev-parse HEAD) -t <ECR_URI>:$(git rev-parse HEAD) .
   docker push <ECR_URI>:$(git rev-parse HEAD)
   ```
3. `npx cdk deploy VeriPasso-staging-App -c env=staging -c imageTag=<sha>`.
4. Migraties via een directe aanroep (zie §4.1).
5. DNS (staging): alle staging-domeinen → CNAME naar `CloudFrontDomain`.
6. Platform Owner aanmaken: directe aanroep met `{"task":"seed-owner",…}` (§4.1). Het
   wachtwoord staat dan alleen in die ene aanroep, niet in de configuratie.

Daarna kan elke uitrol via GitHub Actions → "Deploy naar AWS" (handmatig, met
goedkeuring op de GitHub-environment). Eenmalig: CI-stack uitrollen en
`AWS_DEPLOY_ROLE_ARN` als variabele op de GitHub-environment zetten.

### 4.1 Interne taken (migraties, seed, backfill)
Een directe aanroep van de app-functie (IAM-recht `lambda:InvokeFunction` nodig; van
buitenaf niet bereikbaar). De Lambda Web Adapter stuurt de payload als POST naar
`/api/internal/events`.
```bash
aws lambda invoke --function-name veripasso-<env>-app --cli-binary-format raw-in-base64-out \
  --cli-read-timeout 900 --payload '{"task":"migrate"}' out.json && cat out.json
# andere taken: {"task":"backfill"}, {"task":"maintenance"},
# {"task":"seed-owner","email":"…","password":"…","firstName":"…","lastName":"…"}
```
Logs: CloudWatch Logs-groep `/veripasso/<env>/app`.

## 5. Datamigratie (eerst met geanonimiseerde data op staging) [MENS]

### 5.1 Database (Supabase → RDS)
1. Schrijfpauze afspreken (alleen bij de echte cutover).
2. Dump van de bron (PostgreSQL 17-client):
   ```bash
   pg_dump "<SUPABASE_SESSION_POOLER_URL>" --schema=dbo --no-owner --no-privileges \
     --format=custom --file=veripasso-dbo.dump
   ```
3. Herstellen in RDS, via een tijdelijke beheerverbinding (bijv. SSM-port-forwarding via
   een tijdelijke bastion in de VPC; de database is niet publiek):
   ```bash
   pg_restore --no-owner --no-privileges -d "<RDS_URL>" veripasso-dbo.dump
   ```
4. Vergelijken (rijen + checksum per tabel, alleen lezen):
   ```bash
   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... TARGET_DATABASE_CA_FILE=global-bundle.pem \
     npm run verify:db-copy > db-verificatie.txt
   ```
   Alle tabellen moeten "ja" geven. Bewaar `db-verificatie.txt` als bewijs.
5. Daarna pas de nieuwe migraties en de backfill: `{"task":"migrate"}` en
   `{"task":"backfill"}` als interne taken (§4.1).

### 5.2 Bestanden (Supabase Storage → S3)
Supabase → Storage → S3 Connection: S3-sleutels aanmaken (alleen lezen nodig).
```bash
SOURCE_S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3 SOURCE_S3_REGION=eu-west-1 \
SOURCE_S3_ACCESS_KEY_ID=... SOURCE_S3_SECRET_ACCESS_KEY=... TARGET_REGION=eu-west-1 \
BUCKET_MAP="product-images=<ImagesBucketName>,product-documents=<DocumentsBucketName>" \
DRY_RUN=true npm run copy:storage > manifest-dryrun.csv
# daarna zonder DRY_RUN; herhaalbaar (al gekopieerde objecten worden overgeslagen)
```
Elk object wordt met SHA-256 gecontroleerd. Het manifest is het bewijs; het script
eindigt met exitcode 1 als er iets misging. Objectnamen blijven gelijk, dus de
database-verwijzingen kloppen zonder aanpassing. Verwijder de Supabase-S3-sleutels na afloop.

### 5.3 Accounts zonder lokaal wachtwoord (oud Entra)
```sql
SELECT id, email, role FROM dbo.users WHERE password_hash IS NULL AND status <> 'deleted';
```
Deze accounts kunnen niet meer inloggen (de Entra-overgangslogin is verwijderd). Geef ze
vóór de cutover via "Wachtwoord resetten" een tijdelijk wachtwoord.

## 6. Tests op staging [MENS]

- [ ] Inloggen (met en zonder MFA), uitloggen, tijdelijk wachtwoord, MFA-reset.
- [ ] Product aanmaken, foto + PDF uploaden (presigned POST), publiceren, QR downloaden.
- [ ] Bestaande gedrukte QR-code (hoofdletter-GUID) scannen met een telefoon.
- [ ] `curl -H 'Accept: application/ld+json' https://<qr>/p/<ID>` → JSON-LD;
      `Accept: application/xml` → XML; browser → HTML.
- [ ] Versiegeschiedenis: wijziging maken → `/api/dpp/<ID>/versions` toont een nieuwe
      versie; `GET /api/products/<id>/versions/verify` → `valid: true`.
- [ ] TLS: `nmap --script ssl-enum-ciphers -p 443 <domein>` of testssl.sh: geen TLS 1.0/1.1.
      `curl -I --http2` en `--http3` werken.
- [ ] Directe toegang tot de Lambda Function URL (zonder CloudFront-header) geeft 403;
      `POST https://<domein>/api/internal/events` geeft 404.
- [ ] Paspoort twee keer openen: tweede keer `x-cache: Hit from cloudfront`; de scan
      telt toch twee keer (beacon). Foto komt van `/products/…` (WebP).
- [ ] Loadtest (bijv. k6) op staging tot 50 scans/s, nooit op productie; P95 < 800 ms.
- [ ] Restore-test (§8) uitgevoerd en gedocumenteerd.
- [ ] Toegankelijkheid publiek paspoort (EN 301 549 / WCAG 2.1 AA): audit met axe +
      handmatige schermlezer-test.
- [ ] Kosten na een week vergeleken met `docs/aws-cost-model.md`.

## 7. Cutover (productie) [MENS, expliciet akkoord vereist]

1. Generale repetitie van §5 volledig op een kopie (zelfde volumes); tijd meten.
2. Cutover-venster communiceren (verwacht: < 1 uur schrijfpauze).
3. Laatste back-up van de bron: Supabase-dump + bestandsmanifest.
4. Schrijfpauze: oude omgeving in onderhoudsmodus (alleen lezen).
5. §5.1 en §5.2 uitvoeren (incrementeel), verificaties moeten 100% groen zijn.
6. DNS bij TransIP: `app.veripasso.com` en `qr.veripasso.com` → CNAME naar de
   CloudFront-domeinnaam (TTL vooraf verlagen naar 300 s). **`qr.veripasso.com` nooit
   verwijderen.**
7. Rooktest (§6, eerste vier punten) op productie.
8. **Rollback-trigger**: als binnen 2 uur de rooktest faalt, het foutpercentage > 2%
   is of gedrukte QR-codes niet werken: DNS terug naar de oude omgeving (die is alleen
   in onderhoudsmodus gezet, niet gewijzigd) en de schrijfpauze opheffen. Gegevens die
   in die periode op AWS zijn ingevoerd, worden handmatig nagelopen (auditlog).

## 8. Back-up, restore en DR

| Wat | Hoe | RPO | Bewaartermijn |
|---|---|---|---|
| Database | RDS automatische back-ups + PITR | ~5 min | 35 dagen (productie) |
| Database (archief) | AWS Backup maandelijks | 1 maand | 10 jaar (productie) |
| Database (DR) | AWS Backup-kopie naar eu-central-1 | 1 dag | 35 dagen |
| Bestanden | S3-versioning (niets wordt overschreven) | 0 | onbeperkt |
| Bestanden (DR) | S3 Cross-Region Replication naar eu-central-1 | minuten | onbeperkt |
| Paspoortversies | in de database, append-only, + export | als database | onbeperkt |

**Restore-test (minimaal elk kwartaal, en vóór go-live):**
1. RDS → "Restore to point in time" naar een **nieuwe** instantie (niet de bestaande).
2. Vanaf een tijdelijke beheerverbinding (bastion in de VPC) met die instantie:
   `npm run verify:db-copy` tegen de productie-instantie (alleen lezen) en een
   steekproef van paspoorten + `/versions/verify`.
3. Tijd tot herstel noteren (RTO), instantie verwijderen, resultaat vastleggen.

Hoge beschikbaarheid: alleen binnen eu-west-1 (Multi-AZ database; Lambda draait al in 2 AZ's).
Een regio-storing betekent: handmatig herstel in eu-central-1 vanuit de kopieën (uren).

## 9. Rollback van een gewone deploy

- CloudFormation rolt automatisch terug als de stack-update mislukt.
- Handmatig: `npx cdk deploy VeriPasso-<env>-App -c env=<env> -c imageTag=<vorige-sha>`.
  Images zijn onveranderlijk getagd; de laatste 10 blijven bewaard.
- Migraties zijn additief. Een migratie terugdraaien gebeurt nooit automatisch.
  Paspoortversies blijven altijd bewaard.

## 10. Compliance-sectie (go-live-poort)

Bron: `docs/compliance/requirements-matrix.md`. Samenvatting bij oplevering:

- **Geverifieerd in software**: archivering met hash-keten en onveranderlijkheid,
  tijdstip-opvraging, toegangsbeperking op versies, content negotiation (JSON, JSON-LD,
  XML, HTML), TLS ≥ 1.2 en HTTP/2+3 in de infrastructuurcode, persistentie van
  gepubliceerde paspoorten, replicatie-export, tenant-isolatie, MFA.
- **Geblokkeerd, besluit of document nodig**:
  - EN 18219/18220/18222/18223 niet beoordeeld (licentie verbiedt AI-verwerking);
  - back-up-DPP-dienstverlener en contract;
  - DPP-levensduur per productgroep;
  - EU-registry (ESPR art. 13);
  - EN 18239/18246 (nog in ontwikkeling);
  - HTTP/1.1-interpretatie;
  - toegankelijkheidsaudit.
- **Go-live-besluit**: pas als de certificeerder de geblokkeerde punten heeft beoordeeld.
  Een geslaagde build of uitrol is geen bewijs van conformiteit of certificering.

## 11. Opruimen na een geslaagde overstap [MENS, apart akkoord]

Pas als productie op AWS stabiel draait en de eigenaar akkoord geeft:
- Vercel-project en -domeinkoppelingen verwijderen; Supabase-project pauzeren, na de
  bewaartermijn verwijderen (eerst een laatste dump archiveren).
- Azure-resources (als nog aanwezig) opzeggen.
- Uit de repository (zie README §10): `vercel.json`, `.vercelignore`, `supabase/`,
  `src/config/entra.js`, `src/services/nativeAuth.service.js`,
  `src/routes/cron.routes.js`, `.github/workflows/database-backup.yml`,
  `scripts/e2e-*.js`, `docs/infrastructuur.md`, en de pakketten
  `@supabase/supabase-js` en `@vercel/functions` (`npm uninstall ...`).
