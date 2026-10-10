# Compliance-matrix VeriPasso (DPP)

Bijgewerkt: 2026-10-10. Opgesteld door Claude (AI) op verzoek van de eigenaar. **Dit is
geen conformiteitsverklaring.** De certificeerder en een juridisch specialist
beoordelen toepasselijkheid en interpretatie. Een geslaagde build of test is geen
bewijs van wettelijke conformiteit of certificering.

## Bronnen en beperkingen

| Document | Editie | Status van beoordeling |
|---|---|---|
| Verordening (EU) 2024/1781 (ESPR) | 2024 | Openbare wetgeving; alleen op hoofdlijnen gebruikt. Concrete DPP-eisen volgen per productgroep uit gedelegeerde handelingen (nog niet beschikbaar voor de productgroepen van VeriPasso; door de eigenaar te bevestigen). |
| EVS-EN 18216:2026 (Data exchange protocols) | mei 2026 | **Gelezen** (zie licentienotitie). |
| EVS-EN 18221:2026 (Storage, archiving, persistence) | mei 2026, herzien 2 juni 2026 | **Gelezen** (zie licentienotitie). |
| EVS-EN 18219:2026 (Unique identifiers) | mei 2026 | **Niet gelezen**: licentie (zie onder). |
| EVS-EN 18220:2026 (Data carriers) | mei 2026 | **Niet gelezen**: licentie. |
| EVS-EN 18222:2026 (APIs lifecycle/searchability) | mei 2026 | **Niet gelezen**: licentie. |
| EVS-EN 18223:2026 (System interoperability) | mei 2026 | **Niet gelezen**: licentie. |
| EN 18239 / EN 18246 (toegang/beveiliging; authenticiteit/integriteit) | in voorbereiding (prEN 2025) | Niet beschikbaar; normatief verwezen door EN 18221. |
| EN 301 549:2021 (toegankelijkheid) | 2021 | Niet beschikbaar in de workspace; normatief verwezen door EN 18216 §5. |

**Licentienotitie.** De EVS-pdf's (licentie "Multi user licence for 2 users",
Certification Company B.V.) verbieden zonder voorafgaande schriftelijke toestemming
van EVS gebruik "in machine learning and artificial intelligence applications". De
opdracht van de eigenaar zegt hetzelfde: geen gelicentieerde documenten aan AI-tools
geven tenzij de licentie dat toestaat. Claude heeft EN 18216 en EN 18221 gelezen voordat
deze clausule werd opgemerkt; daarna is het lezen gestopt en zijn de tekstextracten
verwijderd. De rijen voor 18216/18221 hieronder zijn eigen, korte parafrases (geen
normtekst). **Besluit nodig van de eigenaar**: (a) deze rijen behouden of laten
herschrijven door een gelicentieerde gebruiker, en (b) de eisen uit 18219/18220/18222/
18223 laten extraheren door een gelicentieerde mens of schriftelijke toestemming van EVS
vragen.

## Legenda

- **Soort**: (a) wettelijke eis · (b) normatief binnen een toepasselijke norm ("shall") ·
  (c) eis van certificeerder/contract · (d) aanbeveling/informatief ("should"/bijlage).
  EN-normen geven pas een vermoeden van conformiteit na citatie in het Publicatieblad
  (Annex ZA); toepasselijkheid per productgroep is dus altijd een certificeerdersvraag.
- **Status**: NOT STARTED · IMPLEMENTED (gebouwd, niet (volledig) geverifieerd) ·
  VERIFIED (check uitgevoerd, resultaat vastgelegd) · BLOCKED (besluit/document nodig).
- Bewijs "test X" = `tests/<X>.test.js` (`npm test`), "infra" = `infra/test/stacks.test.js`.
  Testrun 2026-10-10 tegen een tijdelijke PostgreSQL 17 (PGlite): 148 geslaagd, 2 gefaald
  (zie R-ARCH-04), 3 overgeslagen (live-S3, opt-in). Infra: 11/11 geslaagd.

## EN 18216:2026 — gegevensuitwisseling

