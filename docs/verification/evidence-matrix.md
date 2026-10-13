# Bewijsmatrix VeriPasso: functies, tests en resultaten

Stand: 2026-10-12. Doel: per functie aantoonbaar maken wat **gebouwd**, **getest** en
**live gecontroleerd** is, en wat nog handmatig of door een derde moet worden
bevestigd. Dit document vervangt geen certificering; de compliance-eisen staan in
[`docs/compliance/requirements-matrix.md`](../compliance/requirements-matrix.md).

## Bewijsbronnen

| Bron | Inhoud | Resultaat |
|---|---|---|
| [`testrun-2026-10-12.txt`](testrun-2026-10-12.txt) | volledige automatische testsuite (`npm test`) tegen een echte PostgreSQL 17 | **163 tests: 160 geslaagd, 0 gefaald, 3 overgeslagen** (live-S3, alleen met opt-in) |
| `infra-tests-2026-10-12.txt` (verwijderd met de AWS-code; zie git-tag `aws-laatste-versie`) | controles op de gegenereerde AWS-infrastructuur | 12 tests: 11 geslaagd, 0 gefaald, 1 overgeslagen (back-upplan staat bewust uit) |
| [`live-check-2026-10-12.txt`](live-check-2026-10-12.txt) | alleen-lezen controle van de productieomgeving (domeinen, TLS, headers, toegang) | alles zoals verwacht |
| Importrun met de testbestanden van de eigenaar | `veripasso_testproducten_50.csv` en `…_importfix.csv` door de echte importflow | zie §2.6 |
| GitHub Actions "CI" | dezelfde suite op PostgreSQL 17 + build + Docker-build bij elke push | groen op `main` |

**Legenda status**

- ✅ **Bewezen**: automatische test of live controle, met resultaat vastgelegd.
- 🟡 **Deels**: kern bewezen, een onderdeel nog niet.
- 👤 **Handmatig**: niet te automatiseren (telefoon, printer, beeld); checklist in §3.
- ⛔ **Niet gebouwd**: bewust niet of nog niet aanwezig.

---

## 1. Overzicht per onderdeel

