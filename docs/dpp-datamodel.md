# DPP-datamodel (machineleesbaar paspoort)

Stand: 2026-10-18 · `dppSchemaVersion` **1.0.0**. Geldt voor `GET /api/dpp/{id}` en
`/p/{id}` met `Accept: application/json` (ook JSON-LD en XML, zelfde inhoud).

> De veldnamen van de header volgen de eisenlijst die de eigenaar heeft aangeleverd
> (EN 18223-richting). De normtekst zelf is niet door AI gelezen (EVS-licentie): laat de
> namen en verplichtingen door een gelicentieerde persoon of de certificeerder bevestigen.
> Bestaande velden zijn behouden, zodat bestaande koppelingen blijven werken.

## Header

| Veld | Inhoud |
|---|---|
| `digitalProductPassportId` | `urn:uuid:{id}`: permanent, nooit hergebruikt (database-trigger) |
| `uniqueProductIdentifier` | GS1 Digital Link (`https://id.gs1.org/01/{GTIN-14}[/10/{lot}][/21/{serie}]`) als er een geldige GTIN is, anders `urn:uuid:{id}` |
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
