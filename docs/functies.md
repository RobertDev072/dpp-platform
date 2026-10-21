# VeriPasso: wat de app doet en hoe het werkt

Stand: 2026-10-21. Overzicht van alle functies van de VeriPasso SaaS, in gewone taal. Techniek
en infrastructuur in detail: [infrastructuur.md](infrastructuur.md); bij storingen:
[noodplan.md](noodplan.md). Wat de eigenaar nog moet doen: [checklist-eigenaar.md](checklist-eigenaar.md).

## 1. Wat is VeriPasso?

VeriPasso is een platform voor **digitale productpaspoorten (DPP)** volgens de Europese
Ecodesignverordening (ESPR) en de Batterijverordening. Een bedrijf legt de gegevens van zijn
producten vast (materialen, duurzaamheid, documenten, onderdelen) en publiceert per product een
paspoort. Op het product komt een **QR-code**; wie die scant, ziet het paspoort. Systemen en
toezichthouders kunnen hetzelfde paspoort machineleesbaar opvragen (JSON, JSON-LD, XML).

| Adres | Waarvoor |
|---|---|
| www.veripasso.com | website (landingspagina) |
| app.veripasso.com | de applicatie (inloggen en beheren) |
| qr.veripasso.com | de paspoorten achter de QR-codes (blijft altijd hetzelfde) |

## 2. Wie gebruikt het (rollen)

| Rol | Wat kan deze rol |
|---|---|
| **Platform Owner** (VeriPasso zelf) | alles: partners en klantbedrijven aanmaken, abonnementen, auditlog, systeemstatus, "inloggen als" |
| **Partner Admin** (bijv. certificeerder of wederverkoper) | eigen klantbedrijven aanmaken en uitnodigen, licenties inzien; ziet **geen** producten van klanten |
| **Bedrijfsbeheerder** | alles binnen het eigen bedrijf: producten, documenten, medewerkers, abonnement, instellingen, API-sleutels, toegangstokens |
| **Medewerker** | producten, documenten en QR-codes van het eigen bedrijf |

Elk bedrijf is volledig afgeschermd van andere bedrijven (op de server gecontroleerd en getest).

## 3. Functies per onderdeel

### Inloggen en accounts
- Inloggen met e-mail en wachtwoord; optioneel **tweestapsverificatie** (app met codes), met
  herstelcodes. Sterk aangeraden voor beheerders.
- **Geen e-mail**: VeriPasso verstuurt geen mail. Uitnodigingslinks (48 uur geldig) en tijdelijke
  wachtwoorden verschijnen op het scherm en geef je zelf door.
- "Wachtwoord vergeten" verwijst naar de beheerder, die een tijdelijk wachtwoord geeft.
- **Mijn gegevens downloaden** (AVG): in het profiel.

### Producten
- Lijst met zoeken, filters, sorteren, bulkacties (publiceren, archiveren), export naar Excel en
  QR-codes van meerdere producten tegelijk (ZIP).
- Per product zes tabbladen:
  1. **Basisinformatie**: naam, categorie, merk, **productgroep** (Batterij, Textiel, … of *Nog
     niet bekend*), omschrijving, SKU, GTIN, model, fabrikant, land, productielocatie, taal,
     toepasselijke wetgeving, vertalingen.
  2. **Duurzaamheid**: CO₂, gerecycled materiaal, materialen, recyclebaar, REACH/RoHS,
     levensduur, EPD.
  3. **Compliance**: CE-markering, toepasselijke regelgeving.
  4. **Documenten**: uploaden of linken; per document *Zichtbaar voor*: iedereen,
     professionals, alleen autoriteiten of alleen intern (standaard *alleen intern*);
     geldigheidsdatum en versie.
  5. **Batches & exemplaren**: extra QR-codes per productieronde (batch) of per stuk
     (exemplaar met serienummer); uitleg "Wanneer gebruik ik wat?", bevestiging vóór aanmaken,
     download van alle QR-codes als ZIP en een overzicht voor de drukker (CSV).
  6. **QR-code**: QR-code of Data Matrix downloaden (SVG/PNG), en de kaart **EU-register**.
- **Compleetheid**: per product een percentage met wat nog ontbreekt.
- **Publiceren**: vanaf dan is het paspoort openbaar. Een gepubliceerd paspoort kan niet meer
  terug naar concept en blijft altijd bereikbaar, ook na archiveren of als het abonnement stopt.

### Paspoort en QR-code
- Paspoortpagina op `qr.veripasso.com/p/{ID}`: productgegevens, foto, documenten, duurzaamheid.
  Zet geen cookies.
- **Machineleesbaar** op dezelfde link (JSON, JSON-LD, XML), met een vaste kop
  (paspoort-ID, UPI, granulariteit, status, laatste wijziging, marktdeelnemer) en datavelden
  met woordenboekverwijzingen.
- **UPI** (Unique Product Identifier): altijd een vaste https-link. Met GTIN de GS1 Digital Link
  (`qr.veripasso.com/01/{GTIN}/10/{lot}/21/{serienummer}`), anders de paspoortlink.
- **Versies**: elke inhoudelijke wijziging wordt een onveranderlijke versie met een
  vingerafdruk (hash, aan elkaar geschakeld). Oude versies blijven altijd op te vragen, ook
  als JSON/XML. Niets wordt verwijderd.
