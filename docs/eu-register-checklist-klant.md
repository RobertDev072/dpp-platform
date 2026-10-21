# Checklist EU DPP-register voor klanten

Voor bedrijven die hun productpaspoorten bij het EU DPP-register willen registreren. Bron:
*DPP Registry User Guide for Economic Operators* v1.03 (Europese Commissie, 2026-09-16).
Het registreren doet het bedrijf zelf; VeriPasso host het paspoort en levert de gegevens.

## 1. Vooraf regelen
- [ ] **EU Login**-account voor de persoon die het bedrijf gaat inschrijven
      (https://registry.product-passport.ec.europa.eu/ stuurt automatisch door).
- [ ] **Gekwalificeerd elektronisch zegel (QSeal)** op naam van het bedrijf, bij een
      gekwalificeerde vertrouwensdienstverlener (QTSP) uit de EU-vertrouwenslijst
      (https://eidas.ec.europa.eu/efda/trust-services/browse/eidas/tls). Eenmanszaak: een
      gekwalificeerde elektronische handtekening (QES).
- [ ] Het zegel moet op een **USB-token/smartcard van de QTSP** staan of via **remote signing
      van de QTSP** werken. Een certificaat als bestand (.p12/.pfx) is **niet** genoeg: dat geeft
      alleen een "advanced" handtekening en wordt afgewezen.
- [ ] Gegevens in het certificaat noteren (Subject): **organizationName** (O),
      **countryName** (C) en **organizationIdentifier**. Bij QES: givenName, surname,
      countryName en serialNumber.

## 2. Bedrijf inschrijven en verifiëren
- [ ] *Enrol New Organisation* → rechtspersoon of natuurlijk persoon.
- [ ] Officiële naam, adres en land **exact zoals in het certificaat**. Identificatie bij
      voorkeur NTR (KvK-nummer), anders LEI, btw-nummer of eID. Het nummer moet volledig
      overeenkomen met het certificaat.
- [ ] Contact voor compliance (e-mail en telefoon; niet openbaar).
- [ ] Wettelijk vertegenwoordiger invullen → *Request Declaration* → PDF downloaden.
- [ ] De PDF **ongewijzigd** zegelen/ondertekenen in **PAdES**-formaat (Baseline B, T, LT of
      LTA). Adobe Acrobat: *Voorkeuren → Handtekeningen → Maken en weergave → Meer* →
      standaardindeling **CAdES-equivalent**. Alternatief: de gratis DSS-app van de Commissie.
- [ ] Controleren met de DSS-validatiesite: formaat PAdES-BASELINE en kwalificatie
      **QESeal** (bedrijf) of **QESig** (persoon). Staat er AdESeal-QC/AdESig-QC: QTSP bellen.
- [ ] PDF uploaden (alleen PDF, bestandsnaam max. 100 tekens) → *Verify your Organisation*.
- [ ] Status volgen in het **Activity Dashboard**. Afgewezen: het foutrapport noemt per veld
      wat niet klopt.

## 3. Paspoorten registreren
- [ ] In VeriPasso: product → tabblad QR-code → *EU DPP-register* → **UPI controleren**.
- [ ] Gegevens overnemen (UPI, model-ID, batch-ID) of de CSV per exemplaar downloaden
      (delen van max. 100). Batterijen: alleen per exemplaar (*item*).
- [ ] In het register: *DPP Registration* → formulier (1 paspoort) of bestand (max. 100,
      JSON/XML volgens het sjabloon van het register; bestandsnaam alleen letters, cijfers,
      punt, underscore en koppelteken).
- [ ] Correlation ID noteren; na afloop de **URI** (bij succes) of de foutmelding in VeriPasso
      vastleggen (*Uitkomst uit het register vastleggen*).

## Let op
- Eén fout in een bestand keurt het hele bestand af.
- Stand september 2026: registratie van batterijpaspoorten lukt nog niet, omdat de
  semantische catalogus van de EU ontbreekt. Oefenen kan in de testomgeving
  (http://registry.acc.product-passport.ec.europa.eu/, apart EU Login-account nodig).
- Helpdesk van de Commissie: EC-HELPDESK-DPP@ec.europa.eu, +32 22960431 (ma-vr 8-20 uur).
