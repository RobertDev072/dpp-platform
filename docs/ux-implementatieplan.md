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

### Fase 4 — SaaS management
- [x] Meldingencentrum (bel in de header, rolbewust; ook verlopen/bijna verlopen documenten)
- [x] Globale zoekfunctie in de header (`/` of Ctrl+K; op mobiel via het zoekicoon)
- [x] Menu: "Importeren" en "Print & labels" voor bedrijfsgebruikers
- [x] Customer 360 (`/admin/companies/[id]`): tabs Overzicht, Producten, Gebruikers,
      QR-codes, Documenten, Activiteit, Abonnement, Facturatie, Instellingen;
      contactpersoon, facturatiegegevens en interne notities (notities nooit zichtbaar
      voor de klant zelf)
- [x] Abonnementen/usage: producten, gebruikers, opslag en QR-scans per maand met
      voortgangsbalken, prijs per plan en waarschuwingen (≥ 80%, verlopen, verloopt
      binnen 30 dagen) — voor bedrijf, partner en platformbeheer
- [x] Partnerdashboard: klanten, actieve klanten, producten, QR-scans (30 d.) en
      indicatieve maandomzet; per klant aantallen (geen productinhoud)
- [x] Gebruikersbeheer: KPI's per rol, laatste login, actieve sessies bekijken en
      beëindigen, bulk activeren/blokkeren/rol wijzigen/archiveren/exporteren
- [x] Documentbeheer: versie, taal, vervaldatum, uploader, archiveren (soft),
      verloopwaarschuwingen, filters, bulk openbaar/privé/archiveren/herstellen,
      ZIP-download en CSV-export

### Fase 5 — polish
- [x] Responsive/toegankelijkheidscontrole van álle admin-, partner- en
      bedrijfspagina's op 375 px en 1366 px (zie "Wat getest is")
- [x] Mobiel: alleen de laatste breadcrumb, zoekicoon met zoekbalk over de volle
      breedte, actief tabblad blijft in beeld, filterblokken alleen op desktop sticky

## Bewust níet gebouwd (en waarom)

- **QR activeren/deactiveren**: een gedrukte QR-code moet altijd blijven werken.
  "Deactiveren" zou geprinte labels breken; archiveren toont de pagina als
  gearchiveerd maar de URL blijft bestaan. QR-status wordt afgeleid
  (geen / gereserveerd / actief / gearchiveerd) i.p.v. een los schakelbaar veld.
- **.xls (oud Excel)**: geen veilige, kleine parser beschikbaar; de wizard vraagt
  om opslaan als .xlsx of .csv.
- **Betaalprovider/facturen genereren**: de tab Facturatie toont maandbedrag en
  facturatiegegevens; facturen en betalingen lopen buiten VeriPasso tot er een besluit
  is over provider en kosten. "Maandomzet" voor partners is indicatief (som van
  planprijzen), geen boekhouding en geen commissieberekening.
- **MFA-status**: VeriPasso heeft (nog) geen MFA; die kolom tonen zou misleiden.
- **Document aan meerdere producten koppelen**: een document hoort bij precies één
  product (schema). Meervoudige koppeling vraagt een koppeltabel en raakt het publieke
  paspoort — eerst samen ontwerpen.
- **Scan-/opslaglimieten afdwingen**: alleen informatief. Een QR-code mag nooit stoppen
  met werken door een limiet.
- **Server-side PDF-generatie**: Vercel Functions hebben 4,5 MB/60 s-limieten.
  PDF/ZIP worden in de browser gemaakt (1.000 labels ≈ 0,9 MB, ≈ 3 s); de server
  levert alleen de tenant-gecontroleerde data incl. de officiële QR-URL.

## Wat daadwerkelijk getest is

- `npm test`: 153 tests, 149 geslaagd, 0 gefaald, 4 overgeslagen (vereisen echte
  Supabase Auth/Storage). Nieuw t.o.v. de vorige ronde: `tests/saas-management.test.js`
  (15 tests): documentvelden/uploader, verloopmelding, tenant-scheiding van document-
  bulk en downloadlinks, archiveren (weg van paspoort en uit compleetheid, herstellen),
  sessies (inzien, intrekken, ingetrokken sessie werkt niet meer, ander bedrijf en
  platform owner afgeschermd), uitgebreid verbruik, notities onzichtbaar voor klant,
  Customer 360 alleen voor owner, validatie contact/facturatie, planprijs, partner-
  aggregaten alleen eigen klanten. Plus `tests/bulk-import-print.test.js` (24 tests).
- `next build`: geslaagd (één bestaande, onschadelijke Turbopack-waarschuwing).
- Browsercontrole (Playwright, productiebuild, lokale Postgres) van 33 pagina's ×
  2 breedtes (375 px en 1366 px) als platform owner, partner en bedrijfsbeheerder,
  incl. alle Customer 360-tabs: geen console-fouten, geen 5xx, geen elementen buiten
  beeld, geen invoervelden zonder label, geen knoppen zonder naam.
- Niet getest: echte Supabase-omgeving (o.a. ZIP-download van documenten haalt
  bestanden via signed URLs op — afhankelijk van CORS van Supabase Storage), fysiek
  printen, echte klantbestanden.