- **Scans tellen**: alleen echte QR-scans, één keer per apparaat per 30 minuten, zonder
  IP-adres of cookies; losse scans 90 dagen, daarna alleen dagtotalen.

### Toegang voor professionals en autoriteiten
- Consumenten zien alleen openbare gegevens. Het bedrijf maakt in *Bedrijfsinstellingen* een
  **toegangstoken** voor een reparateur, recycler of toezichthouder (niveau professional of
  autoriteit). Met dat token zien zij in de JSON/XML ook de documenten voor hun niveau.
- Tokens verlopen altijd (maximaal 2 jaar), zijn in te trekken en worden alleen versleuteld
  bewaard. Elke opvraging met een token wordt gelogd (365 dagen), zichtbaar bij *Gebruik*.

### EU-register (Europese Commissie)
- Het bedrijf meldt zijn paspoorten **zelf** aan bij het EU-register (na verificatie met
  EU Login en een gekwalificeerd elektronisch zegel). VeriPasso host het paspoort en levert de
  gegevens.
- Kaart *EU-register* bij elk product: alleen open en actief bij productgroep **Batterij**;
  anders één regel "nog niet nodig". Stappen: (1) bedrijf verifiëren, (2) product aanmelden
  (webadres kopiëren, overzicht per exemplaar), (3) uitkomst van de EU vastleggen
  (registratienummer, aanvraagnummer, status, foutcode, met de paspoortversie).
- *Bedrijfsinstellingen*: datum EU-verificatie en vervaldatum zegel; 60 dagen vóór het verlopen
  (zegel of uiterlijk 3 jaar na verificatie) een melding bij het belletje.
- Checklist voor klanten: in de app (PDF) en [eu-register-checklist-klant.md](eu-register-checklist-klant.md).
- Nog niet: het officiële uploadbestand (sjabloon van de EU nodig) en registratie van
  batterijen (de EU laat dat nog niet toe).

### Koppelingen (B2B-API)
- `/api/v1` voor andere systemen (ERP, PIM, toezichthouders): paspoorten lezen, aanmaken,
  wijzigen, archiveren, datavelden bijwerken. Lezen kan zonder sleutel; schrijven met een
  **API-sleutel** van het bedrijf. Beschrijving: `/api/v1/openapi.json` en [api-v1.md](api-v1.md).
- Export van alle paspoorten met alle versies (NDJSON), voor een back-up-dienstverlener.

### Bedrijf, medewerkers en abonnement
- Medewerkers uitnodigen, rollen, blokkeren, tijdelijk wachtwoord, tweestapsverificatie resetten.
- Bedrijfsinstellingen: naam, logo, marktdeelnemer-ID (KvK, LEI, GLN, btw, …), EU-verificatie,
  API-sleutels, toegangstokens.
- Abonnement: aantal gebruikers en producten; een verlopen licentie blokkeert alleen
  **aanmaken**, nooit bestaande paspoorten.
- Rapportages, meldingen (belletje), help-pagina.

### Beheer (Platform Owner)
- Partners en klantbedrijven, organisatieboom met gebruikers, abonnementen, auditlog van alle
  belangrijke handelingen, "inloggen als" (max. 1 uur, gelogd), systeemstatus (snelheid,
  fouten, database- en opslaggroei, capaciteit, back-ups).

## 4. Hoe het technisch werkt (kort)

```
QR-scan / systeem ─► Cloudflare (DNS, cache, noodkopie van elk paspoort, bewaking)
gebruiker ─────────► STRATO-server (Docker: Caddy HTTPS → app → PostgreSQL 17)
                          │ elke nacht, versleuteld
                          ▼
           back-up op de server · Cloudflare R2 · Hetzner Storage Box (+ snapshots)
```

- **Applicatie**: Next.js (schermen) + Express (API) + PostgreSQL 17, in Docker op één server bij
  STRATO (Duitsland). Foto's en documenten in Cloudflare R2 (EU).
- **QR-codes blijven werken** als de server plat ligt: Cloudflare toont dan een noodkopie van het
  paspoort (getest).
- **Back-ups**: elke nacht versleuteld op drie plekken; herstel zonder STRATO getest in ca.
  3 minuten. Noodherstel in stappen, nooit automatisch: [noodplan.md](noodplan.md).
- **Bewaking**: elke 5 minuten vanaf Cloudflare; pushmeldingen naar de telefoon.
- **Code**: GitHub; bij elke wijziging automatische tests (ca. 280), build en beveiligingscontrole.
  Uitrollen met `deploy/update.sh` (maakt eerst een back-up).

## 5. Waar staat wat

| Wat | Waar |
|---|---|
| Code en documentatie | GitHub-repository `dpp-platform` (deze map) |
| Geheime gegevens (wachtwoorden, sleutels) | `Documents\VeriPasso\VeriPasso-GEHEIM-gegevens.pdf` en het noodpakket (ZIP), nooit in git |
| Handleidingen (PDF) | `Documents\VeriPasso\Handleidingen\` |
| Juridische concepten (PDF) | `Documents\VeriPasso\Juridisch (concept)\` en `docs/juridisch/` |
| Datamodel en API | [dpp-datamodel.md](dpp-datamodel.md), [api-v1.md](api-v1.md) |
| Wet en normen | [compliance/wettelijke-matrix.md](compliance/wettelijke-matrix.md) |
