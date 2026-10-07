# UX/UI & business features — implementatieplan

Basis: de bestaande architectuur blijft (Next.js App Router-frontend, Express-API in
één Vercel Function, Supabase Postgres/Auth/Storage, eigen sessies, tenant-isolatie
in de API). Geen herschrijving: nieuwe functies bouwen voort op bestaande routes,
repositories en componenten.

## Analyse bestaande situatie (2026-10-08)

| Onderdeel | Was | Probleem |
|---|---|---|
| Dashboard (`/company`) | 6 losse tellers + licentiekaart | leeg, geen acties, geen trends |
| Productenlijst | filters, sortering, paginering (server-side), compleetheid | geen selectie/bulk, "Importeren" uitgeschakeld |
| Producteditor | tabs (algemeen/duurzaamheid/compliance/documenten/QR) | geen checklist/score per onderdeel, publicatie niet als flow zichtbaar |
| QR-codes | raster met PNG/SVG/PDF per product | geen statistieken, filters, selectie, bulk-download/print |
| Print | één vast label-PDF per product (pdfkit) | geen profielen/formaten/voorvertoning |
| Import | ontbreekt | grote bedrijven moeten alles handmatig invoeren |
| Header | bel-icoon zonder functie | geen meldingen, geen zoekfunctie |

## Architectuurkeuzes voor bulkwerk (belangrijk)

Vercel Functions accepteren/versturen max. 4,5 MB en mogen max. 60 s draaien; er is
(zonder extra betaalde dienst) geen achtergrond-jobqueue. Daarom:

- **Import**: de browser leest het bestand (CSV via papaparse, XLSX via
  read-excel-file) en stuurt de rijen in **brokken van 250** naar de API. De server
  valideert elke rij opnieuw (nooit de client vertrouwen), bepaalt de tenant uit de
  sessie en schrijft per brok in één transactie. Een import-job in de database
  (`import_jobs`) houdt de voortgang, tellingen en het foutrapport bij → Import Center.
  10.000 rijen = 40 requests van elk enkele seconden: geen time-outs, wel voortgang.
- **Bulk QR (ZIP) en bulk PDF-labels**: de server levert per pagina (500 producten)
  de gegevens inclusief de *officiële* QR-URL (`getPassportUrl`, één bron van
  waarheid); de browser maakt de QR-afbeeldingen/PDF (qrcode, pdf-lib, jszip) met
  voortgangsbalk. QR's zijn vectoren in de PDF (klein bestand, scherp bij elke maat).
  Zo is er geen grens van 4,5 MB/60 s en geen serverbelasting.
- Alle bulkacties op de server (publiceren, archiveren, categorie, QR reserveren)
  zijn tenant-scoped (`WHERE company_id = <sessie>`), max. 1000 ids per verzoek.

## Fasering en status

### Fase 1 — UX foundation
- [x] Herbruikbare componenten: PageHeader, KpiCard, EmptyState (met actie),
      ConfirmDialog, BulkActionBar, FileDropzone, ProgressBar, StatusBadge,
      ProductCompleteness, QrPreview, extra iconen met tooltips
- [x] Dashboard-redesign (begroeting, KPI's met trend, scans-grafiek, acties nodig,
      recente producten, onboarding-checklist met voortgang)
- [x] Producteditor: compleetheidsscore + checklist (klik → juiste tab),
      publicatieflow (Concept → Compleet → Gepubliceerd → Gearchiveerd)
- [x] QR-beheer: statistieken, filters, selectie, kopiëren, bulk ZIP (PNG/SVG),
      bulk PDF-labels, QR reserveren vóór publicatie

### Fase 2 — Bulk workflows
- [x] Import wizard (upload → mapping → preview/validatie → duplicaten → import → resultaat)
- [x] Excel/CSV-template, automatische kolomherkenning, foutrapport (CSV/XLSX)
- [x] Import Center (historie)
- [x] Bulkacties producten (publiceren, archiveren, categorie, QR, exporteren)

