# Wettelijke compliance-matrix VeriPasso

Stand: 2026-10-14. **Dit is geen juridisch advies.** De matrix toetst wat in de code en
de productieomgeving aantoonbaar is tegen de regels die vermoedelijk gelden. Waar een
oordeel van een jurist of een bedrijfsbesluit nodig is, staat dat er expliciet.

**Bronnen.** Officiële teksten (zie onderaan). De EVS-EN 18216–18223-normen in
`Desktop\Veripasso - Doc` zijn **niet** gelezen: de EVS-licentie verbiedt verwerking door
AI. De bestaande normmatrix (`requirements-matrix.md`) is daarom op metadata gebaseerd en
moet door een mens of certificeerder worden getoetst. In de documentatiemap stonden geen
andere documenten (geen privacyverklaring, verwerkersovereenkomst, bewaarbeleid of
klantcontract).

**Feiten over VeriPasso** (uit code en configuratie):
- B2B-SaaS voor digitale productpaspoorten; klanten zijn bedrijven, via partners.
- Persoonsgegevens: gebruikersaccounts (naam, e-mail, rol, wachtwoordhash, MFA-geheim
  versleuteld, sessies), auditlog (wie deed wat, wanneer), profielfoto (optioneel);
  van publieke bezoekers alleen scanmetadata (tijdstip, user-agent, verwijzer; geen IP).
- Productgegevens, foto's en documenten van klanten (meestal geen persoonsgegevens).
- Hosting: STRATO VPS (Duitsland/Nederland, Docker), Cloudflare (DNS, R2-opslag in de
  EU-jurisdictie, CDN/Worker wereldwijd voor `qr.veripasso.com`), GitHub (alleen code).
- Geen e-mail, geen betalingen, geen analytics van derden, geen cookies behalve de
  sessiecookie.

**Legenda.** Soort: **W** = wettelijk verplicht · **C** = contractueel · **B** = beveiligings-
advies / best practice · **J** = toepasselijkheid of invulling juridisch te beoordelen.
Status: ✅ aantoonbaar (getest) · 🔎 gecontroleerd in code, niet automatisch getest ·
🟡 gedeeltelijk · ❌ ontbreekt · 🧭 besluit of juridisch advies nodig.

## 1. AVG / GDPR (Verordening (EU) 2016/679) — W

