# AWS-kostenmodel VeriPasso

> **Alle bedragen zijn schattingen, geen offerte.** Basis: openbare AWS-prijzen voor
> `eu-west-1` (Ierland) zoals bekend bij het opstellen (oktober 2026), in USD, exclusief
> btw. Prijzen, gratis tegoeden en wisselkoersen veranderen. Controleer vóór elke
> beslissing in de [AWS Pricing Calculator](https://calculator.aws/) en op de
> prijspagina's hieronder. **AWS Budgets waarschuwt, maar begrenst de uitgaven niet.**

## Uitgangspunten (aannames, te bevestigen)

| Aanname | Waarde | Toelichting |
|---|---|---|
| Regio | eu-west-1, DR-kopieën in eu-central-1 | zie assessment §2 |
| Paginagewicht publiek paspoort | ~150 kB HTML/API + ~400 kB statische assets (eerste bezoek) | assets komen uit de CloudFront-cache |
| Productfoto per paspoortweergave | ~300 kB, rechtstreeks uit S3 (presigned URL) | S3-uitgaand verkeer, niet via CloudFront |
| Documentdownloads | ~5% van de scans, ~2 MB | |
| Bestanden per product | ~10 MB (5 foto's + 5 PDF's) | volgens het planningsmodel |
| Scanlogging | 1 rij per scan in `dbo.scanevents` (~200 B incl. index) | geen ruwe logs per request in CloudWatch |
| Paspoortversies | ~10 versies per product, ~8 kB per versie | append-only, nooit verwijderd |
| CloudFront-cachehit | alleen statische assets; paspoorten en API niet gecachet | bewust: actuele data en scantelling |
| Back-ups | RDS-PITR 7 (staging) / 35 dagen (productie); maandelijkse back-up 10 jaar (productie) | geen dubbeltelling: PITR-opslag tot 100% van de DB-grootte is inbegrepen |
| Gratis tegoeden | CloudFront: 1 TB + 10 mln. verzoeken/maand altijd gratis; S3/EC2: 100 GB/maand gratis uitgaand verkeer (gezamenlijk) | de nieuwe-account-Free Tier is **niet** meegerekend |

## Fase 1 — ontwikkeling/test (staging)

1 taak, single-AZ-database, weinig data, WAF aan (kan uit: −$12).

| Post | Berekening | $/maand |
|---|---|---|
| ECS Fargate | 0,5 vCPU + 1 GB × 730 u (≈ $0,0247/u) | 18 |
| Publieke IPv4-adressen | 1 taak + 2 ALB-AZ's × $3,65 | 11 |
| Application Load Balancer | $0,0252/u + ~0,5 LCU | 21 |
| RDS PostgreSQL db.t4g.micro single-AZ | ~$0,018/u | 13 |
| RDS-opslag gp3 20 GB | × ~$0,127 | 3 |
| S3 (10 GB + verzoeken) | | 1 |
| CloudFront | binnen gratis tegoed | 0 |
| WAF | $5 ACL + 7 regels × $1 + verzoeken | 12 |
| Secrets Manager | 5 geheimen × $0,40 | 2 |
| CloudWatch (logs ~2 GB, ~12 alarmen, 3 metric filters) | | 4 |
| ECR (images) | ~3 GB | 0,3 |
| **Totaal (schatting)** | | **≈ 85 (bandbreedte 70–110)** |

## Fase 2 — vroege productie

Aanname: ~100 klantbedrijven, ~10.000 producten, ~100 GB bestanden, ~1 mln. scans/jaar.
2 taken, Multi-AZ-database, S3-replicatie en back-upkopie naar eu-central-1.

| Post | Berekening | $/maand |
|---|---|---|
| ECS Fargate | 2 × 0,5 vCPU/1 GB | 36 |
| Publieke IPv4 | 2 taken + 2 ALB-AZ's | 15 |
| ALB | uur + ~1 LCU | 24 |
| RDS db.t4g.small Multi-AZ | ~$0,072/u | 53 |
| RDS-opslag gp3 50 GB Multi-AZ | × ~$0,254 | 13 |
| RDS-back-up buiten PITR (maandelijks, AWS Backup) | ~12 × 2 GB × $0,095 | 2 |
| Back-upkopie DR-regio | opslag + transfer | 2 |
| S3 Standard 100 GB + versies | | 3 |
| S3-replica eu-central-1 (Glacier IR) + replicatietransfer | 100 GB × $0,005 + groei × $0,02 | 1 |
| S3 uitgaand (foto's/documenten) | ~40 GB, binnen 100 GB gratis | 0 |
| CloudFront | ~50 GB, ~1 mln. verzoeken: binnen gratis tegoed | 0 |
| WAF | | 13 |
| Secrets Manager, CloudWatch, ECR | | 8 |
| **Totaal (schatting)** | | **≈ 170 (bandbreedte 140–220)** |

## Fase 3 — groeiscenario

~2.000 bedrijven, ~200.000 productmodellen, ~2 TB bronbestanden, 4–20 mln. scans/jaar
(gemiddeld 0,13–0,63 scans/s; ontwerp-piek 50/s, **nog te loadtesten**).

| Post | Berekening | $/maand (4 mln.) | $/maand (20 mln.) |
|---|---|---|---|
| ECS Fargate | 2–4 × 1 vCPU/2 GB (~$36/taak), autoscaling | 72 | 144 |
| Publieke IPv4 | taken + ALB | 15 | 22 |
| ALB | uur + 1–3 LCU | 24 | 36 |
| RDS db.t4g.large Multi-AZ (of m7g.large) | ~$0,28/u (t4g.large M-AZ) | 206 | 206–380 |
| RDS-opslag gp3 200 GB Multi-AZ | DB ~50–100 GB incl. versies en scans | 51 | 51 |
| RDS-back-up (maandelijks 10 jaar, PITR boven DB-grootte) | groeit lineair | 20 | 30 |
| S3 Standard 2 TB + ~10% versies | 2.250 GB × $0,023 | 52 | 52 |
| S3-replica Glacier IR eu-central-1 | 2.250 GB × ~$0,005 + nieuwe data × $0,02 | 13 | 13 |
| S3 uitgaand (foto's + documenten) | 4 mln.: ~140 GB; 20 mln.: ~650 GB (−100 GB gratis) | 4 | 50 |
| CloudFront (data + verzoeken) | 20 mln.: ~0,9 TB, ~17 mln. verzoeken | 0 | 10 |
| WAF (incl. verzoeken) | | 14 | 22 |
| CloudWatch, Secrets, ECR, back-upkopie DR | | 15 | 25 |
| **Totaal (schatting)** | | **≈ 490** | **≈ 640–800** |

Bandbreedte groeiscenario: **$450–900/maand**. De database is de grootste post; een
single-AZ-database scheelt ~50% op die regel, maar geeft bij een AZ-storing uitval.

## Wat de kosten het meest beïnvloedt

1. **Database-instantie en Multi-AZ.** Begin klein (t4g.small), schaal op metingen
   (CPU, verbindingen, Performance Insights).
2. **Uitgaand verkeer van foto's.** Bij 20 mln. scans is S3-egress ~$50/maand.
   Optimalisatie (niet geïmplementeerd): publieke productfoto's via CloudFront met Origin
   Access Control serveren, dan valt het grotendeels in het gratis CloudFront-tegoed.
3. **Publieke IPv4-adressen** ($3,65/maand per adres): bewust geaccepteerd i.p.v. een
   NAT-gateway (~$35/maand + data).
4. **Bewaartermijnen**: versies en back-ups worden nooit automatisch verwijderd. De
   opslag groeit dus lineair; herzien zodra de wettelijke DPP-levensduur per productgroep
   bekend is.
5. **Logs**: de app logt geen request-regels naar CloudWatch (alleen fouten en
   onderhoud); per-request-telemetrie staat geaggregeerd in de database.

## Budgetten en waarschuwingen (in de infrastructuurcode)

- Maandbudget per omgeving (`monthlyBudgetUsd`: staging $100, productie $400) met
  e-mail bij 50/80/100% werkelijk en 100% verwacht.
- Cost Anomaly Detection per AWS-dienst, dagelijkse e-mail bij een afwijking ≥ $20.
- **Geen harde limiet**: bij misbruik of een fout kunnen de kosten boven het budget
  uitkomen. De WAF-rate-limits en de autoscaling-maximum (`maxTasks`) beperken het
  risico, maar garanderen niets.

## Officiële prijspagina's

- Fargate: https://aws.amazon.com/fargate/pricing/
- Elastic Load Balancing: https://aws.amazon.com/elasticloadbalancing/pricing/
- RDS for PostgreSQL: https://aws.amazon.com/rds/postgresql/pricing/
- S3: https://aws.amazon.com/s3/pricing/
- CloudFront: https://aws.amazon.com/cloudfront/pricing/
- WAF: https://aws.amazon.com/waf/pricing/
- Secrets Manager: https://aws.amazon.com/secrets-manager/pricing/
- CloudWatch: https://aws.amazon.com/cloudwatch/pricing/
- AWS Backup: https://aws.amazon.com/backup/pricing/
- Publieke IPv4: https://aws.amazon.com/vpc/pricing/
- ECR: https://aws.amazon.com/ecr/pricing/
- Budgets / Cost Explorer: https://aws.amazon.com/aws-cost-management/pricing/
