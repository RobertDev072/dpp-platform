# Privacyverklaring VeriPasso — CONCEPT

> **Concept, niet gepubliceerd.** Opgesteld uit de feitelijke werking van de software
> (stand 2026-10-14). Alles tussen [vierkante haken] moet door VeriPasso (en bij voorkeur
> een jurist) worden ingevuld of bevestigd vóór publicatie. Er zijn geen rechtsgronden of
> bewaartermijnen verzonnen; waar die nog niet besloten zijn, staat dat erbij.

## Wie zijn wij
[Bedrijfsnaam, adres, KvK-nummer, contact voor privacyvragen.]

## Bezoekers van een productpaspoort (QR-code scannen)
- **Wat:** wanneer je een paspoort opent na het scannen van een QR-code, registreren wij
  het tijdstip, het type browser (user-agent) en de verwijzende pagina. Geen naam, geen
  account, **geen IP-adres**.
- **Hoe:** om dubbele tellingen te voorkomen, maken wij tijdelijk een anonieme code van je
  IP-adres en browser met een geheim dat elke dag verandert; die code wordt niet bewaard
  en is na een dag niet meer terug te rekenen.
- **Op je apparaat:** wij plaatsen geen cookies en slaan niets op je apparaat op.
- **Waarom:** de fabrikant van het product inzicht geven in hoe vaak het paspoort wordt
  bekeken. [Rechtsgrond: nog vast te stellen, vermoedelijk gerechtvaardigd belang.]
- **Hoe lang:** 90 dagen; daarna alleen het totale aantal per dag, zonder browsergegevens.

## Gebruikers van de VeriPasso-applicatie
- **Wat:** naam, e-mailadres, rol, bedrijf, wachtwoord (alleen versleuteld/gehasht),
  tweestapsverificatie (versleuteld), optionele profielfoto, sessiegegevens, en een
  auditlog van handelingen (bijv. inloggen, product publiceren).
- **Cookie:** één functionele sessiecookie om ingelogd te blijven (noodzakelijk).
- **Waarom:** het leveren van de dienst en beveiliging. [Rechtsgrond: nog vast te stellen.]
- **Hoe lang:** [nog te besluiten: accounts na beëindiging, auditlog, back-ups].
- **Rol:** [vast te stellen: voor gegevens die klanten in VeriPasso beheren treedt
  VeriPasso vermoedelijk op als verwerker namens de klant.]

## Waar staan de gegevens
- Applicatie en database: STRATO (Duitsland/Nederland, EU).
- Bestanden en back-ups: Cloudflare R2, EU-jurisdictie.
- Netwerk en paspoortcache: Cloudflare (verzoeken kunnen wereldwijd via Cloudflare lopen).
  [Waarborg voor doorgifte: nog te beoordelen.]
- Back-ups zijn versleuteld.

## Je rechten
Inzage, correctie, verwijdering, beperking, bezwaar en overdraagbaarheid: [contact en
procedure]. Klacht indienen kan bij de Autoriteit Persoonsgegevens.
