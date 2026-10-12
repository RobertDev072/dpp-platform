# Infrastructuur VeriPasso

Stand: 2026-10-12. Productie draait op **Amazon Web Services (AWS)**, regio
**eu-west-1 (Ierland)**. Dit document beschrijft hoe de omgeving is opgebouwd, hoe je
uitrolt en beheert, en waar de grenzen liggen. De bron van waarheid is de code in
[`infra/`](../infra/) (AWS CDK) met de configuratie in
[`infra/config/production.json`](../infra/config/production.json). Wijzig je iets, doe
dat in de code en werk dit document bij; wijzigingen met de hand in de AWS-console
worden bij de volgende uitrol overschreven.

> **Overstap naar Lambda (2026-10-12).** De code beschrijft de nieuwe, goedkopere opzet
> hieronder: de app op AWS Lambda i.p.v. ECS Fargate met een interne load balancer. In
> AWS draait nog de vorige opzet (gepauzeerd) totdat de eerstvolgende uitrol is gedaan;
> zie §7 "Eerste uitrol na de overstap".

Er staan geen geheimen in dit document. Wachtwoorden en sleutels staan uitsluitend in
AWS Secrets Manager en GitHub-secrets.

---

## 1. Overzicht

```
                          DNS bij TransIP
     veripasso.com · www.veripasso.com · app.veripasso.com · qr.veripasso.com
                                   │  (ALIAS / CNAME)
                                   ▼
┌───────────────────────────── CloudFront (wereldwijd) ─────────────────────────────┐
│  TLS 1.2+ · HTTP/2 en HTTP/3 · certificaat voor alle 4 domeinen                    │
│  WAF (firewall, optioneel): AWS-beheerde regels + rate limits                      │
│  Domeinrouter (CloudFront Function): landingspagina / app / QR                     │
│  Cache: /_next/static/* en foto's 1 jaar · /p/* (paspoorten) 5 min · logo's 1 dag  │
└──────────────┬──────────────────────────────────────────────┬─────────────────────┘
               │ HTTPS + geheime header X-Origin-Verify        │ Origin Access Control
               ▼                                               ▼
     Lambda Function URL                              S3: productfoto's (/products/*)
               │
┌──────────────┼──────────────── VPC in eu-west-1 (2 zones) ────────────────────────┐
│              ▼                                                                     │
│  Lambda "app": Next.js + Express in één containerimage (Lambda Web Adapter)        │
│        │                         │                                                 │
│        ▼                         ▼ (gateway-endpoint)                              │
│  RDS PostgreSQL 17         S3: productfoto's + documenten (privé, versioning)      │
│  (privé subnet, TLS)                                                               │
└────────────────────────────────────────────────────────────────────────────────────┘
   EventBridge (onderhoud elk uur) · Secrets Manager · CloudWatch (logs, alarmen)
   SNS (e-mail) · Budgets · ECR (images)
```

## 2. Domeinen en DNS

DNS staat bij **TransIP** (nameservers `ns0.transip.net`, `ns1.transip.nl`,
`ns2.transip.eu`), niet in AWS Route 53.

| Domein | Rol | DNS-record bij TransIP |
|---|---|---|
| `veripasso.com` | wordt doorgestuurd naar `www` | `@` ALIAS → `d37e3416ndk4p8.cloudfront.net.` |
| `www.veripasso.com` | **landingspagina** | CNAME → `d37e3416ndk4p8.cloudfront.net.` |
| `app.veripasso.com` | **de SaaS** (inloggen, dashboards, beheer) | CNAME → `d37e3416ndk4p8.cloudfront.net.` |
| `qr.veripasso.com` | **QR-scans en paspoorten**; staat op elke gedrukte code en is dus **permanent** | CNAME → `d37e3416ndk4p8.cloudfront.net.` |
| `_xxxx.*` (5 records) | validatie van de certificaten | CNAME → `…acm-validations.aws.` |

**Nooit verwijderen:**
- het record van `qr.veripasso.com`: dan werken gedrukte QR-codes niet meer;
- de `_xxxx`-validatierecords: dan kan AWS de certificaten niet automatisch verlengen.

