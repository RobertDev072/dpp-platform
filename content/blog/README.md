# Blog van www.veripasso.com

Elk artikel is een Markdown-bestand: `nl/<slug>.md` en de Engelse vertaling in `en/<slug>.md`.
De bestandsnaam is de URL (`/blog/<slug>` en `/en/blog/<slug>`). De pagina's, de sitemap en de
zoekmachinegegevens (schema.org, hreflang) worden bij de build automatisch gemaakt.

## Formaat

```
---
title: Kop van het artikel (max. ±65 tekens, zoekwoord vooraan)
description: Samenvatting voor Google, max. 160 tekens.
date: 2026-10-25
category: nieuws            # nieuws of gids
tags: digitaal productpaspoort, DPP, ESPR
translation: slug-van-de-vertaling
sources:
  - EUR-Lex: Verordening (EU) 2024/1781 | https://eur-lex.europa.eu/eli/reg/2024/1781/oj
---

Tekst in Markdown, met tussenkoppen (##), lijstjes en eventueel een tabel.
```

## Spelregels (ook voor de dagelijkse agent)

1. **Klopt het?** Alleen feiten uit officiële bronnen (EUR-Lex, Europese Commissie,
   Publicatieblad) of betrouwbare vakmedia. Onzeker of nog niet vastgesteld: schrijf
   "verwacht" of "naar verwachting", nooit een harde datum.
2. **Eigen woorden.** Nooit teksten van anderen overnemen. Samenvatten, uitleggen wat het
   betekent voor fabrikanten, importeurs en webshops, en de bron noemen.
3. **Altijd bronnen** onder `sources:` (met https-link). De tests falen zonder bron.
4. **Altijd twee talen**: Nederlands en Engels, met `translation:` naar elkaar.
5. **Geen juridisch advies** beloven; de disclaimer staat automatisch onder elk artikel.
6. **Geen claims over VeriPasso** die niet kloppen: alleen functies die in de app zitten
   (vaste QR-code, versies, volledigheid, toegangsniveaus, registerstatus, EU-opslag,
   downloads als SVG/PNG/Data Matrix).
7. **Interne links**: verwijs waar het past naar `/dpp-check` (`/en/dpp-check`) en naar
   eerdere artikelen.
8. **Publiceren**: via een pull request. Pas na goedkeuring van de eigenaar gaat het live.

Controle: `node --test tests/blog-and-dpp-check.test.js`.