| Onderdeel | Status | Bewijs (test-ID → bestand) | Nog te doen |
|---|---|---|---|
| QR genereren en koppelen | ✅ | QR-01, QR-02 → `evidence-qr-saas`; `qr-continuity`; R-ID-01 → `passport-compliance` | 👤 scannen met echte telefoons (§3) |
| QR blijft geldig na productwijzigingen | ✅ | QR-03 (6 soorten wijzigingen + archiveren); R-PERS-02/03/04; `ux-workflows` "QR: gereserveerd → …" | — |
| Publieke productpagina | 🟡 | data en toegang: PUB-01, R-SEC-01, R-EXCH-01..04, DOC-01; live: 404 bij onbekende code | 👤 mobiele weergave en browsers; toegankelijkheidsaudit (EN 301 549) |
| QR downloaden en afdrukken | 🟡 | QR-01 (PNG 512/1200 px en SVG teruggelezen, PDF-label geldig); `ux-workflows` print-tests (labels-PDF 1/10/500, vector-QR, ZIP) | 👤 echte printeruitvoer en scannen van het geprinte label |
| QR in bulk genereren | ✅ | BULK-01: 1.000 producten → 1.000 unieke QR's, 1 SVG-ZIP met 1.000 bestanden, steekproef van 25 teruggelezen; PNG-ZIP begrensd op 500 | — |
| Excel/CSV-import | 🟡 | `ux-workflows`: 10 rijen + duplicaten, 251 rijen hervatten, 1.000+ rijen xlsx/xls + productlimiet; importrun eigen bestanden (§2.6) | **bevinding**: waarde "deels" bij Recyclebaar wordt geweigerd (34 van 50 rijen) |
| Bedrijfsisolatie | ✅ | `tenant-isolation`, `license-tenant-isolation`, ISO-01 (QR, labels, versies, documenten, bulk, ZIP, export), S3-upload (`s3-storage`), R-ARCH-06, DOC-01 | — |
| Productdocumenten | 🟡 | DOC-01 (openbaar/privé, direct van paspoort af bij privé zetten, ander bedrijf 404); S3-presign 5 min en SVG nooit inline (`s3-storage`); validatie (`product-documents`) | 👤 echte upload en download op productie (S3) |
| Scanstatistieken | 🟡 | SCAN-01 (ophalen telt niet, 5 weergaven via de beacon = 5 scans, machineleesbaar telt mee, per bedrijf gescheiden, concepten tellen niet); `ux-workflows` QR-statistieken | **besluit**: dubbele scans (zelfde bezoeker/refresh) worden nu allemaal geteld |
| Accounts en rollen | ✅ | `auth`, `password-change`, `mfa`, `impersonation`, `partner-layer`, `partner-password-reset`, `user-delete`, ACC-01 (uitnodiging → activeren → inloggen, link eenmalig) | ⛔ zelfregistratie bestaat bewust niet |
| Abonnementen en betalingen | 🟡 / ⛔ | abonnementen, limieten en verlopen licenties: `license-limit`, `license-tenant-isolation`, `ux-workflows` (productlimiet bij import) | ⛔ **online betalen/facturatie is niet gebouwd** |
| Printinstellingen | ⛔ verwijderd | op verzoek verwijderd (2026-10-14); QR-download PNG/SVG/ZIP blijft (`ux-workflows`) | — |
| Versie-archief en DPP-compliance | ✅ | R-ARCH-01..06, R-EXCH, R-PERS, R-REPL → `passport-compliance` | zie compliance-matrix (certificeerder) |
| Beveiliging en platform | ✅ | `platform-ops` (logging, health, 4xx, rate limit), `system-monitoring`; live: TLS 1.1 geweigerd, headers aanwezig, beheer-API zonder login 401 | — |
| Infrastructuur (vroegere AWS-opzet, verwijderd op 2026-10-13) | ✅ | infra-tests (S3 privé + Intelligent-Tiering, RDS versleuteld/niet publiek, TLS, app op Lambda alleen via CloudFront, geheimen via Secrets Manager, caching, IAM, WAF, budget, domeinrouter); `cost-optimization` (WebP-miniatuur, cachebaar logo, foto via CDN-pad, interne taken afgeschermd, origin-controle); live-check (vorige ECS-opzet) | restore-test en loadtest (runbook) |

---

## 2. Details per onderdeel

### 2.1 QR genereren, koppelen en scanbaarheid
- **Code:** `src/services/qrCode.service.js`, `src/routes/products.routes.js` (`/qr.png`, `/qr.svg`, `/qr`), `src/routes/qrExport.routes.js` (ZIP), `src/utils/baseUrl.js`.
- **Bewijs:** QR-01 leest de PNG (512 en 1200 px) en de SVG terug met een QR-decoder (`jsqr`, zoals een telefooncamera) en controleert dat de inhoud exact `{QR_BASE_URL}/p/{PUBLIC_ID}` is (GUID in hoofdletters, gelijk aan eerder gedrukte codes). QR-02 opent die URL en krijgt het paspoort. R-ID-01 controleert dat de identificatie uniek en permanent is.
- **Niet geautomatiseerd:** scannen met echte telefoons (iOS-camera, Android, verschillende afstanden en lichtomstandigheden).

### 2.2 QR blijft geldig na wijzigingen
QR-03 voert achter elkaar zes soorten wijzigingen uit:
1. naam, merk, SKU en GTIN;
2. beschrijving en categorie;
3. duurzaamheid;
4. compliance;
5. een document toevoegen;
6. archiveren.

Na **elke** stap is gecontroleerd dat `public_id` gelijk is, de QR-afbeelding exact dezelfde URL bevat en het publieke paspoort bereikbaar blijft met de actuele gegevens. R-PERS-02 bewijst dat een gepubliceerd paspoort niet terug kan naar concept; R-PERS-04 dat het online blijft als het bedrijf geblokkeerd wordt.