### Domeinverdeling (domeinrouter)

Een CloudFront Function ([`infra/lib/domain-router.js`](../infra/lib/domain-router.js))
bepaalt per domein wat er gebeurt, vóór het verzoek de app bereikt:

| Verzoek | Resultaat |
|---|---|
| `veripasso.com/…` | 301 → `www.veripasso.com/…` |
| `www.veripasso.com/` | landingspagina |
| `www.veripasso.com/login`, `/admin`, `/company`, `/partner`, `/activate`, `/wachtwoord-vergeten` | 302 → `app.veripasso.com/…` |
| `app.veripasso.com/` | 302 → `app.veripasso.com/login` |
| `/p/…` op een ander domein dan `qr` | 301 → `qr.veripasso.com/p/…` |
| `qr.veripasso.com/` en overige niet-paspoortpagina's | 302 → `www` of `app` |
| `/api/*`, `/_next/*`, `/brand/*`, `/products/*` | op elk domein doorgelaten |
| `/api/internal/*` | altijd 404 (alleen voor directe Lambda-aanroepen) |

Voor `/p/*` zet de router de Accept-header van browsers om naar `text/html`, zodat alle
browsers één cache-ingang delen; systemen die JSON, JSON-LD of XML vragen houden hun
eigen Accept en krijgen de machineleesbare versie (content negotiation).

## 3. Certificaten (AWS Certificate Manager)

Alle certificaten zijn door Amazon uitgegeven (RSA 2048, DNS-validatie) en worden
**automatisch verlengd** zolang de validatierecords bij TransIP blijven staan.

| Certificaat | Regio | Namen | Gebruik |
|---|---|---|---|
| `74da1390-15a5-4f01-b71f-c109c17d70d1` | us-east-1 | veripasso.com, www, app, qr | **CloudFront** (actief). CloudFront accepteert alleen certificaten uit us-east-1 |
| `357e84d6-9c8c-4c20-b218-daa931abca6e` | eu-west-1 | origin.veripasso.com | was voor de interne load balancer; na de overstap naar Lambda niet meer in gebruik (kan blijven staan) |
| `b2db4070-…` | us-east-1 | app, qr | vorige CloudFront-certificaat; niet meer in gebruik, kan blijven staan |
| `dbcc8de9-…` | us-east-1 | veripasso.com | niet in gebruik, kan blijven staan |
| (Stockholm) | eu-north-1 | — | mislukte eerste aanvraag; niet in gebruik |

De verbinding CloudFront → Lambda Function URL gebruikt het certificaat van AWS zelf
(`*.lambda-url.eu-west-1.on.aws`); daarvoor is geen eigen certificaat nodig.

## 4. AWS-account en stacks

- **Account:** `707191185248`.
- **Organisatie:** het account valt onder een AWS Organization met beheeraccount
  `915235252050`. Een beleid (SCP) daarvan **verbiedt CloudFormation in us-east-1**.
  CloudFront, WAF en ACM in us-east-1 zijn wel toegestaan. Daarom staan alle stacks in
  eu-west-1 en is de CloudFront-firewall eenmalig via de API aangemaakt (zie §6).

| Stack (CloudFormation) | Inhoud |
|---|---|
| `CDKToolkit` | CDK-bootstrap: S3-bucket en rollen voor uitrollen |
| `VeriPasso-production-Registry` | ECR-repository `veripasso-production-app` (container-images, onveranderlijke tags, laatste 10 bewaard) |
| `VeriPasso-production-App` | netwerk, database, opslag, app (Lambda), CloudFront, alarmen, budget |
| `VeriPasso-production-Ci` | GitHub OIDC-koppeling + deployrol `veripasso-production-github-deploy` |

De stacks `Edge` (WAF via CloudFormation in us-east-1) en `Dr` (back-ups naar
eu-central-1) bestaan in de code, maar zijn in deze omgeving niet actief.

## 5. Onderdelen in detail

