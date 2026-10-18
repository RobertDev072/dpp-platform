# VeriPasso DPP-API (`/api/v1`)

Stand: 2026-10-18. Machineleesbare beschrijving: `GET /api/v1/openapi.json` (OpenAPI 3.1),
paspoortstructuur: `GET /api/v1/schema/dpp.json` (JSON Schema), termen: `GET /api/v1/vocab`.

> De methodenamen volgen de eisenlijst van de eigenaar (EN 18222-richting); de normtekst
> zelf is niet door AI gelezen. Laat de verplichte set en de exacte vorm bevestigen.

## Toegang

- **Lezen** van gepubliceerde (en gearchiveerde) paspoorten: publiek, geen sleutel nodig.
- **Schrijven**: API-sleutel van het bedrijf met recht *Lezen en schrijven*, aan te maken
  door de Bedrijfsbeheerder in **Bedrijfsinstellingen → API-sleutels**. Header:
  `Authorization: Bearer vp_xxxxxxxx_…`. De sleutel is één keer zichtbaar; opgeslagen wordt
  alleen een SHA-256. Intrekken werkt direct. Maximaal 10 actieve sleutels per bedrijf.
- Een sleutel werkt alleen op paspoorten van het eigen bedrijf (andere: 404).
- Limiet: 600 verzoeken per minuut per sleutel (zonder sleutel per IP).
- Elke schrijfactie staat in het auditlog (`via: "api"`, sleutel-id) en maakt een nieuwe
  archiefversie van het paspoort.

## Methoden

| Methode | Route | Toegang |
|---|---|---|
| ReadDPPById | `GET /dpp/{dppId}` (UUID, `urn:uuid:…` of paspoort-URL) | publiek |
| ReadDPPVersionByIdAndDate | `GET /dpp/{dppId}?at=2026-10-18T12:00:00Z` (of `?version=n`) | publiek |
| ReadDPPByProductId | `GET /dpp?productId={GTIN \| GS1 Digital Link \| urn:uuid}` | publiek |
| ReadDPPIdsByProductIds | `POST /dpp/search` `{ productIds: [...≤100], page, pageSize≤100 }` | publiek |
| ReadDataElement | `GET /dpp/{dppId}/elements/{elementId}` (bijv. `product.name`) | publiek |
| CreateDPP | `POST /dpp` `{ name, gtin, …, publish }` | sleutel, schrijven |
| UpdateDPPById | `PATCH /dpp/{dppId}` (productvelden, `sustainability`, `compliance`, `dppStatus`) | sleutel, schrijven |
| UpdateDataElement | `PUT /dpp/{dppId}/elements/{elementId}` `{ value }`; naam/omschrijving ook `[{ language, value }]` | sleutel, schrijven |
| DeleteDPPById | `DELETE /dpp/{dppId}`: archiveert; het paspoort blijft raadpleegbaar (`dppStatus: Archived`) | sleutel, schrijven |
| RegisterProductDPP | `POST /dpp/{dppId}/register`: zie `docs/eu-register-en-backup.md` | sleutel, schrijven |

Fouten: `{ "error": { "message", "code" } }` met 400/401/403/404/409/429.
Versiebeleid: `/api/v1` blijft stabiel; nieuwe velden kunnen worden toegevoegd (afnemers
negeren onbekende velden). Brekende wijzigingen komen in `/api/v2`.

## Voorbeeld

```bash
curl https://qr.veripasso.com/api/v1/dpp?productId=08712345678906
curl -X PATCH https://app.veripasso.com/api/v1/dpp/urn:uuid:… \
  -H "Authorization: Bearer vp_…" -H "Content-Type: application/json" \
  -d '{"sustainability":{"recycledMaterialPct":35}}'
```