| ID | Clausule | Eis (eigen parafrase) | Soort | Implementatie | Verificatie / bewijs | Status | Sign-off |
|---|---|---|---|---|---|---|---|
| R-EXCH-01 | §4 | Gestandaardiseerde DPP-toegang via HTTPS; TLS 1.2 minimaal, oudere TLS/SSL niet toegestaan | (b) | CloudFront `TLSv1.2_2021`; ook CloudFront → interne ALB (VPC origin) TLS 1.2+ met eigen certificaat, dus versleuteld over de hele route; ALB TLS 1.2/1.3-policy, RDS `ssl_min_protocol_version`, S3 `s3:TlsVersion ≥ 1.2` | infra (CloudFront, ALB, S3, RDS) | VERIFIED (IaC); live-scan na uitrol open | ja |
| R-EXCH-02 | §4 | TLS 1.3 sterk aanbevolen | (d) | CloudFront- en ALB-policy's ondersteunen TLS 1.3 | infra (ALB `TLS13`) | VERIFIED (IaC) | nee |
| R-EXCH-03 | §4 | HTTP/2 minimaal, oudere versies niet gebruiken; HTTP/3 aanbevolen | (b) | CloudFront `http2and3`, ALB HTTP/2 | infra (CloudFront) | **BLOCKED**: CloudFront accepteert HTTP/1.1 van oude clients en kan dat niet uitschakelen. Interpretatie nodig | ja |
| R-EXCH-04 | §4 | API volgens REST-stijl (aanbevolen) | (d) | REST-API's (`/api/dpp`, `/api/products`) | test passport-compliance | VERIFIED | nee |
| R-EXCH-05 | §5 | JSON verplicht als uitwisselformaat | (b) | `GET /api/dpp/:id` (JSON) | test passport-compliance (R-EXCH-01..04) | VERIFIED | ja |
| R-EXCH-06 | §5 | XML optioneel via content negotiation | (b, optioneel) | `Accept: application/xml` of `?format=xml` | idem | VERIFIED | nee |
| R-EXCH-07 | §5 | JSON-LD optioneel; moet met een gewone JSON-parser leesbaar zijn | (b, optioneel) | `application/ld+json` met `@context` (schema.org + eigen vocabulaire) | idem (JSON.parse + gelijke velden) | VERIFIED | ja (semantiek, zie R-INT-01) |
| R-EXCH-08 | §5 | Inhoud via content negotiation als W3C-HTML; testen in meerdere browsers (aanbevolen) | (b)/(d) | `/p/:id` HTML; dezelfde URL levert JSON/JSON-LD/XML (rewrite, `Vary: Accept`); `/api/dpp` stuurt browsers door (303) | negotiation getest (API); rewrite op `/p/:id` en cross-browser **niet** geautomatiseerd getest | IMPLEMENTED | ja |
| R-EXCH-09 | §5 | Menselijk leesbare weergave voldoet aan EN 301 549 (toegankelijkheid) | (b) | semantische HTML, `lang`, alt-teksten, contrast (bestaand ontwerp) | geen audit uitgevoerd; EN 301 549 niet beschikbaar | **BLOCKED** (audit WCAG 2.1 AA nodig) | ja |
| R-EXCH-10 | bijl. C | Rate limiting, DDoS-bescherming, statuscodes 401/403 | (d) | WAF (managed rules + rate-based), app-limiter publieke API, bestaande 401/403/404 | test platform-ops (429), infra (WAF) | VERIFIED | nee |
| R-EXCH-11 | bijl. B | Invoervalidatie | (d) | Zod op alle schrijf-endpoints, body-limieten | test platform-ops + bestaande tests | VERIFIED | nee |

## EN 18221:2026 — opslag, archivering, persistentie