### Fase 3 — Print
- [x] Printprofielen per bedrijf (papier/label-indeling, media, printertype,
      QR-instellingen, template-preset met aan/uit-elementen)
- [x] Waarschuwing bij te kleine QR, printvoorvertoning, bulk-PDF via profiel

### Fase 4 — SaaS management (deels)
- [x] Meldingencentrum (bel in de header, rolbewust: bedrijf/partner/owner;
      "verbergen" per melding wordt lokaal in de browser onthouden)
- [x] Globale zoekfunctie in de header (`/` of Ctrl+K; gegroepeerde resultaten;
      platform owner over alle bedrijven, partner alleen eigen klanten, bedrijf alleen
      eigen producten/documenten/medewerkers)
- [x] Menu: "Importeren" en "Print & labels" toegevoegd voor bedrijfsgebruikers
- [ ] Customer 360 met tabs, partnerdashboard-uitbreiding, gebruikersbeheer
      (sessies/laatste login), facturatie — volgende iteratie
- [ ] Documentversies/vervaldatum — vereist schemawijziging, volgende iteratie

### Fase 5 — polish
- [x] Nieuwe en vernieuwde pagina's gecontroleerd op 1366 px en 390 px breed
- [ ] Volledige accessibility-/responsive-review van alle oude (admin/partner) pagina's
- [ ] Zoekbalk op mobiel (nu alleen vanaf `sm`; op mobiel via de pagina's zelf)

## Bewust níet gebouwd (en waarom)

- **QR activeren/deactiveren**: een gedrukte QR-code moet altijd blijven werken.
  "Deactiveren" zou geprinte labels breken; archiveren toont de pagina als
  gearchiveerd maar de URL blijft bestaan. QR-status wordt afgeleid
  (geen / gereserveerd / actief / gearchiveerd) i.p.v. een los schakelbaar veld.
- **.xls (oud Excel)**: geen veilige, kleine parser beschikbaar; de wizard vraagt
  om opslaan als .xlsx of .csv.
- **Server-side PDF-generatie**: Vercel Functions hebben 4,5 MB/60 s-limieten.
  PDF/ZIP worden in de browser gemaakt (1.000 labels ≈ 0,9 MB, ≈ 3 s); de server
  levert alleen de tenant-gecontroleerde data incl. de officiële QR-URL.

## Wat daadwerkelijk getest is

- `npm test`: 138 tests, 134 geslaagd, 0 gefaald, 4 overgeslagen (vereisen echte
  Supabase Auth/Storage). Nieuw: `tests/bulk-import-print.test.js` (24 tests):
  IDOR/tenant-scheiding van bulkacties, QR-items/-stats, QR reserveren, import
  (preview, flow aanmaken/bijwerken/fout, foutrapport, afgeronde job, limieten,
  geen toegang voor ander bedrijf of platform owner), printprofielen (rollen,
  validatie QR < 10 mm, tenant-scheiding), zoeken, meldingen, dashboard,
  compleetheid.
- `next build`: geslaagd (één bestaande Turbopack-waarschuwing over
  `app.set("trust proxy")`, onschadelijk).
- Browser-rooktest (Playwright, productiebuild, lokale Postgres): dashboard,
  producten, product-QR-tab, QR-codes, import-wizard, Import Center,
  bedrijfsinstellingen, Print & labels — desktop en mobiel: geen console-fouten,
  geen 5xx, geen horizontale scroll; printprofiel aangemaakt via de UI, zoeken en
  meldingen geopend.
- Printengine in Node: alle voorbeeldprofielen × 1.000 labels; QR uit de PDF
  gedecodeerd naar de exacte `https://qr.veripasso.com/p/<GUID>`-URL.
- Niet getest: echte Supabase-omgeving (geen project beschikbaar in deze sessie),
  fysiek printen op een labelprinter, Excel-bestanden uit de praktijk van klanten.