### Netwerk
- VPC met 2 beschikbaarheidszones (eu-west-1a, eu-west-1b).
- **Geïsoleerde subnets:** de database en de app (Lambda). Geen route naar internet en
  die is ook niet nodig: S3 via een gratis gateway-endpoint, de database binnen de VPC,
  logs via de Lambda-dienst. Geen NAT-gateway, geen publieke IP-adressen.
- De publieke subnets bestaan nog (lege reserve), er draait niets in.

### Security groups (firewallregels binnen AWS)
| Groep | Mag inkomend |
|---|---|
| app (Lambda) | niets (alleen uitgaand) |
| database | poort 5432 alleen vanaf de app |

### CloudFront
- Distributie met domein `d37e3416ndk4p8.cloudfront.net`, prijsklasse 100 (Europa en Noord-Amerika).
- Minimaal **TLS 1.2** (`TLSv1.2_2021`), **HTTP/2 en HTTP/3**, HTTP wordt naar HTTPS doorgestuurd.
- Beveiligingsheaders: HSTS (2 jaar, incl. subdomeinen), X-Frame-Options DENY, nosniff, Referrer-Policy.
- **Origins:**
  - de **Lambda Function URL** over HTTPS (TLS 1.2+). CloudFront voegt de geheime header
    `X-Origin-Verify` toe (waarde uit Secrets Manager); de app weigert elk verzoek zonder
    die header met 403 ([`proxy.js`](../proxy.js)). Rechtstreeks naar de Function URL
    gaan heeft dus geen zin, en de firewall en domeinrouter zijn niet te omzeilen;
  - de **fotobucket** via Origin Access Control (de bucket blijft privé; alleen deze
    distributie mag lezen) voor `/products/*`.
- **Caching:**

  | Pad | CDN | Browser | Waarom |
  |---|---|---|---|
  | `/_next/static/*`, `/brand/*` | 1 jaar / volgens app | volgens app | onveranderlijke bestanden |
  | `/products/*` (productfoto's, WebP-miniaturen) | 1 jaar | 1 jaar, `immutable` | objectnamen zijn willekeurig en worden nooit overschreven |
  | `/api/public/products/*/logo` | 1 dag | 1 dag | logo van de uitgever |
  | `/p/*` (publieke paspoorten) | **5 minuten** | 1 minuut | sleutel op Accept; geen cookies |
  | al het andere (API, inloggen, beheer) | nooit | volgens app | persoonlijke en actuele data |

  Een wijziging aan een paspoort is dus binnen ~5 minuten voor iedereen zichtbaar.
  **Scans** worden niet meer bij het ophalen van de pagina geteld, maar per weergave via
  een lichte `POST /api/public/products/:id/scan` vanuit de browser (nooit gecachet), zodat
  ook gecachete weergaven precies één keer tellen. Machineleesbare opvragingen
  (`/api/dpp/…`) tellen zoals voorheen.

### Firewall (AWS WAF)
**Stand 2026-10-12: uitgeschakeld tijdens ontwikkeling** (bespaart ~$12/maand; de web-ACL is
verwijderd). Vóór livegang met klanten weer aanzetten: `node scripts/create-cloudfront-waf.js
production`, de ARN als `webAclArn` in de config, `enableWaf: true`, uitrollen. De regels:

Web-ACL `veripasso-production` (us-east-1, scope CloudFront):
- AWS-beheerde regels: IP-reputatie, Common Rule Set (de groottecontrole op de body staat op "tellen" voor de import van 4 MB) en Known Bad Inputs;
- rate limits per IP-adres per 5 minuten: 1500 op `/p/`, `/api/public/` en `/api/dpp/`; 100 op `/api/auth/` (inloggen);
- daarnaast een eigen rate limit in de app: 300 per minuut per IP op de publieke API.

### App (AWS Lambda)
- Functie `veripasso-production-app`: containerimage uit ECR (dezelfde Next.js-server als
  lokaal), 1 GB geheugen, x86_64, time-out 60 s, draait als niet-root gebruiker.
- De **Lambda Web Adapter** (in het image) vertaalt aanroepen naar HTTP-verzoeken op
  poort 3000. Antwoorden worden gestreamd (`RESPONSE_STREAM`).
- **Schalen:** automatisch, één uitvoeringsomgeving per gelijktijdig verzoek. Geen
  verkeer = geen kosten. Na een rustige periode is het eerste verzoek ~1–3 s trager
  (koude start). Optioneel `lambdaReservedConcurrency` als bovengrens (beschermt de
  database tegen te veel verbindingen; elke omgeving houdt er maximaal 2).
- **Uitrol:** CloudFormation vervangt de code; mislukt de update, dan rolt
  CloudFormation terug naar de vorige versie.
- **Onderhoud:** EventBridge roept de functie elk uur rechtstreeks aan (telemetrie,
  dagelijkse snapshot, opschonen, ontbrekende paspoortversies aanvullen; lease-lock in de
  database). Ook migraties en het aanmaken van de Platform Owner gaan via zo'n directe
  aanroep (`POST /api/internal/events`, zie
  [`internalEvents.routes.js`](../src/routes/internalEvents.routes.js)). Dat pad is van
  buitenaf onbereikbaar: de domeinrouter geeft 404 en de app weigert elk verzoek dat via
  de Function URL binnenkomt.
- **Productfoto's:** bij elke upload maakt de app een kleine WebP-versie (≤ 800 px
  breed); het publieke paspoort toont die via `/products/…`. Het origineel blijft
  ongewijzigd bewaard.