| ID | Clausule | Eis (eigen parafrase) | Soort | Implementatie | Verificatie / bewijs | Status | Sign-off |
|---|---|---|---|---|---|---|---|
| R-STOR-01 | §4.1 | Opslag door de verantwoordelijke actor of een DPP-dienstverlener namens hem | (b)/(c) | VeriPasso als dienstverlener namens klantbedrijven | contractueel | **BLOCKED** (rol en contract bevestigen) | ja |
| R-STOR-02 | §4.1 | Opgeslagen gegevens juist, volledig en actueel | (b) | actuele DPP wordt live uit de database opgebouwd; elke wijziging direct zichtbaar | test passport-compliance (R-ARCH-05: actuele stand) | VERIFIED (technisch); juistheid van de inhoud is verantwoordelijkheid van de klant | ja |
| R-STOR-03 | §4.1 | Online toegankelijk via EN 18216-protocollen gedurende de DPP-levensduur | (b) | publieke endpoints; persistentie-guards (R-PERS-*); Multi-AZ, ≥ 2 taken, back-ups | tests passport-compliance; infra | IMPLEMENTED; **levensduur onbekend** → BLOCKED | ja |
| R-STOR-04 | §4.1 | DPP's mogen naar andere DPP's verwijzen; elk paspoort wordt zelfstandig opgeslagen | (b)/(d) | zelfstandige opslag per productmodel; verwijzingen naar andere DPP's (bijv. onderdelen) nog niet als veld | — | IMPLEMENTED (zelfstandig); verwijzingen NOT STARTED (optioneel) | nee |
| R-STOR-05 | §4.1 | Opslag zo dat menselijk en machineleesbare formaten gegenereerd kunnen worden | (b) | één snapshotmodel (`passport.service.js`) → HTML-pagina, JSON, JSON-LD, XML | test passport-compliance | VERIFIED | nee |
| R-STOR-06 | §4.1 | Beschikbaarheid, integriteit, authenticiteit; bescherming tegen verlies, kwaadwillige wijziging en ongeautoriseerde toegang (EN 18239/18246) | (b) | RDS versleuteld + Multi-AZ + PITR + maandarchief 10 jaar; S3-versioning + replicatie; IAM least privilege; tenant-isolatie; hash-keten; WAF; MFA | infra; tests tenant-isolation, s3-storage, mfa, passport-compliance | IMPLEMENTED; **EN 18239/18246 nog niet gepubliceerd** → BLOCKED voor volledige conformiteit | ja |
| R-STOR-07 | §4.1 | Formaten en semantisch model volgens EN 18223 | (b) | eigen JSON-model + JSON-LD-context | — | **BLOCKED** (EN 18223 niet gelezen) | ja |
| R-STOR-08 | §4.1 | Opslag ondersteunt EN 18220 en EN 18222 | (b) | — | — | **BLOCKED** (normen niet gelezen) | ja |
| R-ARCH-01 | §4.2 | Archivering start bij de eerste wijziging van het initiële DPP | (b) | versie 1 bij publicatie, daarna een versie per wijziging; concepten niet | test passport-compliance R-ARCH-01 | VERIFIED | nee |
| R-ARCH-02 | §4.2 | Alle wijzigingen worden gearchiveerd (behalve expliciet uitgezonderde, bijv. realtime sensordata) | (b) | archief-middleware op alle productmutaties (product, foto, documenten, duurzaamheid, compliance, onderdelen, batches, publiceren, archiveren), bulkacties en import; backfill + alarm bij fouten | test passport-compliance R-ARCH-02/R-PERS-03 (PATCH, duurzaamheid, archiveren). Bulk/import/documenten niet apart getest | IMPLEMENTED (gedeeltelijk geverifieerd) | nee |
| R-ARCH-03 | §4.2 | Gearchiveerde versies opgeslagen door de maker/hoofddienstverlener **en** de back-up-dienstverlener | (b) | hoofddienstverlener: ja; export voor back-up-dienstverlener: ja | test R-REPL-01 | **BLOCKED** (back-up-dienstverlener ontbreekt) | ja |
| R-ARCH-04 | §4.2 | Alle gearchiveerde versies blijven bewaard gedurende de levensduur | (b) | append-only-trigger (UPDATE/DELETE/TRUNCATE geweigerd); geen verwijderpaden; back-ups | in-process PGlite: alle drie geweigerd (scratchpad-check 2026-10-10); via socket: UPDATE/TRUNCATE geweigerd, **DELETE-test faalt op een PGlite-socketfout** (ECONNRESET, geen app-fout). Herhalen in CI op PostgreSQL 17 | IMPLEMENTED (verificatie op echte PostgreSQL open); levensduur BLOCKED | ja |
| R-ARCH-05 | §4.2 | Gearchiveerde attributen hebben dezelfde toegangsbeperkingen als de actuele | (b) | publieke versies alleen openbare velden; volledige versies alleen voor het eigen bedrijf | test passport-compliance R-SEC-01, R-ARCH-06 | VERIFIED | nee |
| R-ARCH-06 | §4.2 | Versie op een bepaald tijdstip opvraagbaar door geauthenticeerde, geautoriseerde actoren | (b) | `?at=`, `/versions/:n` (publiek, openbare velden) en `/api/products/:id/versions` (tenant) | test R-ARCH-05/06 | VERIFIED | ja (is publieke versietoegang gewenst?) |
| R-ARCH-07 | §4.2 | Integriteit en originaliteit van gearchiveerde versies (EN 18246) | (b) | SHA-256 per versie + hash-keten + verificatie-endpoint + append-only | test R-ARCH-03 | VERIFIED (hash-keten); **digitale handtekeningen/EN 18246** → BLOCKED | ja |
| R-ARCH-08 | §4.2 | OAIS (ISO 14721) volgen (aanbevolen) | (d) | fixity (hashes), herkomst (reden, gebruiker, tijd) aanwezig; geen formeel OAIS-model | — | NOT STARTED (formeel) | nee |
| R-PERS-01 | §4.3 | Back-upkopie (actueel + vereiste historie) bij een back-up-dienstverlener, waar vereist | (b)/(a) | NDJSON-export met alle versies | test R-REPL-01 | **BLOCKED** (partij/contract) | ja |
| R-PERS-02 | §4.3 | Back-up met dezelfde toegangsbeperkingen | (b) | export bevat `isPublic`-vlaggen per document | — | BLOCKED (contractueel) | ja |
| R-PERS-03 | §4.3 | Algemene toegang via de back-up-dienstverlener zodra de marktdeelnemer niet meer actief is | (b)/(a) | — | — | BLOCKED (organisatorisch) | ja |
| R-PERS-04 | §4.3 (eigen invulling) | Paspoorten blijven beschikbaar als een klant inactief wordt (licentie, blokkade) | (c) | publieke routes kijken niet naar bedrijfsstatus; gepubliceerd → nooit terug naar concept; gearchiveerd blijft publiek | test passport-compliance R-PERS-02/03/04 | VERIFIED | ja |
| R-DOC-01 | §4.4 | Aanvullende documentatie direct of via verwijzing in het DPP en via het DPP toegankelijk | (b) | openbare documenten in paspoort en DPP-JSON | tests product-documents (zonder live S3), passport-compliance | VERIFIED (metadata/links); download via S3 alleen met live-test | nee |
| R-DOC-02 | §4.4 | Downloadbaar en op te slaan; online toegankelijk gedurende de levensduur | (b) | presigned downloads; objecten nooit overschreven of door de app verwijderd; documenten van oude versies via versieroute | test s3-storage (ondertekening), live download niet getest | IMPLEMENTED | nee |
| R-DOC-03 | §4.4 | Back-up-dienstverlener bewaart verplichte documentatie | (b) | S3-replicatie naar DR-regio is eigen DR, géén back-up-dienstverlener | — | BLOCKED | ja |
| R-REPL-01 | §4.5 | Replicatie van het DPP en alle wijzigingen naar de back-up-dienstverlener | (b) | NDJSON-export (pull); geen automatische push | test passport-compliance R-REPL-01 | IMPLEMENTED (mechanisme); BLOCKED (partij, automatisering) | ja |
| R-REPL-02 | §4.5 | Frequentie die dataverlies minimaliseert (RPO) | (b) | eigen RPO: RDS-PITR ~5 min, S3-replicatie minuten; RPO naar back-up-dienstverlener niet vastgesteld | — | BLOCKED | ja |
| R-REPL-03 | §4.5 | Via EN 18222-lifecycle-API of een overeengekomen veilig mechanisme | (b) | geauthenticeerde HTTPS-export (eigen mechanisme) | — | BLOCKED (EN 18222 niet gelezen / afspraak nodig) | ja |
| R-REPL-04 | §4.5 | Replicatie over een EN 18216-protocol | (b) | HTTPS, TLS ≥ 1.2 | infra | VERIFIED (IaC) | nee |

