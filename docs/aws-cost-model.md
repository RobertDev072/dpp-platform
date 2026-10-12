# AWS-kostenmodel VeriPasso

> **Alle bedragen zijn schattingen, geen offerte.** Basis: openbare AWS-prijzen voor
> `eu-west-1` (Ierland) zoals bekend bij het opstellen (oktober 2026), in USD, exclusief
> btw. Prijzen, gratis tegoeden en wisselkoersen veranderen. Controleer vóór elke
> beslissing in de [AWS Pricing Calculator](https://calculator.aws/) en op de
> prijspagina's hieronder. **AWS Budgets waarschuwt, maar begrenst de uitgaven niet.**

Stand 2026-10-12: de app draait op **AWS Lambda** (betalen per verzoek) in plaats van
ECS Fargate met een load balancer. Daarmee vallen de vaste uurkosten van container,
load balancer en publieke IP-adressen weg (samen ~$45–50/maand); bij weinig verkeer
blijft vooral de database over.

## Uitgangspunten (aannames, te bevestigen)

| Aanname | Waarde | Toelichting |
|---|---|---|
| Regio | eu-west-1, DR-kopieën in eu-central-1 | zie assessment §2 |
| App | Lambda, 1 GB geheugen, x86_64, gemiddeld ~150 ms per verzoek | containerimage met Lambda Web Adapter |
| Paspoortpagina (`/p/*`) | 5 minuten gecachet in CloudFront | per paspoort hooguit ~12 app-aanroepen per uur, ongeacht het aantal scans |
| Scantelling | 1 lichte POST (beacon) per weergave, ~20 ms | nooit gecachet; telt precies |
| Productfoto per weergave | kleine WebP (≤ 800 px, ~40–80 kB) via CloudFront, 1 jaar gecachet | geen S3-uitgaand verkeer per weergave |
| Bedrijfslogo | losse afbeelding, 1 dag gecachet (was inline in elke pagina) | |
| Statische assets (`/_next/static`) | 1 jaar in browser en CDN | |
| Documentdownloads | ~5% van de scans, ~2 MB, via presigned S3-link | |
| Bestanden per product | ~10 MB (5 foto's + 5 PDF's) | volgens het planningsmodel |
| Paspoortversies | ~10 versies per product, ~8 kB per versie | append-only, nooit verwijderd |
| Gratis tegoeden (altijd, niet alleen het eerste jaar) | Lambda: 1 mln. verzoeken + 400.000 GB-s/maand; CloudFront: 1 TB + 10 mln. verzoeken/maand; 100 GB/maand uitgaand verkeer | de nieuwe-account-Free Tier is **niet** meegerekend |

## Fase 1 — ontwikkeling/test en eerste klanten (huidige productieconfiguratie)

Single-AZ-database, WAF uit (aan: +$12).

| Post | Berekening | $/maand |
|---|---|---|
| Lambda (app) | binnen het gratis tegoed | 0 |
| RDS PostgreSQL db.t4g.micro single-AZ | ~$0,018/u × 730 | 13 |
| RDS-opslag gp3 20 GB | × ~$0,127 | 2,5 |
| S3 (enkele GB, Intelligent-Tiering) | | 0,5 |
| CloudFront | binnen gratis tegoed | 0 |
| Secrets Manager | 4 geheimen × $0,40 | 1,6 |
| CloudWatch (logs < 1 GB, ~13 alarmen, 3 metric filters) | eerste 10 alarmen gratis | 1–2 |
| ECR (laatste 10 images, ~0,3 GB elk) | ~3 GB × $0,10 | 0,3 |
| Load balancer, publieke IPv4, NAT | geen | 0 |
| **Totaal (schatting)** | | **≈ 19–21** |

Gepauzeerd (workflow "AWS pauzeren / hervatten": database gestopt, app op 0): alleen
opslag, geheimen en images, **≈ $5/maand**.

## Fase 2 — vroege productie

Aanname: ~100 klantbedrijven, ~10.000 producten, ~100 GB bestanden, ~1 mln. scans/jaar.
Multi-AZ-database, S3-replicatie en back-upkopie naar eu-central-1, WAF aan.

| Post | Berekening | $/maand |
|---|---|---|
| Lambda | ~85.000 scans/maand + SaaS-gebruik: < 100.000 GB-s | 0 |
| RDS db.t4g.small Multi-AZ | ~$0,072/u | 53 |
| RDS-opslag gp3 50 GB Multi-AZ | × ~$0,254 | 13 |
| RDS-back-up buiten PITR (maandelijks, AWS Backup) | ~12 × 2 GB × $0,095 | 2 |
| Back-upkopie DR-regio | opslag + transfer | 2 |
| S3 100 GB + versies (Intelligent-Tiering) | | 2–3 |
| S3-replica eu-central-1 (Glacier IR) + replicatietransfer | | 1 |
| CloudFront | ~20 GB, ~1 mln. verzoeken: binnen gratis tegoed | 0 |
| WAF | $5 ACL + 7 regels + verzoeken | 13 |
| Secrets Manager, CloudWatch, ECR | | 5 |
| **Totaal (schatting)** | | **≈ 90 (bandbreedte 80–120)** |

## Fase 3 — groeiscenario

~2.000 bedrijven, ~200.000 productmodellen, ~2 TB bronbestanden, 4–20 mln. scans/jaar
(gemiddeld 0,13–0,63 scans/s; ontwerp-piek 50/s, **nog te loadtesten**).

| Post | Berekening | $/maand (4 mln.) | $/maand (20 mln.) |
|---|---|---|---|
| Lambda | beacons + cache-missers + SaaS; 20 mln.: ~1,7 mln. verzoeken, ~250.000 GB-s | 0 | 1–5 |
| RDS db.t4g.large Multi-AZ (of m7g.large) | ~$0,28/u | 206 | 206–380 |
| RDS-opslag gp3 200 GB Multi-AZ | DB ~50–100 GB incl. versies en scans | 51 | 51 |
| RDS-back-up (maandelijks 10 jaar, PITR boven DB-grootte) | groeit lineair | 20 | 30 |
| S3 2 TB + ~10% versies, Intelligent-Tiering | deels in goedkopere lagen | 35–52 | 35–52 |
| S3-replica Glacier IR eu-central-1 | | 13 | 13 |
| S3 uitgaand (alleen documenten; foto's via CloudFront) | ~5% × 2 MB per scan | 0 | 10 |
| CloudFront (data + verzoeken) | 20 mln.: ~0,5 TB, ~25 mln. verzoeken | 0 | 15 |
| WAF (incl. verzoeken) | | 14 | 22 |
| CloudWatch, Secrets, ECR, back-upkopie DR | | 12 | 20 |
| **Totaal (schatting)** | | **≈ 350–370** | **≈ 400–600** |

De database is ruim de grootste post; een single-AZ-database scheelt ~50% op die regel,
maar geeft bij een AZ-storing uitval.

## Wat de kosten het meest beïnvloedt

1. **Database-instantie en Multi-AZ.** Begin klein, schaal op metingen (CPU,
   verbindingen, Performance Insights). Pauzeren tijdens ontwikkeling scheelt ~$15/maand.
2. **Caching.** Paspoorten 5 minuten aan de rand, foto's en statische bestanden een
   jaar, logo's een dag. Zonder caching zou elke scan de app en S3 raken.
3. **Lambda-geheugen** (`lambdaMemoryMb`): meer geheugen = meer CPU = kortere duur; 1 GB
   is een goede middenweg. Pas aan op basis van het duur-alarm (P95 > 3 s).
4. **Bewaartermijnen**: versies en back-ups worden nooit automatisch verwijderd. De
   opslag groeit dus lineair; herzien zodra de wettelijke DPP-levensduur per productgroep
   bekend is. S3 Intelligent-Tiering verlaagt de opslagprijs van weinig gebruikte
   bestanden automatisch.
5. **Logs**: de app logt geen request-regels naar CloudWatch (alleen fouten en
   onderhoud); per-request-telemetrie staat geaggregeerd in de database.

## Afwegingen van de Lambda-opzet

- **Koude start**: na een rustige periode duurt het eerste verzoek ~1–3 s langer. Door de
  CloudFront-cache merken bezoekers van paspoorten dat zelden.
- **Maximale verzoekgrootte 6 MB** (Lambda): uploads gaan rechtstreeks naar S3 (presigned
  POST) en de import is maximaal 4 MB, dus dat past.
- **Databaseverbindingen**: elke gelijktijdige Lambda-omgeving houdt maximaal 2
  verbindingen. Bij veel verkeer `lambdaReservedConcurrency` zetten als bovengrens, of
  RDS Proxy toevoegen (~$11/maand voor t4g.small).
- **Telemetrie** wordt per omgeving na verzoeken weggeschreven; bij het opruimen van een
  omgeving kunnen de laatste minuten verloren gaan (alleen statistiek, geen
  paspoortdata of scans).

## Budgetten en waarschuwingen (in de infrastructuurcode)

- Maandbudget per omgeving (`monthlyBudgetUsd`) met e-mail bij 50/80/100% werkelijk en
  100% verwacht.
- Cost Anomaly Detection per AWS-dienst, dagelijkse e-mail bij een afwijking ≥ $20.
- **Geen harde limiet**: bij misbruik of een fout kunnen de kosten boven het budget
  uitkomen. WAF-rate-limits, de CloudFront-cache en (optioneel)
  `lambdaReservedConcurrency` beperken het risico, maar garanderen niets.

## Officiële prijspagina's

- Lambda: https://aws.amazon.com/lambda/pricing/
- RDS for PostgreSQL: https://aws.amazon.com/rds/postgresql/pricing/
- S3: https://aws.amazon.com/s3/pricing/
- CloudFront: https://aws.amazon.com/cloudfront/pricing/
- WAF: https://aws.amazon.com/waf/pricing/
- Secrets Manager: https://aws.amazon.com/secrets-manager/pricing/
- CloudWatch: https://aws.amazon.com/cloudwatch/pricing/
- AWS Backup: https://aws.amazon.com/backup/pricing/
- ECR: https://aws.amazon.com/ecr/pricing/
- Budgets / Cost Explorer: https://aws.amazon.com/aws-cost-management/pricing/
