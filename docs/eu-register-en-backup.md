# Back-up-DPP-dienstverlener en EU-register

Stand: 2026-10-21. Beide koppelingen zijn **gebouwd en getest, maar staan uit** tot er een
partij en endpoint is. Inschakelen = omgevingsvariabelen zetten in `deploy/.env` en
`update.sh` draaien; er is geen codewijziging nodig (behalve bij afwijkende API's).

## 1. Back-up-DPP-dienstverlener (continuïteit)

Doel: als de klant of VeriPasso stopt, blijft elk paspoort met zijn volledige historie
beschikbaar bij een onafhankelijke derde.

- Wat: **elke** gearchiveerde paspoortversie (alleen-toevoegen), met `contentSha256`,
  `previousChainSha256`, `chainSha256`, de interne snapshot en de DPP-JSON.
- Hoe: `PUT {BACKUP_DPP_PROVIDER_URL}/passports/{dppId}/versions/{n}` met
  `Authorization: Bearer {BACKUP_DPP_PROVIDER_TOKEN}`, elke 5 minuten, in volgorde per
  paspoort. Idempotent. Bij een fout: later opnieuw (2 min oplopend tot 24 uur), zonder
  versies over te slaan. Alleen HTTPS.
- Bij inschakelen wordt de hele bestaande historie alsnog verstuurd.
- Status (Platform Owner): `GET /api/admin/system/continuity`.
- Daarnaast blijft de NDJSON-export per bedrijf bestaan (`/api/products/passports/export`).

**Wat nog nodig is (geen code):** een contract met een (geaccrediteerde) back-up-DPP-
dienstverlener zodra die er zijn, en afspraken over hun API. Wijkt hun API af van het
bovenstaande, dan is alleen `src/services/dppContinuity.service.js` aan te passen.

## 2. EU DPP-register

Bron: *DPP Registry User Guide for Economic Operators* v1.03 (Europese Commissie, 2026-09-16).

**Wie doet wat**
- **De klant (marktdeelnemer)** verifieert zijn bedrijf in het register (EU Login, door de
  Commissie gezegelde PDF-verklaring, ondertekend met een QSeal/QES, zie
  [eu-register-checklist-klant.md](eu-register-checklist-klant.md)) en registreert zelf: per
  paspoort via een formulier, of tot 100 tegelijk met een JSON/XML-bestand volgens het
  sjabloon van het register. VeriPasso en partners doen dit niet voor de klant.
- **VeriPasso** host de volledige paspoortgegevens, houdt ze actueel en *altijd bereikbaar*,
  bewaart elke versie onveranderlijk (nooit verwijderen; elke versie blijft als JSON, JSON-LD en
  XML op te vragen) en levert de registratiegegevens.
- **Bewaarplicht:** paspoorten en alle versies blijven beschikbaar voor de periode die de
  productregels voorschrijven (per productgroep, vaak 10 jaar of langer), **ook als de klant
  stopt of VeriPasso failliet gaat**. Dat laatste vraagt een onafhankelijke back-up-
  dienstverlener (§1) en afspraken in de klantvoorwaarden (algemene voorwaarden art. 12).

**Wat het register vraagt per paspoort:** granulariteit (voor batterijen alleen *item*), de
**UPI** (https-URL volgens JTC 24, max. 2000 tekens, moet naar het paspoort leiden) en
optioneel model-ID en batch-ID. Het register geeft een correlation ID en bij succes een
registratie-ID (URI). Eén fout in een bestand keurt het hele bestand af.

**Productgroep:** elk product heeft een verplichte productgroep (Batterij, Textiel, IJzer &
staal, Aluminium, Banden, Meubels, Overig, Nog niet bekend; standaard *Nog niet bekend*, zie
`lib/productGroups.js`). Alleen bij **Batterij** staat de registerkaart open en actief; bij de
andere groepen toont de kaart één regel "aanmelden is nog niet nodig". De productgroep is geen
paspoortinhoud (geen nieuwe versie bij wijzigen) en staat in het overzicht voor handmatige invoer.

**Verificatie van het bedrijf:** verloopt met het zegel, en uiterlijk 3 jaar na de eerste
verificatie (Uitvoeringsverordening (EU) 2026/1778; Battery FAQ van de Commissie, vraag 6.2).
Bedrijfsinstellingen heeft twee optionele datums (verificatie, vervaldatum zegel); 60 dagen vóór
de vroegste datum verschijnt een melding bij het belletje (`lib/euVerification.js`). Geen e-mail:
VeriPasso verstuurt bewust geen e-mail (productbesluit oktober 2026).

**In VeriPasso** (product → tabblad QR-code → kaart *EU DPP-register*):
- Webadres (UPI) en modelnummer van het product om over te nemen, plus een CSV-werklijst
  (niet uploadbaar in het register: dat accepteert alleen JSON of XML volgens zijn sjabloon).
- **Exemplaren (2026-10-25):** het tabblad *Batches & exemplaren* is uit de app gehaald. Batterijen
  moeten vanaf februari 2027 per exemplaar geregistreerd worden; de techniek bestaat nog (eigen
  UPI per exemplaar `…/01/{GTIN}[/10/{lot}]/21/{serie}`, CSV per exemplaar via
  `GET /api/products/{id}/registration/records?granularity=item`, in delen van max. 100), dus de
  optie kan terug zodra een batterijklant hem nodig heeft.
- Vooraf controleren volgens de eisen uit de handleiding: alleen https, geen afwijkende poort,
  unieke UPI's, toegestane bestandsnaam; *UPI vooraf controleren* opent de UPI (hooguit één
  doorverwijzing, nooit naar http, eindigt op 200). De handleiding noemt geen exact maximum aan
  doorverwijzingen; het register doet zelf de definitieve controle.
