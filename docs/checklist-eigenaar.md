# Checklist: wat de eigenaar nog moet afmaken

Stand: 2026-10-21. Wat **jij** nog moet doen (of beslissen). Technisch werk dat Claude kan doen
staat erbij als "→ Claude". Afvinken door `[ ]` te vervangen door `[x]`.

## 🔴 Eerst (deze week)

- [ ] **Nieuwe schermen in de browser nalopen** (zijn getest met automatische tests, nog niet
      met de hand bekeken):
      - Product → **QR-code** → kaart **EU-register** (zet bij één testproduct de productgroep op
        *Batterij* om de stappen te zien).
      - Product → **Documenten** → keuzelijst *Zichtbaar voor*.
      - **Bedrijfsinstellingen**: toegangstokens (met *Gebruik*) en EU-verificatiedatums.
- [ ] **Productgroep** invullen bij de 12 bestaande producten (staan nu op *Nog niet bekend*).
- [ ] **Demoproduct opschonen**: product "TEST" van Jansen BV heeft ook naam "TEST",
      categorie "TEST" en SKU "TET" (modelnummer is al aangepast naar JB-2026-A).
- [ ] **Geheime bestanden op het Bureaublad** verwijderen: `Bureaublad\Veripasso - Doc\
      VeriPasso-GEHEIM-gegevens.md` en `.pdf` (staan al in `Documents\VeriPasso`). → Claude kan
      dit doen als je "ja" zegt.
- [ ] **Lege map** `Documents\VeriPasso-Noodpakket` verwijderen (was vergrendeld; venster sluiten
      en dan verwijderen).

## 🟠 Juridisch en organisatie (vóór de eerste betalende klant)

- [ ] **Juridische concepten invullen** (`Documents\VeriPasso\Juridisch (concept)\`): bedrijfsnaam,
      KvK, adres, e-mail, btw, en alle `[BESLUIT]`-punten (bewaartermijnen, aansprakelijkheid,
      wat er met paspoorten gebeurt als een klant opzegt).
- [ ] **Jurist** laten meekijken. Daarna → Claude: pagina's `/privacy` en `/voorwaarden` bouwen en
      de links onderaan de website goed zetten (staan nu op `#`).
- [ ] **Verwerkersovereenkomsten** afsluiten of controleren bij STRATO, Cloudflare en Hetzner
      (controlelijst in `docs/juridisch/subverwerkers.md`).
- [ ] **Beroepsaansprakelijkheidsverzekering**: heb je die? (nodig voor de voorwaarden).
- [ ] **Back-up-dienstverlener** zoeken en contracteren: nodig zodat paspoorten ook bij een
      faillissement van VeriPasso bereikbaar blijven (koppeling is gebouwd, staat uit).
- [ ] **RPO/RTO** met klanten afspreken (nu: max. 1 dag gegevensverlies, herstel binnen uren).
- [ ] **Partnerovereenkomst** (voor certificeerders/wederverkopers).

## 🟠 EU-register (vóór februari 2027, batterijen)

- [ ] **EU Login** aanmaken voor de **testomgeving** van het register
      (http://registry.acc.product-passport.ec.europa.eu/).
- [ ] Daar het **sjabloon** `template.json` en `template.xml` downloaden en aan Claude geven
      → Claude bouwt de echte uploadexport.
- [ ] Controleren of het register bij een **geslaagde** registratie een export met de
      registratienummers (URI's) geeft → dan bouwt Claude een import.
- [ ] Voor klanten met batterijen: zorgen dat ze een **GTIN** (GS1 Nederland) en een **QSeal**
      hebben (checklist voor klanten: `Handleidingen\VeriPasso-Checklist-EU-register-voor-klanten.pdf`).
- [ ] Besluit: wil je **e-mail** (bijv. herinneringen, uitnodigingen)? Nu bewust uit; vraagt een
      maildienst en een aanpassing van de privacyverklaring.

## 🟡 Normen en certificering

- [ ] **Certificeerder**: toetsing tegen EN 18216–18223 (de normteksten zijn niet door AI gelezen
      vanwege de EVS-licentie).
- [ ] Per klant de **productgroep en de geldende EU-regels** vaststellen (gedelegeerde handelingen).
- [ ] **Toegankelijkheid** van de paspoortpagina laten toetsen (WCAG 2.1 AA).

## 🟡 Techniek (→ Claude, op jouw teken)

- [ ] Betrouwbare **storingsmeldingen vanuit Cloudflare** (Telegram; ntfy heeft een dagquotum).
- [ ] Eén keer de **echte omschakeling oefenen** (nieuwe server + DNS, en terug).
- [ ] **Hersteltest** elk kwartaal (volgende: januari 2027).
- [ ] Batterijvelden en openbaarheid per veld (Bijlage XIII), zodra de EU de catalogus publiceert.
- [ ] Koppeling tussen paspoorten bij hergebruik/remanufacturing (lineage).
- [ ] Eigen domein per klant (geen vendor lock-in).
- [ ] Content-Security-Policy, aparte database-rol met minimale rechten, loadtest.
- [ ] Oud **AWS-account** opruimen (alleen jij kunt inloggen).
- [ ] Ongebruikte pakketten `pdfkit` en `autoprefixer` opruimen (optioneel).
