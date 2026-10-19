# Storings- en hersteltest 2026-10-19

Uitgevoerd door Claude (AI) in opdracht van de eigenaar, op de productieomgeving met
demo-data (10 volledig ingevulde producten met foto's, handleidingen, CE-verklaringen,
interne documenten, batches en exemplaren, plus eerdere demo-producten).

## Test 1: STRATO-server plat (app en webserver gestopt, 20:02:57–20:13:27 UTC)

| Wat | Resultaat |
|---|---|
| app.veripasso.com, www.veripasso.com | onbereikbaar (verwacht) |
| QR-paspoort model (`/p/3886E316…`, Bureaustoel Nova) | **200, noodkopie** (`X-VeriPasso-Noodkopie: 1`) |
| QR-paspoort model (`/p/030118D4…`, Autoband EcoGrip) | **200, noodkopie** |
| QR-paspoort exemplaar (`/p/43E61609…`) | **200, noodkopie van het model** (via verwijzing) |
| Machineleesbaar (Accept: application/json) | **200, JSON-noodkopie** met DPP-header |
| Bewaking (Cloudflare Worker) | storing **gedetecteerd** (HTTP 521 op alle checks), maar de pushmelding werd **geweigerd door ntfy.sh** (dagquotum van gedeelde Cloudflare-IP's). **Open: ntfy-account met token nodig** |
| Meldingen vanaf de server (back-up) | werken (eigen IP) |

## Test 2: volledig herstel zonder STRATO (`node scripts/noodherstel.mjs --test`)

Uitgevoerd terwijl STRATO plat lag. Alleen gebruikt: het gegevensdocument (back-up-
wachtzin, Storage Box-sleutel), de Hetzner Storage Box en GitHub.

| Stap | Tijd |
|---|---|
| Nieuwe server bij Hetzner Cloud (cx23, Helsinki) | 20:09:56 → 20:10:29 |
| Software, configuratie, database uit Hetzner | 20:10:34 → 20:11:13 |
| App bouwen en starten, gezond | 20:11:57 |
| Controles | 20:12:26 |
| Server weer verwijderd | 20:12:29 (**totaal 3 minuten**, kosten < € 0,02) |

| Controle | Hersteld | Live (STRATO) |
|---|---|---|
| bedrijven / gebruikers / producten | 2 / 5 / 11 | 2 / 5 / 11 |
| paspoortversies / documenten | 16 / 30 | 16 / 30 |
| batches / exemplaren | 12 / 156 | 12 / 156 |
| hashketen paspoorten | 11 van 11 geldig | — |
| bestanden waarnaar de database verwijst, aanwezig op Hetzner | 50 van 50 | — |

Gebruikte back-up: `veripasso-20261019T195936Z.dump.gpg` en `env-20261019T195936Z.gpg`.
Ruwe uitvoer: `herstel-verslag-2026-10-19.txt` (lokaal, niet in git).

## Test 3: herstel met versleutelde bestanden (20:34–20:38 UTC)

Na het versleutelen van de bestanden op Hetzner (rclone crypt) en het overstappen op een
beperkte R2-sleutel opnieuw `--test`: alle tellingen gelijk, hashketen 11/11, 50/50 bestanden
ontsleuteld aanwezig, en een echt paspoort opgevraagd bij de herstelde app
(`urn:uuid:50cd7183… · Demo Bureaustoel Ergo · 20 velden`). Duur 4 minuten.

## Beperkte sleutels

- Nieuwe R2-sleutel voor de back-up: lezen van `veripasso-images`/`veripasso-documents` (schrijven
  getest: **geweigerd**), schrijven in `veripasso-backups`. De oude sleutel met alle rechten staat niet
  meer op de server.

## Conclusies

- QR-codes blijven werken bij uitval van de server (model, batch, exemplaar; HTML en JSON).
- Alle gegevens zijn binnen enkele minuten volledig te herstellen zonder STRATO.
- **Niet gelukt: de pushmelding bij storing** (ntfy zonder account). Herhalen na instellen
  van een ntfy-account.
- Bij een echte storing: zie [../noodplan.md](../noodplan.md), "Snel: wat ligt eruit en wat doe ik?".

Volgende hersteltest: 2027-01 (elk kwartaal).
