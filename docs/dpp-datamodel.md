# DPP-datamodel (machineleesbaar paspoort)

Stand: 2026-10-18 · `dppSchemaVersion` **1.0.0**. Geldt voor `GET /api/dpp/{id}` en
`/p/{id}` met `Accept: application/json` (ook JSON-LD en XML, zelfde inhoud).

> De veldnamen van de header volgen de eisenlijst die de eigenaar heeft aangeleverd
> (EN 18223-richting). De normtekst zelf is niet door AI gelezen (EVS-licentie): laat de
> namen en verplichtingen door een gelicentieerde persoon of de certificeerder bevestigen.
> Bestaande velden zijn behouden, zodat bestaande koppelingen blijven werken.

## Toegang per niveau

| Niveau | Wie | Hoe | Ziet |
|---|---|---|---|
| `public` | iedereen (consumenten) | zonder token | openbare gegevens en documenten |
| `professional` | reparateurs, recyclers | `Authorization: Bearer vpa_…` (token van het bedrijf) | plus documenten met zichtbaarheid *Professionals* |
| `authority` | markttoezicht, aangemelde instanties, Commissie | idem, token met niveau autoriteit | plus documenten met zichtbaarheid *Autoriteiten* |

Tokens maakt de Bedrijfsbeheerder in **Bedrijfsinstellingen → Toegang voor professionals en
autoriteiten**; per document kies je *Zichtbaar voor*. Interne documenten komen nooit in de
API. Antwoorden met een token zijn `Cache-Control: private, no-store` en worden nooit door
Cloudflare bewaard. Beperkte documenten downloaden: `GET /api/dpp/{id}/documents/{docId}/file`
met het token. Een eigen API-sleutel (`vp_…`) geeft op de eigen paspoorten niveau `authority`.
Welke **gegevensvelden** per niveau openbaar zijn (bijv. Bijlage XIII van de Batterijverordening)
volgt zodra er productgroep-specifieke velden komen; nu zijn alle datavelden openbaar.

## Header

| Veld | Inhoud |
|---|---|
| `digitalProductPassportId` | `urn:uuid:{id}`: permanent, nooit hergebruikt (database-trigger) |
| `uniqueProductIdentifier` | UPI: altijd een persistente **https-URL** die naar het paspoort leidt (eis van het EU DPP-register, max. 2000 tekens). Met een geldige GTIN de GS1 Digital Link op het QR-domein (`https://qr.veripasso.com/01/{GTIN-14}[/10/{lot}][/21/{serie}]`, opent via de resolver met één doorverwijzing het paspoort), anders de paspoort-URL `https://qr.veripasso.com/p/{ID}`. De vorm onder `id.gs1.org` staat in `identifiers.gs1DigitalLink`. |
| `accessLevel` | `public`, `professional` of `authority`: het niveau van de lezer (zie hieronder) |
| `granularity` | `model`, `batch` of `item` |
| `dppSchemaVersion` | versie van deze structuur |
| `dppStatus` | `Active` (op de markt) of `Archived` (blijft raadpleegbaar) |
| `lastUpdated` | ISO 8601 UTC |
| `economicOperatorId`, `economicOperatorIdScheme` | uit Bedrijfsinstellingen: LEI, GLN, EORI, btw, KvK, DUNS of anders (formaat en controlecijfer gecontroleerd) |
| `facilityId` | productielocatie (optioneel, per product) |
| `contentSpecificationIds` | toepasselijke wetgeving/normen (per product) |
| `language` | taal van de basisteksten (BCP 47) |

## Inhoud

- `identifiers`: `passportId`, `urn`, `gtin`, `sku`, `gs1DigitalLink` (bij batch/item ook `modelPassportId`, `lotNumber`, `serialNumber`).
- `product`: basisvelden plus `nameMultiLanguage` en `descriptionMultiLanguage` (`[{ language, value }]`).
- `dataElements`: elk gevuld veld met `elementId`, `type` (`DataElement` of `MultiLanguageDataElement`), `value`, `dictionaryReference` (schema.org, GS1 of `/vocab/dpp#…`) en waar van toepassing `unitCode` (UN/CEFACT Rec. 20).
- `relatedResources`: openbare documenten met `resourceType`, `title`, `mimeType`, `language`, `url`, `validUntil`.
- Ongewijzigd: `sustainability`, `compliance`, `parts`, `documents`, `version`.

## Vocabulaire

`https://qr.veripasso.com/vocab/dpp`: definities van de eigen termen. Termen worden nooit
hernoemd of verwijderd (oude versies verwijzen ernaar); bron: `lib/dppVocabulary.js`.

## Versies

Een wijziging van productvelden, vertalingen, of de naam/identificatie van het bedrijf
legt een nieuwe archiefversie vast (alleen als de inhoud verandert). Interne snapshotversie:
`SNAPSHOT_SCHEMA_VERSION` 2 (oude versies met versie 1 blijven leesbaar).

## Gegevensdragers

| Drager | Norm | Inhoud | Waar |
|---|---|---|---|
| QR-code | ISO/IEC 18004, foutcorrectie Q, vrije ruimte 4 modules | permanente paspoort-URL `qr.veripasso.com/p/{id}` | product (tab QR-code), batch, exemplaar, ZIP-export |
| Data Matrix ECC 200 | ISO/IEC 16022, vrije ruimte 2 modules | dezelfde paspoort-URL, of (`?content=gs1`) een GS1 Digital Link op het QR-domein met GTIN, lot en serienummer | idem |

Beide worden in de tests echt teruggelezen (jsQR, ZXing). De inhoud van eerder gedrukte
QR-codes is ongewijzigd; alleen de witte rand in nieuwe downloads is breder.