### Database (RDS for PostgreSQL 17)
- `db.t4g.micro`, single-AZ, 20 GB gp3 (groeit automatisch tot 100 GB), versleuteld.
- Niet publiek, TLS verplicht (`rds.force_ssl`, minimaal TLS 1.2). De app controleert het servercertificaat met de RDS-CA-bundel uit het image.
- **Wachtwoord:** door AWS gegenereerd in Secrets Manager (`veripasso-production-db-admin`). De app krijgt het bij de uitrol als omgevingsvariabele (CloudFormation-verwijzing). Automatische rotatie staat uit; na een handmatige rotatie is een nieuwe uitrol nodig.
- **Back-ups:** dagelijks, 7 dagen bewaard, herstel tot op de minuut (point-in-time). Verwijderbeveiliging staat aan; bij verwijderen van de stack wordt eerst een snapshot gemaakt.
- **Schema:** `dbo`. Migraties in `db/migrations/` lopen automatisch mee bij elke uitrol.
- Paspoortversies (`dbo.passportversions`) zijn **append-only**: een database-trigger weigert wijzigen en verwijderen.

### Bestandsopslag (S3)
- Buckets `veripasso-production-images-707191185248` en `veripasso-production-documents-707191185248`.
- Volledig privé (Block Public Access), versleuteld, alleen TLS 1.2+, **versioning** aan; niets wordt automatisch verwijderd. Huidige bestanden staan in **S3 Intelligent-Tiering** (weinig gebruikte bestanden automatisch goedkoper), oude versies gaan na 90 dagen naar Glacier Instant Retrieval.
- Productfoto's zijn voor CloudFront leesbaar via Origin Access Control (alleen deze distributie). De objectnamen bevatten een willekeurige UUID en zijn dus niet te raden; de app geeft het pad alleen voor gepubliceerde paspoorten.
- Uploads gaan rechtstreeks van de browser naar S3 via een presigned POST (maximaal 5 minuten geldig; S3 dwingt het type en de maximale grootte af). Downloads via presigned URL's van 5 minuten, pas na een toegangscontrole door de app.

### Geheimen (Secrets Manager)
| Geheim | Gebruik |
|---|---|
| `veripasso-production-db-admin` | databasegebruiker en -wachtwoord |
| `veripasso-production-app` | `COOKIE_SECRET` (ondertekening van sessiecookies) |
| `veripasso-production-mfa-key` | `MFA_ENCRYPTION_KEY` (versleuteling van TOTP-geheimen; **niet roteren** zonder herversleuteling) |
| `veripasso-production-origin-verify` | geheime header tussen CloudFront en de Function URL |