| Onderdeel | Verplichting | Status | Bewijs | Ontbrekende actie | Prio |
|---|---|---|---|---|---|
| Rol VeriPasso | Verwerkingsverantwoordelijke of verwerker per verwerking vaststellen | 🧭 | — | Jurist: VeriPasso is waarschijnlijk **verwerker** voor klantdata en accounts van klantmedewerkers, en **verantwoordelijke** voor eigen platformbeheer en scanstatistiek. Vastleggen. | Hoog |
| Rechtsgrond (art. 6) | Per verwerking een grondslag | 🧭 | — | Bepalen en vastleggen (accounts: overeenkomst; scans: vermoedelijk gerechtvaardigd belang). Niet door de app te bepalen. | Hoog |
| Transparantie (art. 13/14) | Privacyverklaring | ❌ | geen pagina in de app | Concept: `docs/privacy-verklaring-concept.md` (feitelijke verwerkingen). Laten controleren, dan publiceren en linken op login- en paspoortpagina. | Hoog |
| Dataminimalisatie (art. 5) | Niet meer dan nodig | ✅ | geen IP bij scans; anonieme dagelijks wisselende hash; foto-originelen niet bewaard; `tests/scan-policy.test.js`, `docs/scans.md` | — | — |
| Opslagbeperking (art. 5) | Bewaartermijnen | 🟡 | scans: 90 dagen los, daarna totalen (besluit 2026-10-14, `scanRollup.service.js`, getest); back-ups: 7 dagen lokaal | **Besluit nodig** voor: verwijderde gebruikers (nu soft delete, blijft bewaard), auditlog (nu onbeperkt), back-ups in R2 (nu onbeperkt), sessies/uitnodigingen. Daarna technisch opruimen. | Hoog |
| Rechten betrokkenen (art. 15-21) | Inzage, correctie, verwijdering, export | 🟡 | profiel zelf aanpassen; soft delete (`tests/user-delete.test.js`) | Procedure voor inzage/verwijderverzoeken; echte verwijdering of anonimisering na de (nog te bepalen) termijn. | Midden |
| Beveiliging (art. 32) | Passende maatregelen | 🟡 | zie §6; TLS, MFA, rolcontrole, rate limits, versleutelde back-ups (getest) | CSP-header; DB-verbinding binnen de host is onversleuteld (intern netwerk); periodieke restore-test plannen. | Midden |
| Verwerkers (art. 28) | Verwerkersovereenkomsten met subverwerkers; met klanten | ❌ | — | DPA met STRATO en Cloudflare accepteren/archiveren; eigen verwerkersovereenkomst voor klanten (sjabloon). | Hoog |
| Doorgifte buiten EU (h. V) | Waarborgen | 🧭 | R2 met EU-jurisdictie; Cloudflare CDN/Worker verwerkt verzoeken wereldwijd | Jurist: Cloudflare (VS) als subverwerker beoordelen (EU-US Data Privacy Framework / SCC's). | Midden |
| Datalekken (art. 33/34) | Melden binnen 72 uur aan AP, registreren, betrokkenen informeren bij hoog risico; als verwerker: verantwoordelijke onverwijld informeren | 🟡 | procedure: `docs/noodplan.md` §Datalek | Contactpersoon en registratie (datalekregister) inrichten. | Hoog |
| Register (art. 30) | Verwerkingsregister | ❌ | — | Opstellen (vrijstelling <250 medewerkers geldt niet bij structurele verwerking; jurist laten bevestigen). | Midden |

## 2. Cookies en opslag op het apparaat (art. 11.7a Telecommunicatiewet; ePrivacy) — W

| Onderdeel | Verplichting | Status | Bewijs | Ontbrekende actie | Prio |
|---|---|---|---|---|---|
| Sessiecookie | Strikt noodzakelijk: geen toestemming nodig | ✅ | httpOnly, secure, SameSite=Lax (`src/middleware/auth.js`) | Vermelden in privacyverklaring. | Laag |
| Scantelling | Geen opslag op het apparaat zonder grondslag | ✅ | geen cookie/localStorage (localStorage verwijderd 2026-10-14); `tests/scan-policy.test.js` | — | — |
| Trackers derden | Toestemming vereist | ✅ n.v.t. | geen analytics/trackers in de code | Zo houden; bij toevoegen: toestemming. | — |

## 3. Digitale productpaspoorten — W voor de **klanten**, J voor VeriPasso

| Onderdeel | Verplichting | Status | Bewijs | Ontbrekende actie | Prio |
|---|---|---|---|---|---|
| ESPR (Verordening (EU) 2024/1781) | DPP-plicht per productgroep via gedelegeerde handelingen; werkplan 2025-2030 (o.a. staal, textiel, banden, aluminium, meubels, matrassen) | 🧭 | — | Per klant/productgroep vaststellen welke gedelegeerde handeling geldt en wanneer; inhoudelijke eisen volgen pas uit die handelingen. VeriPasso is dienstverlener; de plicht ligt bij de marktdeelnemer. | Hoog |
| Batterijverordening (EU) 2023/1542 | Batterijpaspoort voor o.a. EV-, LMT- en industriële batterijen (vanaf 2027, datum te verifiëren) | 🧭 | — | Alleen relevant als klanten batterijen leveren; dan eisen uit de verordening en uitvoeringshandelingen toetsen. | Midden |
| Unieke, permanente identificatie | Paspoort blijft bereikbaar | ✅ | UUID per product, unieke index, nooit hergebruikt; gearchiveerd blijft bereikbaar (`tests/qr-continuity.test.js`, ISO/QR-tests) | — | — |
| Beschikbaarheid bij storing | Paspoort ook bij uitval | ✅ | noodkopie in R2 via Cloudflare Worker; live getest 2026-10-13 (app gestopt, paspoort bleef bereikbaar) | Bewaartermijn van paspoorten na einde contract/faillissement (back-up-dienstverlener) — besluit. | Midden |
| Versiebeheer en archief | Wijzigingen herleidbaar | ✅ | append-only versies met hashketen (`tests/passport-compliance.test.js`) | — | — |
| Normen EN 18216-18223 | Gegevensuitwisseling, identificatie, gegevensdragers, opslag, API, interoperabiliteit | 🧭 | `requirements-matrix.md` (zonder normtekst opgesteld) | Toetsing door mens/certificeerder met de normtekst. | Hoog |

## 4. Cybersecurity: NIS2 / Cyberbeveiligingswet — J

| Onderdeel | Verplichting | Status | Bewijs | Ontbrekende actie | Prio |
|---|---|---|---|---|---|
| Toepasselijkheid | Cbw (NL-implementatie NIS2, Stb. 2026, 187; inwerkingtreding volgens bronnen 15-08-2026) geldt voor middelgrote en grote entiteiten in de genoemde sectoren, kleine alleen in uitzonderingsgevallen | 🧭 | — | Jurist: VeriPasso is vermoedelijk klein (<50 fte, <€10 mln) en dan niet automatisch in scope; bevestigen. Klanten kunnen contractueel NIS2-eisen doorleggen (C). | Midden |
| Basismaatregelen | (B, ongeacht NIS2) | 🟡 | MFA, rolcontrole, rate limiting, back-ups, monitoring, noodplan | Formeel incidentresponsplan en leveranciersbeoordeling vastleggen. | Midden |

## 5. Toegankelijkheid — J / B

| Onderdeel | Verplichting | Status | Bewijs | Ontbrekende actie | Prio |
|---|---|---|---|---|---|
| European Accessibility Act (Richtlijn 2019/882; NL sinds 28-06-2025) | Geldt voor bepaalde consumentendiensten (o.a. e-commerce); micro-ondernemingen die diensten leveren zijn uitgezonderd | 🧭 | — | Jurist: B2B-SaaS en DPP-informatiepagina's vallen vermoedelijk niet onder de opsomming; bevestigen. | Laag |
| Publieke paspoortpagina | WCAG 2.1 AA / EN 301 549 (B; kan via klanten of gedelegeerde handelingen verplicht worden) | ❌ niet getest | semantische HTML, alt-teksten, mobiel ontwerp (code) | Audit met axe + schermlezertest; resultaten vastleggen. | Midden |

## 6. Beveiliging en bewijsbaarheid — B (en art. 32 AVG)

| Onderdeel | Status | Bewijs | Ontbrekende actie |
|---|---|---|---|
| Server-side autorisatie, tenant- en partnerisolatie | ✅ | `tests/roles-accounts-scans.test.js` (A-O), `tenant-isolation`, `license-tenant-isolation`, `partner-layer`, `impersonation`, `evidence-qr-saas` (ISO-01) | — |
| Abonnement verborgen voor medewerkers (UI + API) | ✅ | scenario G/H | — |
| Limieten, ook bij gelijktijdige verzoeken | ✅ | scenario G (5 gelijktijdig → precies 2) | — |
| Activatielink 48 u, eenmalig, hash | ✅ | scenario A-D | — |
| Tijdelijk wachtwoord 24 u, daarna ongeldig | ✅ | scenario E/M | — |
| Wachtwoordherstel | ✅ (via beheerder) | scenario M; `partner-password-reset` | Zelfservice per mail bewust niet (geen e-mail). |
| SQL-injectie | 🔎 | geparameteriseerde queries (`src/config/db.js`); ongeldige id's → 404 (`src/middleware/params.js`) | — |
| XSS | 🔎 | React-escaping; noodkopie ge-escaped (`media-scans-snapshots` test); SVG als download | CSP-header toevoegen. |
| CSRF | 🔎 | SameSite=Lax-cookie + JSON-API | — |
| Uploads | ✅ | type/grootte in handtekening, controle na upload, foto's opnieuw gecodeerd (`s3-storage`, `media-scans-snapshots`) | — |
| Documenten/foto's alleen met toegang | ✅ | `product-documents`, `evidence-qr-saas` | — |
| Publieke cache lekt geen privédata | ✅ | Worker cachet alleen `/p/*`; API en ingelogde pagina's nooit (`docs/cloudflare.md`, live gecontroleerd) | — |
| Auditlog zonder geheimen | 🔎 | wachtwoorden/tokens nooit gelogd; routes genormaliseerd (`requestMetrics.js`) | Bewaartermijn bepalen. |
| Back-up en herstel | ✅ | nachtelijk versleuteld, restore getest 2026-10-13 (`docs/noodplan.md`) | Elk kwartaal herhalen; bestanden in R2 hebben geen tweede kopie. |
| DB-verbinding versleuteld | 🟡 | database alleen op het interne Docker-netwerk (geen poort naar buiten); verbinding zelf zonder TLS | Acceptabel risico vastleggen of TLS inschakelen. |
| Geheimenbeheer | ✅ | alleen in `deploy/.env` op de server (chmod 600) en het beveiligde gegevensdocument | — |
| Rate limiting | ✅ | login, MFA, activatie, publieke API, scans (Cloudflare) | — |

## 7. Contracten, abonnementen, facturatie — C / W

| Onderdeel | Status | Ontbrekende actie |
|---|---|---|
| Algemene voorwaarden / SaaS-overeenkomst (B2B) | ❌ | Opstellen (beschikbaarheid, aansprakelijkheid, exit/data-export, bewaren paspoorten na einde contract). |
| Verwerkersovereenkomst met klanten | ❌ | Zie §1. |
| Partnerovereenkomst | ❌ | Bevoegdheden van partners (aanmaken klanten, abonnementen) contractueel vastleggen. |
| Facturatie | n.v.t. in de app | Facturen buiten de app; factuurvereisten (Wet OB) in de boekhouding. |
| Data-export bij vertrek | ✅ technisch | NDJSON-export per bedrijf (`/api/products/passports/export`). |

## Bedrijfsbeslissingen nodig (samengevat)

1. Rol VeriPasso per verwerking + rechtsgronden (jurist).
2. Bewaartermijnen: verwijderde accounts, auditlog, back-ups in R2, sessies/uitnodigingen.
3. Privacyverklaring publiceren (concept staat klaar).
4. Verwerkersovereenkomsten (STRATO, Cloudflare, klanten) en algemene voorwaarden.
5. ESPR/batterijen: per klant welke productgroep en welke gedelegeerde handeling.
6. NIS2/EAA-toepasselijkheid laten bevestigen.
7. Fijnmazige rechten voor medewerkers gewenst?

## Bronnen

- AVG: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- ESPR: https://eur-lex.europa.eu/eli/reg/2024/1781/oj — werkplan COM(2025) 187
- Batterijverordening: https://eur-lex.europa.eu/eli/reg/2023/1542/oj
- NIS2: https://eur-lex.europa.eu/eli/dir/2022/2555/oj — Cyberbeveiligingswet Stb. 2026, 187 (https://www.njb.nl/wetgeving/staatsbladen/cyberbeveiligingswet/)
- European Accessibility Act: https://eur-lex.europa.eu/eli/dir/2019/882/oj
- Telecommunicatiewet art. 11.7a: https://wetten.overheid.nl/BWBR0009950 — toelichting kst 33902 (https://zoek.officielebekendmakingen.nl/kst-33902-C.html)
- Datalekken melden: https://autoriteitpersoonsgegevens.nl (datalekken)
