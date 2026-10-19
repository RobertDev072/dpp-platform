# Verwerkingsregister VeriPasso (art. 30 AVG)

> CONCEPT, stand 2026-10-20. Intern document; op verzoek beschikbaar voor de Autoriteit
> Persoonsgegevens.

**Organisatie:** [INVULLEN: bedrijfsnaam], [INVULLEN: adres], KvK [INVULLEN].
**Contact privacy:** [INVULLEN: naam en e-mail]. Functionaris gegevensbescherming: niet
aangesteld (niet verplicht) [BESLUIT: bevestigen].

## Deel A. Als verwerkingsverantwoordelijke

| # | Verwerking | Doel | Grondslag | Betrokkenen | Gegevens | Ontvangers | Buiten EER | Bewaartermijn | Beveiliging |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Statistiek paspoortbezoeken | klant inzicht geven; misbruik voorkomen | gerechtvaardigd belang | bezoekers van publieke paspoorten | tijdstip, user-agent, verwijzer; dagelijks wisselende anonieme code (niet opgeslagen) | klant (alleen totalen) | nee | 90 dagen, daarna dagtotalen | zie Bijlage 2 verwerkersovereenkomst |
| A2 | Doorsturen en beveiligen van verzoeken | bereikbaarheid en bescherming tegen aanvallen | gerechtvaardigd belang | alle bezoekers | IP-adres, verzoekgegevens | Cloudflare | mogelijk (netwerk) | volgens Cloudflare [INVULLEN] | TLS |
| A3 | Klant- en partnerbeheer | contracten, facturen, contact | overeenkomst; wettelijke plicht (administratie) | contactpersonen klanten/partners | naam, e-mail, telefoon, bedrijf, factuurgegevens | boekhouder [INVULLEN] | nee | 7 jaar (administratie) | [INVULLEN] |
| A4 | Contact en demo-aanvragen | vragen beantwoorden | gerechtvaardigd belang / precontractueel | aanvragers | naam, e-mail, bericht | geen | [INVULLEN: e-mailprovider, bijv. iCloud] | [BESLUIT: 2 jaar] | [INVULLEN] |
| A5 | Beveiligingslogboek beheerders | misbruik van beheertoegang aantonen | gerechtvaardigd belang | platformbeheerders | handelingen, tijdstip | geen | nee | [BESLUIT: 2 jaar] | onveranderlijk logboek |

## Deel B. Als verwerker (namens klanten)

| # | Verantwoordelijke | Categorie verwerking | Subverwerkers | Buiten EER | Beveiliging |
|---|---|---|---|---|---|
| B1 | elke klant met een verwerkersovereenkomst (lijst: [INVULLEN: verwijzing naar klantenlijst]) | gebruikersaccounts, sessies, activiteitenlog, inhoud van productgegevens en documenten, API-sleutels, reservekopieën | STRATO, Cloudflare, Hetzner (zie [subverwerkers.md](subverwerkers.md)) | alleen via Cloudflare-netwerk, met waarborgen | Bijlage 2 verwerkersovereenkomst |

## DPIA
Een gegevensbeschermingseffectbeoordeling is waarschijnlijk niet verplicht: geen bijzondere
gegevens, geen grootschalige monitoring van personen, geen profilering. [BESLUIT: laten
bevestigen en de afweging hier vastleggen]

## Wijzigingen
| Datum | Wijziging | Door |
|---|---|---|
| 2026-10-20 | eerste concept | |