De geheimen komen bij de uitrol als omgevingsvariabelen in de functie (een
CloudFormation-verwijzing naar Secrets Manager; de waarde staat niet in de code of het
template). Zichtbaar voor wie in AWS de functieconfiguratie mag lezen; geef dat recht
dus alleen aan beheerders. Er staan geen toegangssleutels in de app: S3 wordt benaderd
via de IAM-rol van de functie, met minimale rechten.

### Monitoring en alarmen
- **Logs:** CloudWatch Logs-groep `/veripasso/production/app`, 30 dagen bewaard. Gestructureerd (JSON); wachtwoorden, tokens, cookies en presigned URL's worden altijd gemaskeerd.
- **Alarmen** (e-mail via SNS naar de adressen in de GitHub-variabele `ALARM_EMAILS`): Lambda-fouten, afknijpen (throttling), trage verwerking (P95 > 3 s), database-CPU, -opslag en -verbindingen, mislukte paspoortarchivering, onverwachte fouten en databasefouten.
- **Kosten:** maandbudget $10 met e-mail bij 50/80/100% en bij een verwachte overschrijding, plus kostenanomalie-detectie. **Let op: een budget waarschuwt alleen, het stopt niets.**
- **In de app:** het dashboard `/admin/systeemstatus` (alleen Platform Owner).

## 6. Eenmalig, buiten CloudFormation, aangemaakt

| Wat | Waarom | Hoe opnieuw |
|---|---|---|
| WAF-web-ACL `veripasso-production` (us-east-1) | het organisatiebeleid verbiedt CloudFormation in us-east-1 | `node scripts/create-cloudfront-waf.js production` (zelfde regels als `infra/lib/edge-stack.js`); de ARN staat als `webAclArn` in de config |
| ACM-certificaten | handmatig aangevraagd (console/CLI) | via ACM, DNS-validatie bij TransIP |
| CDK-bootstrap eu-west-1 | voorwaarde voor uitrollen | `npx cdk bootstrap aws://707191185248/eu-west-1` |

Wijzig je de WAF-regels in `edge-stack.js`, voer ze dan ook door in de bestaande web-ACL
(console of script). De uitrol doet dat niet automatisch.

## 7. Uitrollen en beheren

### Een nieuwe versie uitrollen
1. Code naar `main` pushen (de CI-controle draait automatisch: tests op PostgreSQL 17, build, infra-tests, Docker-build).
2. GitHub → **Actions → "Deploy naar AWS" → Run workflow** → `production`.
3. De workflow, in ongeveer 10 minuten:
   - logt via OIDC in met de deployrol;
   - bouwt en pusht het image;
   - rolt de app-stack uit met de nieuwe image-tag (CloudFormation rolt terug bij een fout);
   - draait de migraties en vult ontbrekende paspoortversies aan via een directe aanroep van de functie;
   - controleert `https://app.veripasso.com/api/health`.
4. De database moet draaien: na een pauze eerst **hervatten**.

**GitHub-instellingen** (environment `production`):
- variabelen: `AWS_DEPLOY_ROLE_ARN`, `ALARM_EMAILS`;
- secrets: `SYSTEM_OWNER_EMAIL`, `SYSTEM_OWNER_PASSWORD`, `SYSTEM_OWNER_FIRST_NAME`, `SYSTEM_OWNER_LAST_NAME` (alleen nodig met de optie *seed_owner*).

### Handmatig vanaf een pc (beheer)
```bash
aws login --region eu-west-1                     # tijdelijke inlog via de browser
cd infra && npm ci
npx cdk diff  VeriPasso-production-App -c env=production -c imageTag=<git-sha> -c alarmEmails=a@x,b@y
npx cdk deploy VeriPasso-production-App -c env=production -c imageTag=<git-sha> -c alarmEmails=a@x,b@y
```
Gebruik als `imageTag` altijd de commit die nu draait (anders rol je een andere
app-versie uit). Bekijk eerst `cdk diff`.