- Uitkomst vastleggen: status (ingediend / geregistreerd / afgewezen), URI, correlation ID,
  foutcode; de paspoortversie van dat moment wordt mee bewaard.
- Stand register (gids v1.03): registratie van batterijpaspoorten lukt nog niet, omdat de
  semantische catalogus ontbreekt ("Semantic validation failed due to its unavailability").

**Nog niet:** het officiële bestandssjabloon (alleen te downloaden na inloggen in het register;
zodra we het hebben, komt de bestandsopbouw in `src/services/registryRecord.service.js`) en een
API voor dienstverleners (bestaat niet). De oude koppeling hieronder blijft daarom uit.
URI's legt de klant nu met de hand vast (de CSV-export van het Activity Dashboard bevat volgens
de handleiding alleen fouten). Te controleren zodra er toegang is: exporteert het detailscherm
van een geslaagde registratie ook de URI's? Dan een import toevoegen (100 URI's overtypen is
foutgevoelig).

### Oude generieke koppeling (staat uit)

- In de app: product → tabblad **QR-code** → **Klaarzetten voor EU-register** (indienen doet de klant zelf, zie hieronder).
- Via de API: `POST /api/v1/dpp/{dppId}/register` (sleutel met schrijfrecht), status via
  `GET /api/v1/dpp/{dppId}/registration`.
- Aanmeldingen wachten in `dbo.dppregistrations`. Met `EU_DPP_REGISTRY_URL` (en eventueel
  `EU_DPP_REGISTRY_TOKEN`) worden ze verstuurd als `POST {url}/registrations` met
  `digitalProductPassportId`, `uniqueProductIdentifier`, `granularity`,
  `economicOperatorId(+Scheme)`, `facilityId`, `contentSpecificationIds`, `passportUrl`.
- **Stand 2026-10-21:** het EU-register is open sinds juli 2026 (eerst batterijen). Indienen
  doet de klant zelf: verificatie met EU Login en een gekwalificeerd elektronisch zegel, daarna
  per formulier of met een JSON/XML-bestand (max. 100 paspoorten) volgens het sjabloon van het
  register. Een openbare API voor dienstverleners is er (nog) niet; de koppeling hierboven is
  een generiek koppelpunt, geen implementatie van een bestaande API, en staat daarom uit.
- Nog te bouwen: export volgens het officiële sjabloon, UPI als https-URL, import van de
  resultaten uit het register (registratie-ID, status, foutcode). Zie README §10.

## Variabelen

| Naam | Betekenis |
|---|---|
| `BACKUP_DPP_PROVIDER_URL` | basis-URL van de back-up-dienstverlener (HTTPS) |
| `BACKUP_DPP_PROVIDER_TOKEN` | API-token van die partij (geheim) |
| `EU_DPP_REGISTRY_URL` | basis-URL van het EU-register (HTTPS) |
| `EU_DPP_REGISTRY_TOKEN` | token voor het register (geheim) |