## Niet-gelezen normen (alleen wat in de code staat, zonder clausuleclaim)

| ID | Norm | Huidige situatie | Status |
|---|---|---|---|
| R-ID-01 | EN 18219 | Permanente, globaal unieke id per productmodel (UUID v4, uniek in de database, nooit hergebruikt of gewijzigd), resolveerbaar via `https://qr.veripasso.com/p/{ID}`; ook `urn:uuid` en GTIN in de DPP-JSON. Onbekend of ISO/IEC 15459 of GS1 Digital Link vereist is | BLOCKED |
| R-CAR-01 | EN 18220 | QR-codes (PNG/SVG/PDF), leesbaarheidscontrole in printprofielen, URL met de hoofdletter-GUID zoals gedrukt | BLOCKED |
| R-API-01 | EN 18222 | Eigen REST-API voor aanmaken/lezen/wijzigen/archiveren, versies en export; zoeken alleen voor ingelogde gebruikers | BLOCKED |
| R-INT-01 | EN 18223 | JSON-LD met schema.org + eigen vocabulaire (`/vocab/dpp#`, nog niet gepubliceerd) | BLOCKED |

## Wetgeving en overige

| ID | Bron | Eis (kort) | Soort | Implementatie / bewijs | Status |
|---|---|---|---|---|---|
| R-LEG-01 | ESPR art. 9 (algemeen) | DPP via een gegevensdrager verbonden met een permanente unieke identificatie | (a) | model-QR → `public_id`; item-niveau per productgroep te bepalen (assessment §4) | BLOCKED (productgroep) |
| R-LEG-02 | ESPR (toegang) | Gratis, eenvoudige toegang zonder account voor wie toegang heeft | (a) | publieke pagina en DPP-API zonder login; bestaande en nieuwe tests | VERIFIED |
| R-LEG-03 | ESPR art. 13 (registry) | Unieke identificaties registreren in het EU-DPP-register | (a) | niet gebouwd; register/specificatie nog niet beschikbaar | BLOCKED |
| R-LEG-04 | ESPR art. 10/11 (via Annex ZA 18221) | Beschikbaarheid na beëindiging, back-upkopie | (a) | zie R-PERS-* | BLOCKED |
| R-LEG-05 | AVG | Geen persoonsgegevens in publieke DPP, URL's of logs; minimale scandata | (a) | geen IP bij scans, logger-redactie, whitelist publieke velden; tests platform-ops, passport-compliance R-SEC-01 | VERIFIED |
| R-SEC-02 | beveiliging (c/d) | MFA voor beheerders | (c) | TOTP, versleuteld, replaybescherming, reset; test mfa | VERIFIED (optioneel; verplichtstelling is een besluit) |
| R-SEC-03 | beveiliging | Audittrail voor gevoelige acties | (c) | auditlog incl. MFA, export, publicatie | IMPLEMENTED |

