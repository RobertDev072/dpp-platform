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

## 2. EU DPP-register (RegisterProductDPP)

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
