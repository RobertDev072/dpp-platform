# Subverwerkers VeriPasso

> CONCEPT, stand 2026-10-20. Het eerste deel kan openbaar (bijv. als pagina of bijlage bij de
> verwerkersovereenkomst). Het tweede deel is een interne controlelijst.

## Lijst
| Subverwerker | Dienst | Gegevens | Locatie | Waarborg buiten EER |
|---|---|---|---|---|
| STRATO GmbH (Berlijn, Duitsland) | VPS: applicatie en database | alle gegevens van de dienst | Duitsland | n.v.t. |
| Cloudflare, Inc. (VS), via Cloudflare Ireland/EU-entiteit [INVULLEN: controleren] | DNS, TLS, beveiliging, cache en noodkopie van publieke paspoorten (Workers), bestandsopslag R2 en versleutelde reservekopie | publieke paspoortinhoud, foto's en documenten, versleutelde back-ups; verzoekgegevens (IP-adres) bij het doorsturen | R2: EU-jurisdictie; netwerk: wereldwijd | EU-US Data Privacy Framework en modelcontractbepalingen [INVULLEN: controleren] |
| Hetzner Online GmbH (Gunzenhausen, Duitsland) | Storage Box (versleutelde reservekopieën); Cloud alleen tijdelijk bij herstel(test) | versleutelde back-ups | Finland [INVULLEN: controleren locatie Storage Box] | n.v.t. |
| ntfy.sh [INVULLEN: exploitant] | storingsmeldingen naar de beheerder | geen persoonsgegevens van klanten (alleen technische meldingen) | [INVULLEN] | n.v.t. als er geen persoonsgegevens in meldingen staan |
| GitHub, Inc. (VS) | opslag broncode en automatische tests | geen klantgegevens (alleen code en testgegevens) | VS | geen persoonsgegevens van klanten |

GitHub en ntfy verwerken geen persoonsgegevens van klanten en zijn daarom strikt genomen geen
subverwerker; ze staan hier voor de volledigheid. [BESLUIT: laten staan of weglaten]

Geen e-mailprovider: VeriPasso verstuurt geen e-mails (uitnodigingslinks worden handmatig
gedeeld).

## Interne controlelijst leveranciers
Per leverancier vastleggen en jaarlijks herhalen:

| Leverancier | Verwerkersovereenkomst/DPA gesloten of geaccepteerd? | Waar te vinden | Locatie gecontroleerd | Datum controle |
|---|---|---|---|---|
| STRATO | [INVULLEN: ja/nee] (STRATO-klantpaneel → AVG/ Auftragsverarbeitung) | [INVULLEN] | [INVULLEN] | [INVULLEN] |
| Cloudflare | [INVULLEN] (Cloudflare DPA, geldt via de Self-Serve Subscription Agreement) | [INVULLEN] | R2-bucket op EU-jurisdictie: [INVULLEN] | [INVULLEN] |
| Hetzner | [INVULLEN] (Hetzner Robot/Console → Auftragsverarbeitung afsluiten) | [INVULLEN] | [INVULLEN] | [INVULLEN] |

Wijzigt de lijst, dan klanten minimaal [BESLUIT: 30 dagen] vooraf informeren (zie
verwerkersovereenkomst artikel 4).