### Eerste uitrol na de overstap (eenmalig)
1. GitHub → Actions → **AWS pauzeren / hervatten** → `hervatten` (start de database).
2. GitHub → Actions → **Deploy naar AWS** → `production`. De workflow werkt eerst de
   rechten van de deployrol bij (CI-stack: Lambda i.p.v. ECS). CloudFormation maakt de
   functie aan, zet CloudFront om en verwijdert daarna ECS, de load balancer en de VPC
   origin.
3. Controleren: landingspagina, inloggen, een paspoort scannen, foto zichtbaar, scan
   geteld in het dashboard.

### Opschalen (vóór echte klanten aanbevolen)
In `infra/config/production.json`:
- `dbInstanceClass` → `t4g.small` of groter;
- `dbMultiAz` → `true` (database in twee zones);
- `lambdaReservedConcurrency` → bijvoorbeeld 50 (bovengrens databaseverbindingen); bij
  veel gelijktijdig verkeer RDS Proxy overwegen;
- `dbBackupRetentionDays` → 35, en `longTermBackupRetentionDays` → bijvoorbeeld 3650 (maandelijkse back-up 10 jaar);
- `enableAwsBackupCopy` en `enableS3CrossRegionReplication` → `true` (kopieën naar eu-central-1);
- `enableWaf` → `true` met een `webAclArn` (zie §6).

Daarna dezelfde uitrolworkflow. Dit verhoogt de kosten (zie [aws-cost-model.md](aws-cost-model.md)).

### Pauzeren en hervatten (kosten besparen)
GitHub → Actions → **"AWS pauzeren / hervatten"** (`.github/workflows/aws-pause.yml`):
- **pauzeren**: de app op gelijktijdigheid 0 (verzoeken worden geweigerd) en de database
  gestopt. Alleen opslag, geheimen en images kosten nog (~$5/maand).
- **hervatten**: database starten, wachten tot beschikbaar, app vrijgeven (~5–10 min).
- Altijd hervatten vóór een uitrol. AWS start een gestopte database na 7 dagen automatisch.

### Rollback, back-up en herstel
Zie [aws-deployment-runbook.md](aws-deployment-runbook.md) §8 en §9: een vorige versie
terugzetten, point-in-time-herstel van de database naar een nieuwe instantie, en de
restore-test.

## 8. Kosten (indicatie)

Ongeveer **$19–21 per maand** in de huidige, kleinste opzet (zonder WAF; met WAF +$12).
Dat is vooral de database (~$15,5). De app (Lambda) en CloudFront vallen bij het huidige
verkeer binnen de altijd-gratis tegoeden; er zijn geen load balancer, NAT-gateway of
publieke IP-adressen meer. Gepauzeerd ~$5 per maand.

Details en groeiscenario's: [aws-cost-model.md](aws-cost-model.md). Een eventueel
AWS-starttegoed zie je onder Billing → Credits.

## 9. Wat bewust (nog) niet zo is ingericht

| Onderwerp | Huidige stand | Wanneer aanpassen |
|---|---|---|
| Hoge beschikbaarheid | app schaalt over 2 zones; database in 1 zone | vóór echte klanten (§7, Opschalen) |
| Disaster recovery buiten Ierland | uit | samen met opschalen |
| Aparte testomgeving | alleen productie | aanbevolen vóór grotere wijzigingen (config `staging.json` staat klaar) |
| Database-applicatierol met minimale rechten | app gebruikt de RDS-beheerder | zie [aws-security-checklist.md](aws-security-checklist.md) |
| Content-Security-Policy | niet ingesteld | vervolgstap beveiliging |
| E-mailverzending | geen (bewuste keuze) | bij behoefte Amazon SES |
| Database-verbindingen bij piekverkeer | max. 2 per Lambda-omgeving, geen RDS Proxy | bij veel gelijktijdige gebruikers (§7, Opschalen) |
| HTTP/1.1 | CloudFront accepteert het nog voor oude clients | oordeel certificeerder (EN 18216) |
