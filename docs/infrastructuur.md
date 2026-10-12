# Infrastructuur VeriPasso

Stand: 2026-10-12. Productie draait op **Amazon Web Services (AWS)**, regio
**eu-west-1 (Ierland)**. Dit document beschrijft hoe de omgeving is opgebouwd, hoe je
uitrolt en beheert, en waar de grenzen liggen. De bron van waarheid is de code in
[`infra/`](../infra/) (AWS CDK) met de configuratie in
[`infra/config/production.json`](../infra/config/production.json). Wijzig je iets, doe
dat in de code en werk dit document bij; wijzigingen met de hand in de AWS-console
worden bij de volgende uitrol overschreven.

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
│  WAF (firewall): AWS-beheerde regels + rate limits                                 │
│  Domeinrouter (CloudFront Function): landingspagina / app / QR                     │
│  Cache alleen voor /_next/static/* en /brand/*                                     │
└───────────────────────────────────┬───────────────────────────────────────────────┘
                                    │ VPC origin: privé AWS-netwerk, TLS 1.2+
┌─────────────────────────── VPC in eu-west-1 (2 zones) ────────────────────────────┐
│  Interne load balancer (ALB), geen publiek adres                                   │
│        │                                                                           │
│        ▼                                                                           │
│  ECS Fargate: container "app" (Next.js + Express), 1–2 taken                       │
│        │                         │                                                 │
│        ▼                         ▼                                                 │
│  RDS PostgreSQL 17         S3: productfoto's + documenten (privé, versioning)      │
│  (privé subnet, TLS)                                                               │
└────────────────────────────────────────────────────────────────────────────────────┘
   Secrets Manager · CloudWatch (logs, alarmen) · SNS (e-mail) · Budgets · ECR (images)
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
| `/api/*`, `/_next/*`, `/brand/*` | op elk domein doorgelaten |

## 3. Certificaten (AWS Certificate Manager)

Alle certificaten zijn door Amazon uitgegeven (RSA 2048, DNS-validatie) en worden
**automatisch verlengd** zolang de validatierecords bij TransIP blijven staan.

| Certificaat | Regio | Namen | Gebruik |
|---|---|---|---|
| `74da1390-15a5-4f01-b71f-c109c17d70d1` | us-east-1 | veripasso.com, www, app, qr | **CloudFront** (actief). CloudFront accepteert alleen certificaten uit us-east-1 |
| `357e84d6-9c8c-4c20-b218-daa931abca6e` | eu-west-1 | origin.veripasso.com | versleutelde interne verbinding CloudFront → load balancer (actief) |
| `b2db4070-…` | us-east-1 | app, qr | vorige CloudFront-certificaat; niet meer in gebruik, kan blijven staan |
| `dbcc8de9-…` | us-east-1 | veripasso.com | niet in gebruik, kan blijven staan |
| (Stockholm) | eu-north-1 | — | mislukte eerste aanvraag; niet in gebruik |

`origin.veripasso.com` is alleen een certificaatnaam. Bezoekers gebruiken hem nooit, en
er is geen DNS-record voor nodig.

## 4. AWS-account en stacks

- **Account:** `707191185248`.
- **Organisatie:** het account valt onder een AWS Organization met beheeraccount
  `915235252050`. Een beleid (SCP) daarvan **verbiedt CloudFormation in us-east-1**.
  CloudFront, WAF en ACM in us-east-1 zijn wel toegestaan. Daarom staan alle stacks in
  eu-west-1 en is de CloudFront-firewall eenmalig via de API aangemaakt (zie §6).

| Stack (CloudFormation) | Inhoud |
|---|---|
| `CDKToolkit` | CDK-bootstrap: S3-bucket en rollen voor uitrollen |
| `VeriPasso-production-Registry` | ECR-repository `veripasso-production-app` (container-images, onveranderlijke tags, laatste 30 bewaard) |
| `VeriPasso-production-App` | netwerk, database, opslag, app, load balancer, CloudFront, alarmen, budget |
| `VeriPasso-production-Ci` | GitHub OIDC-koppeling + deployrol `veripasso-production-github-deploy` |

De stacks `Edge` (WAF via CloudFormation in us-east-1) en `Dr` (back-ups naar
eu-central-1) bestaan in de code, maar zijn in deze omgeving niet actief.

## 5. Onderdelen in detail

### Netwerk
- VPC met 2 beschikbaarheidszones (eu-west-1a, eu-west-1b).
- **Publieke subnets:** de app-taken. Ze hebben een publiek IP voor uitgaand verkeer (AWS-API's, images), maar inkomend verkeer is alleen van de load balancer toegestaan. Er is bewust geen NAT-gateway (scheelt ~$35/maand).
- **Geïsoleerde subnets:** de database en de interne load balancer. Geen route naar internet.
- S3-verkeer via een gratis gateway-endpoint.

### Security groups (firewallregels binnen AWS)
| Groep | Mag inkomend |
|---|---|
| load balancer | poort 443 vanaf `CloudFront-VPCOrigins-Service-SG` (`sg-0e58bab5cef48f3a5`, door AWS beheerd) en vanaf het eigen VPC-adresbereik |
| app-taken | poort 3000 alleen vanaf de load balancer |
| database | poort 5432 alleen vanaf de app-taken |

### CloudFront
- Distributie met domein `d37e3416ndk4p8.cloudfront.net`, prijsklasse 100 (Europa en Noord-Amerika).
- Minimaal **TLS 1.2** (`TLSv1.2_2021`), **HTTP/2 en HTTP/3**, HTTP wordt naar HTTPS doorgestuurd.
- Beveiligingsheaders: HSTS (2 jaar, incl. subdomeinen), X-Frame-Options DENY, nosniff, Referrer-Policy.
- **Geen caching** van pagina's en API: paspoorten zijn altijd actueel en elke scan wordt geteld. Wel caching van `/_next/static/*` en `/brand/*`.
- Origin: **VPC origin** naar de interne load balancer over HTTPS (TLS 1.2+), certificaatnaam `origin.veripasso.com`.

### Firewall (AWS WAF)
Web-ACL `veripasso-production` (us-east-1, scope CloudFront):
- AWS-beheerde regels: IP-reputatie, Common Rule Set (de groottecontrole op de body staat op "tellen" voor de import van 4 MB) en Known Bad Inputs;
- rate limits per IP-adres per 5 minuten: 1500 op `/p/`, `/api/public/` en `/api/dpp/`; 100 op `/api/auth/` (inloggen);
- daarnaast een eigen rate limit in de app: 300 per minuut per IP op de publieke API.

### Load balancer (ALB)
Intern (geen publiek adres), HTTPS met policy TLS 1.2/1.3, HTTP/2, ongeldige headers
worden geweigerd. Health check: `GET /api/health` elke 15 seconden.

### App (ECS Fargate)
- Cluster `veripasso-production-cluster`, service `veripasso-production-app`.
- Taak: 0,5 vCPU, 1 GB geheugen, x86_64, container `app` (Node.js 24, draait als niet-root gebruiker).
- **Aantal:** 1 taak, automatisch 1–2 op basis van CPU (60%), geheugen (75%) en verzoeken.
- **Uitrol:** eerst nieuwe taken; de oude stoppen pas als de nieuwe gezond zijn. Bij falen rolt de circuit breaker automatisch terug.
- **Achtergrondtaken in de app:** telemetrie wegschrijven en dagelijks onderhoud (snapshot, opschonen, ontbrekende paspoortversies aanvullen). Bij meerdere taken voert er precies één het onderhoud uit (lease-lock).

### Database (RDS for PostgreSQL 17)
- `db.t4g.micro`, single-AZ, 20 GB gp3 (groeit automatisch tot 100 GB), versleuteld.
- Niet publiek, TLS verplicht (`rds.force_ssl`, minimaal TLS 1.2). De app controleert het servercertificaat met de RDS-CA-bundel uit het image.
- **Wachtwoord:** door AWS gegenereerd in Secrets Manager (`veripasso-production-db-admin`). De app leest het bij elke nieuwe verbinding, dus rotatie werkt zonder herstart.
- **Back-ups:** dagelijks, 7 dagen bewaard, herstel tot op de minuut (point-in-time). Verwijderbeveiliging staat aan; bij verwijderen van de stack wordt eerst een snapshot gemaakt.
- **Schema:** `dbo`. Migraties in `db/migrations/` lopen automatisch mee bij elke uitrol.
- Paspoortversies (`dbo.passportversions`) zijn **append-only**: een database-trigger weigert wijzigen en verwijderen.

### Bestandsopslag (S3)
- Buckets `veripasso-production-images-707191185248` en `veripasso-production-documents-707191185248`.
- Volledig privé (Block Public Access), versleuteld, alleen TLS 1.2+, **versioning** aan; niets wordt automatisch verwijderd. Oude versies gaan na 90 dagen naar goedkopere opslag.
- Uploads gaan rechtstreeks van de browser naar S3 via een presigned POST (maximaal 5 minuten geldig; S3 dwingt het type en de maximale grootte af). Downloads via presigned URL's van 5 minuten, pas na een toegangscontrole door de app.

### Geheimen (Secrets Manager)
| Geheim | Gebruik |
|---|---|
| `veripasso-production-db-admin` | databasegebruiker en -wachtwoord |
| `veripasso-production-app` | `COOKIE_SECRET` (ondertekening van sessiecookies) |
| `veripasso-production-mfa-key` | `MFA_ENCRYPTION_KEY` (versleuteling van TOTP-geheimen; **niet roteren** zonder herversleuteling) |

Er staan geen toegangssleutels in de app: S3 en Secrets Manager worden benaderd via de
IAM-rol van de taak, met minimale rechten.

### Monitoring en alarmen
- **Logs:** CloudWatch Logs-groep `/veripasso/production/app`, 30 dagen bewaard. Gestructureerd (JSON); wachtwoorden, tokens, cookies en presigned URL's worden altijd gemaskeerd.
- **Alarmen** (e-mail via SNS naar de adressen in de GitHub-variabele `ALARM_EMAILS`): 5xx-fouten, ongezonde taken, trage responstijd (P95 > 2 s), database-CPU, -opslag en -verbindingen, app-CPU, mislukte paspoortarchivering, onverwachte fouten en databasefouten.
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
3. De workflow, in ongeveer 10–15 minuten:
   - logt via OIDC in met de deployrol;
   - bouwt en pusht het image;
   - draait de migraties als eenmalige taak;
   - rolt de app-stack uit met de nieuwe image-tag;
   - vult ontbrekende paspoortversies aan.
4. Gaat een nieuwe versie mis, dan rolt ECS automatisch terug.

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

### Opschalen (vóór echte klanten aanbevolen)
In `infra/config/production.json`:
- `desiredCount` en `minTasks` → 2 (twee taken in twee zones);
- `dbInstanceClass` → `t4g.small` of groter;
- `dbMultiAz` → `true` (database in twee zones);
- `dbBackupRetentionDays` → 35, en `longTermBackupRetentionDays` → bijvoorbeeld 3650 (maandelijkse back-up 10 jaar);
- `enableAwsBackupCopy` en `enableS3CrossRegionReplication` → `true` (kopieën naar eu-central-1).

Daarna dezelfde uitrolworkflow. Dit verhoogt de kosten (zie [aws-cost-model.md](aws-cost-model.md)).

### Rollback, back-up en herstel
Zie [aws-deployment-runbook.md](aws-deployment-runbook.md) §8 en §9: een vorige versie
terugzetten, point-in-time-herstel van de database naar een nieuwe instantie, en de
restore-test.

## 8. Kosten (indicatie)

Ongeveer **$2–2,50 per dag (~$60–80 per maand)** in de huidige, kleinste opzet. Dat zijn
vooral vaste uurkosten:
- load balancer ~$21
- firewall ~$12
- database ~$16
- container ~$18
- publieke IP-adressen ~$7

Verkeer en opslag tellen bij weinig gebruik nauwelijks mee. Details en groeiscenario's:
[aws-cost-model.md](aws-cost-model.md). Een eventueel AWS-starttegoed zie je onder
Billing → Credits.

## 9. Wat bewust (nog) niet zo is ingericht

| Onderwerp | Huidige stand | Wanneer aanpassen |
|---|---|---|
| Hoge beschikbaarheid | 1 taak, database in 1 zone | vóór echte klanten (§7, Opschalen) |
| Disaster recovery buiten Ierland | uit | samen met opschalen |
| Aparte testomgeving | alleen productie | aanbevolen vóór grotere wijzigingen (config `staging.json` staat klaar) |
| Database-applicatierol met minimale rechten | app gebruikt de RDS-beheerder | zie [aws-security-checklist.md](aws-security-checklist.md) |
| Content-Security-Policy | niet ingesteld | vervolgstap beveiliging |
| E-mailverzending | geen (bewuste keuze) | bij behoefte Amazon SES |
| Productfoto's via CloudFront | via presigned S3-links | bij veel scans (kosten) |
| HTTP/1.1 | CloudFront accepteert het nog voor oude clients | oordeel certificeerder (EN 18216) |