### 2.3 Publieke productpagina
- **Bewezen:** juiste data, alleen openbare velden (geen interne id's), alleen openbare documenten, 404 voor onbekende, kapotte of niet-gepubliceerde codes (ook live), machineleesbare versie via content negotiation.
- **Nog handmatig:** weergave op mobiel (iPhone, Android), in de gangbare browsers, en een toegankelijkheidsaudit (WCAG 2.1 AA / EN 301 549).

### 2.4 Downloaden, afdrukken en bulk
- PNG, SVG en het label-PDF zijn bewezen (QR-01, print-tests).
- Bulk: BULK-01 maakt 1.000 producten aan, genereert in één bulkactie 1.000 unieke QR-identiteiten, levert één SVG-ZIP met 1.000 bestanden, en leest een steekproef van 25 codes terug. Elke code verwijst naar een eigen product. Doorlooptijd lokaal ongeveer 1,1 s.
- Label-PDF's tot 500 per bestand en de grens bij 501 zijn getest (`ux-workflows`).
- **Nog handmatig:** printen op de beoogde printers en labelvellen, en het geprinte label scannen.

### 2.5 Bedrijfsisolatie
Bedrijf B krijgt **404** (bestaan wordt niet bevestigd) op product, QR-PNG/SVG/PDF, QR-reservering, versies en documenten van bedrijf A. Een bulkactie van B met A's id's raakt 0 producten. Een QR-ZIP met A's id's wordt geweigerd, en de export van B bevat A's paspoorten niet. Daarnaast bewijzen de bestaande suites isolatie van producten, gebruikers, licenties, partners en S3-uploads.

### 2.6 Excel/CSV-import (met de bestanden van de eigenaar)
| Bestand | Herkend | Resultaat |
|---|---|---|
| `veripasso_testproducten_50.csv` | 19 kolommen automatisch gekoppeld | 16 aangemaakt, **34 geweigerd**: "Recyclebaar: onbekende waarde 'deels'" |
| `…_importfix.csv` (daarna) | idem | 34 aangemaakt, 16 als duplicaat overgeslagen, 0 fouten |
| eerste bestand opnieuw, strategie "bijwerken" | idem | 16 bijgewerkt, 0 dubbel aangemaakt (totaal bleef 50) |

Steekproef van de opgeslagen gegevens (naam, SKU, GTIN, % gerecycled, CO₂, CE) klopt.

**Bevinding (open):** "deels" (gedeeltelijk recyclebaar) is een realistische waarde, maar het veld kent alleen ja/nee. Mogelijke oplossingen: een derde waarde "gedeeltelijk" in het datamodel, of bij import een waarschuwing in plaats van een fout (veld leeg laten). Dat is een productbeslissing.

### 2.7 Productdocumenten
- **Bewezen:** openbare documenten staan op het paspoort en zijn te downloaden; privédocumenten niet (publiek 404). Een document op privé zetten haalt het direct van het paspoort. Een ander bedrijf ziet de lijst niet. Uploadlinks verlopen na 5 minuten, met S3-afgedwongen type en grootte; downloadlinks na 5 minuten; SVG wordt nooit inline getoond.
- **Nog handmatig:** een echte upload en download op productie (foto en PDF), en controleren dat een gedeelde downloadlink na 5 minuten niet meer werkt.

### 2.8 Scanstatistieken
- **Bewezen:** elke opvraging telt precies één scan (ook de machineleesbare), per bedrijf gescheiden, concepten en onbekende codes tellen niet.
- Eerder is een fout verholpen waardoor één bezoek aan de paspoortpagina **twee** scans telde. Die oplossing zit in de paginacode en wordt niet door de API-tests gedekt; controleer het handmatig (§3).
- **Besluit nodig:** dubbele scans (zelfde bezoeker, herladen, bots) worden nu allemaal geteld. Wil je unieke scans, dan is een regel nodig (bijvoorbeeld 1 per apparaat per 30 minuten), met aandacht voor privacy: er wordt bewust geen IP-adres opgeslagen.

### 2.9 Accounts, rollen en beveiliging
Bewezen:
- inloggen en uitloggen;
- tijdelijke wachtwoorden en verplichte wijziging;
- MFA (koppelen, replay, herstelcodes, een reset omzeilt MFA niet);
- impersonatie met auditlog;
- partner-scoping;
- verwijderen en archiveren van gebruikers;
- uitnodiging → activeren → inloggen, waarbij de link eenmalig is (ACC-01).

**Bewust niet:** zelfregistratie (accounts ontstaan alleen via uitnodiging of beheerder) en e-mailverzending.

### 2.10 Abonnementen en betalingen
- **Bewezen:** plannen met maximum aantal gebruikers en producten per bedrijf; een verlopen licentie blokkeert aanmaken maar laat paspoorten online; de productlimiet wordt ook bij import gerespecteerd.
- **Niet gebouwd:** online betalen, facturen, automatische verlenging. Abonnementen worden nu handmatig door de Platform Owner of partner toegewezen. Is betalen bij lancering nodig, dan is dat een nieuw project (bijv. Mollie of Stripe).

### 2.11 Printinstellingen
**Verwijderd** (2026-10-14, op verzoek): printprofielen en label-PDF's. QR-codes blijven downloadbaar als PNG/SVG (los en als ZIP, tenant-gebonden; `ux-workflows`, ISO-01).

**Nog handmatig:** de preview in de browser en de afdruk op de echte printer.

---

## 3. Handmatige testchecklist (vóór lancering)

Vul per regel in: datum, wie, apparaat/browser, resultaat (OK/fout + schermafbeelding).

| # | Test | Verwacht |
|---|---|---|
| H1 | Product publiceren op app.veripasso.com, QR (PNG) downloaden, scannen met iPhone-camera én Android | paspoort opent op qr.veripasso.com |
| H2 | Label-PDF printen op de beoogde printer/labelvellen, het geprinte label scannen op 30 cm en 1 m | scant direct, label goed uitgelijnd |
| H3 | Bulk: 50+ producten selecteren → QR's genereren → PDF en ZIP downloaden → 5 willekeurige labels scannen | elke code opent het juiste product |
| H4 | Paspoortpagina op mobiel (iOS Safari, Android Chrome) en desktop (Chrome, Edge, Firefox, Safari) | leesbaar, geen horizontaal scrollen, foto en documenten werken |
| H5 | Foto en PDF uploaden op productie; publiek document downloaden vanaf een ander apparaat | upload lukt; download werkt; privédocument niet zichtbaar |
| H6 | Een gekopieerde downloadlink (S3) na 6 minuten opnieuw openen | geweigerd (verlopen) |
| H7 | Paspoortpagina één keer openen, daarna de scanteller in het dashboard bekijken | +1 (niet +2) |
| H8 | Import van een eigen Excel-bestand met fouten, het foutrapport downloaden, corrigeren en opnieuw importeren | duidelijke foutmeldingen, geen duplicaten |
| H9 | Uitnodiging versturen, link openen op een ander apparaat, wachtwoord kiezen, MFA instellen | inloggen werkt met MFA |
| H10 | Inloggen als bedrijf B en de URL van een product van bedrijf A plakken | "niet gevonden" |
| H11 | Toegankelijkheid paspoortpagina: axe/Lighthouse + schermlezer (VoiceOver/NVDA) | geen kritieke bevindingen (WCAG 2.1 AA) |
| H12 | Restore-test van de database (runbook §8) | herstel lukt binnen de afgesproken tijd |

## 4. Open bevindingen en besluiten

| # | Bevinding | Soort | Voorstel |
|---|---|---|---|
| B1 | Import weigert "deels" bij Recyclebaar | product/UX | waarde "gedeeltelijk" toevoegen of waarschuwing i.p.v. fout |
| B2 | Dubbele scans worden allemaal geteld | besluit | regel voor unieke scans vaststellen (privacyvriendelijk) |
| B3 | Online betalen/facturatie ontbreekt | scope | besluiten of dit bij lancering nodig is |
| B4 | Echte S3-upload/download niet automatisch getest | test | H5/H6 uitvoeren; eventueel live-test met `TEST_S3_LIVE` op een testbucket |
| B5 | Weergave paspoortpagina (mobiel, browsers, toegankelijkheid) niet geautomatiseerd | test | H4 + H11 |
| B6 | Compliance-punten die de certificeerder moet beoordelen | certificering | zie `docs/compliance/requirements-matrix.md` |

## 5. Opnieuw uitvoeren

```bash
# Testsuite (altijd tegen een TESTdatabase)
DATABASE_URL=postgres://... npm run migrate && npm test
# Alleen de bewijstests uit dit document
node --test tests/evidence-qr-saas.test.js
# Infrastructuur
cd infra && npm test
```
In GitHub draait dezelfde suite automatisch bij elke push (Actions → CI).
