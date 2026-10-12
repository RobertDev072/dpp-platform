# Beveiligingschecklist VeriPasso op AWS

Legenda: ✅ geregeld en getest · 🟡 geregeld, nog niet live geverifieerd ·
⬜ open (actie nodig) · ➖ bewust niet (met reden)

## Identiteit en toegang

| Punt | Status | Waar / hoe |
|---|---|---|
| Tenant-isolatie op elk API-pad (404 bij andermans data) | ✅ | `src/utils/tenant.js`; tests `tenant-isolation`, `license-tenant-isolation`, `s3-storage`, `passport-compliance`, `mfa` |
| Rollen server-side afgedwongen, niet alleen in de UI | ✅ | `requireRole` per router; bestaande tests |
| Wachtwoorden bcrypt, sessietoken alleen als hash | ✅ | `src/utils/password.js`, `src/middleware/auth.js` |
| Brute-force: rate limit op login, MFA en resets; vaste vloer op mislukte logins | ✅ | `src/middleware/rateLimit.js`, `auth.routes.js` |
| MFA (TOTP) voor beheerders | ✅ (optioneel) / ⬜ beleid | `src/services/mfa.service.js`, test `mfa`. **Actie**: Platform Owner direct na go-live koppelen; besluit of MFA verplicht wordt voor beheerdersrollen |
| MFA-geheimen versleuteld (AES-256-GCM), sleutel in Secrets Manager | ✅ | `MFA_ENCRYPTION_KEY` (infra: `MfaKeySecret`) |
| Tijdelijk wachtwoord omzeilt MFA niet | ✅ | test `mfa` |
| Entra-overgangslogin verwijderd | ✅ | accounts zonder wachtwoord: runbook §5.3 |
| AWS: geen IAM-users met vaste sleutels; SSO met MFA | ⬜ | runbook §2 [MENS] |
| CI/CD via GitHub OIDC, rol beperkt tot repo + environment | 🟡 | `infra/lib/ci-stack.js`, `.github/workflows/deploy-aws.yml` |
| App-rol least privilege (2 buckets, geen delete buiten `products/*`, geen andere AWS-rechten) | ✅ | `infra/lib/app-stack.js`; infra-test "IAM" |

## Gegevens en opslag

| Punt | Status | Waar / hoe |
|---|---|---|
| S3: Block Public Access, encryptie, alleen TLS ≥ 1.2, versioning, RETAIN | ✅ (IaC) | infra-test "S3" |
| Uploads: presigned POST met vaste sleutel, type en max. grootte; server controleert opnieuw | ✅ | `blobStorage.service.js`; test `s3-storage` |
| Downloads: autorisatie vóór ondertekenen, 5 minuten geldig, SVG nooit inline | ✅ | idem |
| Geen persoonsgegevens in objectsleutels of publieke URL's | ✅ | sleutels `products/{id}/{uuid}.{ext}`; QR bevat alleen een UUID |
| RDS: versleuteld, niet publiek, `rds.force_ssl=1`, TLS ≥ 1.2, deletion protection | ✅ (IaC) | infra-test "RDS" |
| App ↔ RDS: TLS met certificaatcontrole (RDS-CA in het image) | 🟡 | `src/config/db.js`, `Dockerfile` |
| Geheimen (DB-wachtwoord, `COOKIE_SECRET`, MFA-sleutel, origin-geheim) nooit in code of template | ✅ (IaC) / 🟡 | CloudFormation-verwijzing naar Secrets Manager → Lambda-omgevingsvariabelen (infra-test "Geheimen"). **Afweging:** zichtbaar voor wie `lambda:GetFunctionConfiguration` heeft; dat recht alleen aan beheerders geven. Bewust gekozen boven een Secrets Manager-endpoint in de VPC (~$15/maand). Automatische DB-rotatie staat uit; na handmatig roteren opnieuw uitrollen |
| Applicatierol met minimale rechten i.p.v. de RDS-beheerder | ⬜ | Nu gebruikt de app `veripasso_admin`. Aanbevolen na go-live: rol `veripasso_app` (SELECT/INSERT/UPDATE/DELETE op `dbo`, geen DDL, geen eigenaar van `passportversions`), migraties met de beheerder. Let op: de bestaande tabellen hebben RLS aan zonder policies (Supabase-erfenis); voor een niet-eigenaar-rol eerst `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` of policies toevoegen |
| Paspoortversies append-only (trigger) + hash-keten + verificatie | ✅ | migratie `20261010000000`; test `passport-compliance`. Beperking: de tabeleigenaar kan triggers uitzetten; daarom de aparte app-rol hierboven |
| Back-ups, PITR, maandelijks archief, DR-kopie | ✅ (IaC) / ⬜ restore-test | runbook §8 |
| Geen automatische verwijdering van compliance-data | ✅ | geen lifecycle-expiratie (infra-test), documentverwijdering laat het object staan |

