# Datalekprocedure VeriPasso

> CONCEPT, stand 2026-10-20. Intern document.

Een datalek is een beveiligingsincident waarbij persoonsgegevens verloren gaan, of waarbij
iemand er onbevoegd bij kan (art. 4 lid 12 AVG). Voorbeelden: een gestolen laptop met het
noodpakket, een gelekte sleutel of wachtwoord, een bug waardoor een klant gegevens van een andere
klant ziet, een gehackte server, een back-up die openbaar staat.

**Verantwoordelijke voor deze procedure:** [INVULLEN: naam], bereikbaar via [INVULLEN: telefoon
en e-mail]. Vervanger: [INVULLEN].

## Stap 1. Ontdekken en direct beperken (binnen 1 uur)
- Noteer tijdstip van ontdekking: vanaf dat moment lopen de termijnen.
- Stop het lek: sleutel of wachtwoord intrekken/vervangen, toegang blokkeren, server isoleren.
  - Gelekte API-sleutel: intrekken in VeriPasso (Bedrijf → API-sleutels).
  - Gelekte server- of opslagsleutel: vervangen bij STRATO / Cloudflare / Hetzner; zie het
    geheime gegevensdocument.
  - Verdachte sessies: wachtwoord laten resetten, sessies beëindigen.
- Bewaar bewijs (logboeken, schermafbeeldingen). Niets wissen.

## Stap 2. Beoordelen (binnen 24 uur)
Beantwoord en noteer in het register:
1. Welke gegevens? Hoeveel personen? Van welke klanten?
2. Waren de gegevens versleuteld en is de sleutel veilig? (Dan is het risico meestal klein.)
3. Wat zijn de mogelijke gevolgen voor de betrokkenen (bijv. phishing, misbruik account)?
4. Is het lek gestopt?

## Stap 3. Melden
**VeriPasso als verwerker** (gegevens van klanten): meld de getroffen klanten **binnen
[BESLUIT: 24 of 36] uur** (zie verwerkersovereenkomst artikel 7). De klant beslist over melding
aan de AP.

**VeriPasso als verwerkingsverantwoordelijke** (eigen gegevens, bijv. paspoortbezoekers,
contactpersonen):
- Melden aan de **Autoriteit Persoonsgegevens** binnen **72 uur** na ontdekking, tenzij het
  lek waarschijnlijk geen risico oplevert. Via het meldformulier op autoriteitpersoonsgegevens.nl.
  Ontbreekt informatie, meld dan toch op tijd en vul later aan.
- Melden aan de **betrokkenen** als het lek waarschijnlijk een hoog risico oplevert.

**Twijfel?** Melden. De beslissing om niet te melden moet je kunnen uitleggen; schrijf die
reden op in het register.

**NIS2 / Cyberbeveiligingswet:** [BESLUIT: laten beoordelen of VeriPasso onder de
meldplicht valt; zo ja, ook de toezichthouder/CSIRT binnen 24 uur waarschuwen].

## Stap 4. Herstellen en leren
- Oorzaak oplossen en controleren of het lek echt dicht is.
- Wat gaan we anders doen? Maatregel noteren in het register.
- Klanten informeren over de afloop.

## Contactgegevens
| Wie | Contact |
|---|---|
| Autoriteit Persoonsgegevens | autoriteitpersoonsgegevens.nl → Datalek melden |
| STRATO support | [INVULLEN] |
| Cloudflare support | dash.cloudflare.com → Support |
| Hetzner support | [INVULLEN] |
| Jurist / adviseur | [INVULLEN] |
| Contactpersonen klanten | [INVULLEN: lijst bijhouden of verwijzing] |

---

## Datalekregister
Elk incident hier registreren, ook als het niet gemeld hoeft te worden (art. 33 lid 5 AVG).

| Nr | Datum ontdekking | Wat is er gebeurd | Gegevens en aantal betrokkenen | Gevolgen | Maatregelen | Gemeld aan AP (datum/nr) | Gemeld aan klanten/betrokkenen | Reden als niet gemeld |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
