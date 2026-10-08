# UX/UI & bulkworkflows — implementatieplan

Stand: 2026-10-08. Uitwerking van de brief "VeriPasso — UX/UI & Business Features".
Uitgangspunt: voortbouwen op de huidige architectuur, niets herschrijven wat werkt.

## 1. Huidige architectuur (relevant voor dit plan)

| Laag | Wat er is | Gevolg voor dit plan |
|---|---|---|
| Frontend | Next.js 16 app router, client pages, Tailwind, eigen componenten in `components/ui` | Nieuwe componenten in dezelfde stijl (slate/emerald, rounded-xl kaarten), geen UI-library |
| API | Express in één Vercel-functie (`pages/api/[[...path]].js` → `src/app.js`), max. 30 s, request/response max. ~4,5 MB | Grote batches **client-gestuurd in stukken** (import, PDF, ZIP) met voortgang; geen achtergrondworkers nodig |
| Data | Supabase Postgres, schema `dbo`, repositories met `@param`-queries | Alleen **additieve** migratie (nieuwe tabellen + nullable kolommen) |
| Tenant | `companyId` altijd uit de sessie; `assertCompanyAccess` geeft 404 bij andere tenant | Elke nieuwe query krijgt `company_id = @companyId` uit `req.user` |
| QR | `{QR_BASE_URL}/p/{PUBLIC_ID}`; `public_id` wordt nooit gewijzigd | Ongewijzigd. Nieuw: QR kan vóór publicatie worden **gereserveerd** (public_id toekennen, pagina blijft 404 tot publicatie) |

Gevonden en meegenomen:
- `category_label` kon via de API niet worden gezet → een product kon nooit 100% compleet worden.
- `DELETE /api/products/:id/documents/:docId` controleerde niet of het document bij dat product hoort (IDOR binnen dezelfde rol).

## 2. Datamodel (migratie `20261008000000_ux_workflows.sql`)

- `dbo.productimports` — importjobs per bedrijf: bestand, kolomkoppeling, duplicaatstrategie, rijen (tijdelijk, worden na afloop gewist), voortgang, tellingen, fouten.
- `dbo.printprofiles` — printprofielen per bedrijf (`settings` als jsonb, gevalideerd met Zod).
- `dbo.documents` + `valid_until`, `version`, `uploaded_by` (nullable); categorie uitgebreid met `certificate` en `declaration`.

Status "compleet" is **afgeleid** (compleetheid = 100%), geen nieuwe productstatus: de bestaande `draft/published/archived` blijft leidend, zodat niets per ongeluk publiek wordt.

## 3. Fasering

| Fase | Onderdelen | Aanpak |
|---|---|---|
| 1 Foundation | PageHeader, KpiCard, StatusBadge, EmptyState (met CTA), ConfirmDialog, BulkActionBar, FileDropzone, ProgressBar, Tooltip-iconen; dashboard; product-editor; compleetheid; QR-beheer | Eén `/api/dashboard/overview`-request voor het hele dashboard |
| 2 Bulk | Import-wizard (xlsx/xls/csv), template, kolomherkenning, preview/validatie, duplicaten, foutrapport, Import Center, bulkacties producten | Upload → server parseert en bewaart job → validatie → import in stukken van 250 rijen met voortgang |
| 3 Print | Printprofielen, papier/labelformaten, printertypes, QR-instellingen + leesbaarheidscontrole, templates, preview, bulk-PDF | Labels als vector-QR in pdfkit; PDF/ZIP per deel van max. 500 producten |
| 4 SaaS | Meldingencentrum, globale zoekfunctie, onboarding-checklist, gebruikers/klant-360/abonnementen | Meldingen live berekend (geen extra tabel) |
| 5 Polish | Responsive, toegankelijkheid, review | — |

## 4. Status (2026-10-08)

Alle vijf fases zijn gebouwd. Overzicht van wat waar zit:

| Onderdeel | Code |
|---|---|
| UI-bouwstenen | `components/ui/` (PageHeader, KpiCard, StatusBadge, EmptyState, Modal, ConfirmDialog + `useConfirm`, BulkActionBar, FileDropzone, ProgressBar, icons) |
| Dashboard (1 request) | `GET /api/dashboard/overview` → `src/services/insights.service.js`; `app/company/page.js` |
| Compleetheid | `src/utils/completeness.js` (score) + 7 criteria in `products.repository.js` (filters) |
| Product-editor | `app/company/products/[id]/page.js` (tabs, checklist, publicatiestappen, dupliceren) |
| QR-beheer | `app/company/qr-codes/page.js`, `POST /api/products/:id/qr` (reserveren), `GET /api/products/qr-stats` |
| Import | `src/services/productImport.service.js` (parsen/valideren), `importRunner.service.js` (chunks), `/api/products/import/*`, wizard `app/company/products/import`, Import Center `app/company/imports` |
| Bulkacties | `/api/products/bulk/{resolve,actions,export}` |
| Print & labels | `src/services/printLayout.service.js`, `/api/print/*`, `app/company/print-labels`, `components/print/PrintExportDialog.js` |
| Zoeken / meldingen | `/api/search`, `/api/dashboard/notifications`, `components/shell/` |
| Customer 360 | `GET /api/admin/companies/:id/overview`, `app/admin/companies/[id]` |
| Publiek paspoort | `app/p/[id]/page.js` + `not-found.js` |

### Uitrol

1. **Eerst de migratie** `supabase/migrations/20261008000000_ux_workflows.sql` toepassen op Supabase (`npm run migrate`). De code gebruikt de nieuwe tabellen/kolommen; zonder migratie falen import, printprofielen en documentlijsten.
2. Daarna deployen. Bestaande QR-URL's en data blijven ongewijzigd.

### Testen zonder productiedata

De `.env` wijst naar de productiedatabase. Tests zijn gedraaid tegen een tijdelijke
Postgres in het geheugen (PGlite via `@electric-sql/pglite-socket`, buiten de repo)
met `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:<poort>/postgres`.

## 5. Bewust niet (of anders) gedaan

- **QR deactiveren** van gepubliceerde producten: niet aangeboden. Gedrukte codes moeten blijven werken (ook na archiveren). "Inactief" betekent hier: gereserveerd maar nog niet gepubliceerd.
- **Geen achtergrondqueue**: Vercel Hobby heeft geen workers; de client stuurt de batches aan en kan na een onderbreking hervatten (de job onthoudt de voortgang).
- Facturatie en omzet/commissie voor partners: er is geen facturatiedata in het systeem; alleen gebruik/limieten worden getoond.
- **Bulk verwijderen** van producten = archiveren (bestaande semantiek van `DELETE /api/products/:id`): productdata en QR-codes blijven bestaan.
- **Bulkacties op gebruikers** (rol/status voor meerdere accounts tegelijk): niet gebouwd. Rol- en statuswijzigingen hebben per account eigen veiligheidsregels (laatste beheerder, Platform Owner, impersonatie); die horen niet in een bulkpad zonder eigen review. Exporteren bestond al.
- **Bulk downloaden van documenten** (ZIP van geüploade bestanden): niet gebouwd; bestanden staan in privé-opslag en per stuk downloaden blijft beschikbaar.
- Template-designer: vaste templates plus "Aangepast" (elementen aan/uit), geen vrije drag-and-drop-editor.
- `.xls` wordt ondersteund via SheetJS; Excel-bestanden met macro's of meerdere tabbladen: het eerste tabblad dat niet "Instructies" heet wordt gelezen.