## Netwerk en transport

| Punt | Status | Waar / hoe |
|---|---|---|
| CloudFront: TLS ≥ 1.2 (`TLSv1.2_2021`), HTTP/2 + HTTP/3, HTTPS afgedwongen | ✅ (IaC) / 🟡 live | infra-test "CloudFront"; runbook §6 (testssl) |
| HTTP/1.1 voor oude clients | ⬜ | CloudFront kan dit niet uitzetten; interpretatie EN 18216 §4 door certificeerder |
| App (Lambda Function URL) alleen via CloudFront: geheime header `X-Origin-Verify`, anders 403 (`proxy.js`); verbinding CloudFront → Function URL TLS ≥ 1.2 | ✅ (IaC + code) | infra-test "App op Lambda"; test `cost-optimization` |
| App in geïsoleerde subnets (geen internetroute); database alleen vanaf de app | ✅ (IaC) | infra-test "Netwerk" |
| Interne taken (`/api/internal/events`: migraties, onderhoud, seed) alleen via directe Lambda-aanroep met IAM-recht; via internet 404 (router + app) | ✅ | infra-test "Domeinverdeling"; test `cost-optimization` |
| Productfoto's via CloudFront Origin Access Control; bucket blijft privé; objectnamen met willekeurige UUID | ✅ (IaC) | infra-test "Caching" |
| WAF: AWS managed rules + rate limits (paspoort, publieke API, DPP-API, login) | ✅ (IaC) | `infra/lib/edge-stack.js` |
| App-rate-limit op publieke API per IP (loopback uitgezonderd) | ✅ | test `platform-ops` |
| Echt bezoekers-IP (rate limiting, audit) uit `CloudFront-Viewer-Address`, niet uit een door de bezoeker te vervalsen header | ✅ | `CLIENT_IP_FROM_CLOUDFRONT` in `src/app.js` |
| Securityheaders (HSTS, nosniff, frame DENY, referrer-policy) | ✅ | `next.config.mjs` + CloudFront response-headers-policy |
| Content-Security-Policy | ⬜ | nog niet ingesteld (Next.js inline scripts vergen nonces); aanbevolen vervolgstap |

## Applicatie

| Punt | Status | Waar / hoe |
|---|---|---|
| Invoervalidatie (Zod) op alle schrijf-endpoints | ✅ | `src/schemas/*` |
| Body-limieten (1 MB JSON, 4 MB import, uploads via S3) | ✅ | `src/app.js`; test `platform-ops` |
| Veilige foutmeldingen (geen stacktraces naar de client) | ✅ | `errorHandler.js`; test `platform-ops` |
| Gestructureerde logs zonder wachtwoorden, tokens, cookies, presigned URL's | ✅ | `src/utils/logger.js`; test `platform-ops` |
| Auditlog voor gevoelige acties (login, resets, impersonatie, MFA, export, publicatie) | ✅ | `src/utils/auditLog.js` |
| CSRF | ✅ (bestaand) | sessiecookie `SameSite`, JSON-API; formulierloze POST's van andere sites worden niet geaccepteerd |
| Dependency-scan | 🟡 | `npm audit` in CI (hoog/kritiek), ECR scan-on-push |
| Geheimen-scan van de repository | ✅ | eindverificatie (zie eindrapport); `.env*` in `.gitignore` |

## Operatie en privacy

| Punt | Status | Waar / hoe |
|---|---|---|
| Health (liveness) en readiness | ✅ | `/api/health`, `/api/health/ready`; test `platform-ops` |
| Nette afsluiting bij SIGTERM (telemetrie wegschrijven, pool sluiten) | 🟡 | `instrumentation-node.js`; op Lambda via de Web Adapter-extensie |
| Alarmen: Lambda-fouten/throttling/duur, DB-CPU/opslag/verbindingen, archieffouten, onverwachte fouten | ✅ (IaC) | SNS-e-mail; bevestigingsmail accepteren [MENS] |
| Budget + kostenanomalie | ✅ (IaC) | geen harde limiet |
| AVG: geen IP-adressen in scans, geen persoonsgegevens in publieke DPP of logs | ✅ | `scanevents` (UA + referrer), logger-redactie |
| AVG: inzage/export en verwijdering van gebruikersgegevens | 🟡 | soft delete bestaat; formeel verwerkingsregister en bewaartermijnen ⬜ |
| Verwerkersovereenkomst met AWS (DPA) en klanten | ⬜ | [MENS] |