## Telling (applicabele rijen, exclusief zuiver informatieve)

| Status | Aantal |
|---|---|
| VERIFIED | 19 |
| IMPLEMENTED (nog niet (volledig) geverifieerd) | 4 (R-EXCH-08, R-ARCH-02, R-DOC-02, R-SEC-03) |
| BLOCKED | 24 |
| NOT STARTED | 2 (R-STOR-04 verwijzingen, R-ARCH-08 OAIS; beide optioneel/aanbeveling) |
| **Totaal** | **49** |

Rijen met een gemengde status zijn geteld naar hun zwaarste status.

## Vragen voor de certificeerder / jurist

1. Welke productgroepen en gedelegeerde handelingen zijn van toepassing, en is een
   **model-paspoort** voldoende of is een **item-paspoort** (serienummer) vereist?
2. Mag de EVS-licentie worden uitgebreid, of levert de certificeerder een eigen
   eisenextract van EN 18219/18220/18222/18223 aan?
3. Wie is de **back-up-DPP-dienstverlener**, welk mechanisme en welke RPO
   (EN 18221 §4.3–4.5)?
4. Wat is de **DPP-levensduur** per productgroep (bewaartermijnen)?
5. Is HTTP/1.1-acceptatie door CloudFront voor oude clients aanvaardbaar onder EN 18216 §4?
6. Moeten archiefversies **digitaal ondertekend** worden (in afwachting van EN 18246),
   of volstaat de SHA-256-hash-keten voorlopig?
7. Mag de versiegeschiedenis (alleen openbare velden) **publiek** opvraagbaar zijn, of
   alleen voor geauthenticeerde partijen?
8. Welke **identificatieschema's** (ISO/IEC 15459, GS1 Digital Link) en eisen aan de
   **gegevensdrager** (QR-grootte, foutcorrectie, leesbare tekst) gelden?
9. Toegankelijkheidsaudit (EN 301 549): wie voert die uit en tegen welke editie?
10. Moet VeriPasso zelf identificaties registreren in het **EU-register** (ESPR art. 13)?
