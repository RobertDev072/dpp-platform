# Infrastructuur VeriPasso

Stand: 2026-10-18 · live versie: zie `git log` op `main` (uitgerold met `deploy/update.sh`).
Dit document beschrijft **hoe alles in elkaar zit**. Geen wachtwoorden of sleutels: die staan
alleen in het beveiligde gegevensdocument (buiten deze repository). Bij storingen:
[noodplan.md](noodplan.md). Serverbeheer in detail: [hosting-strato.md](hosting-strato.md).

## 1. In één plaatje

```
                          ┌───────────────────────── Cloudflare ─────────────────────────┐
  Scanner (telefoon)  ──► │ DNS · qr.veripasso.com: Worker (cache 2 u, noodkopie, scans) │
  Extern systeem (API) ─► │ R2 (EU): foto's, documenten, noodkopieën, back-upkopie       │
                          └──────────────┬───────────────────────────────────────────────┘
  Gebruiker (browser) ───────────────────┤  www / app.veripasso.com: rechtstreeks
                                         ▼
                ┌──────────────── STRATO VPS (Duitsland), Docker ────────────────┐
                │ Caddy (HTTPS, Let's Encrypt) ─► app (Next.js + Express, Node 24)│
                │                                   │                             │
                │                                   ▼                             │
                │                          PostgreSQL 17 (alle gegevens)         │
                │ cron 03:15 UTC: back-up ─► server (7 d) · R2 · Hetzner          │
                └─────────────────────────────────────────────────────────────────┘
                                         │ elke nacht
                                         ▼
                ┌──── Hetzner Storage Box (Helsinki, Finland) ────┐
                │ database · configuratie · alle foto's/documenten │
                │ + 10 dagelijkse snapshots (niet te wissen)       │
                └──────────────────────────────────────────────────┘

  GitHub: code + CI (tests op PostgreSQL 17, build, beveiligingscontrole, container-rooktest)
```

## 2. Onderdelen

| Onderdeel | Aanbieder / plek | Rol |
|---|---|---|
| Domeinen + DNS | Cloudflare (zone `veripasso.com`) | `www`/`veripasso.com` landingspagina, `app` de applicatie, `qr` de paspoorten (staat op elke gedrukte code: **nooit wijzigen**) |
| Rand voor `qr.veripasso.com` | Cloudflare Worker `veripasso-qr-edge` + Durable Object | paspoortpagina 2 uur in cache (ververst bij elke wijziging), noodkopie bij serveruitval, scans gebundeld; "fail open": werkt de Worker niet, dan gaat alles naar de server. Zie [cloudflare.md](cloudflare.md) |
| Server | STRATO VPS Linux M (4 GB, 116 GB), Ubuntu, Docker | containers `caddy`, `app`, `db`; alleen poort 22/80/443 open; inloggen alleen met SSH-sleutel; fail2ban en automatische updates |
| Applicatie | container `app` (`Dockerfile`, Node 24) | website, app en API; migraties draaien automatisch bij het starten; achtergrondtaken (monitoring, noodkopieën, scans, back-up-dienstverlener/EU-register) |
| Database | container `db` (PostgreSQL 17), geen poort naar buiten | alle gegevens: bedrijven, gebruikers, producten, paspoorten + onveranderbaar versiearchief, batches, exemplaren, API-sleutels, auditlog |
| Bestanden | Cloudflare R2, EU-jurisdictie, privé buckets | `veripasso-images` (foto's, logo's), `veripasso-documents` (pdf's); noodkopieën van paspoorten |
| HTTPS | Caddy + Let's Encrypt (automatisch verlengd); Cloudflare voor `qr` | minimaal TLS 1.2 (TLS 1.0/1.1 geweigerd), HTTP/2, HSTS |
| Back-ups | `deploy/backup.sh` (cron 03:15 UTC) | zie §4 |
| Code en CI | GitHub `RobertDev072/dpp-platform` | elke push: tests, build, `npm audit`, image bouwen en starten |

Geen e-mail, betalingen of analytics van derden. De paspoortpagina zet geen cookies.

## 3. Hoe een verzoek loopt

- **QR-code scannen**: telefoon → `qr.veripasso.com/p/{ID}` → Cloudflare Worker → uit cache, of
  van de server (Caddy → app → database). Server onbereikbaar of traag (> 6 s)? Dan toont de
  Worker de **noodkopie** uit R2. Batch- en itemcodes verwijzen daarbij naar de noodkopie van
  het model. De pagina meldt de scan (1× per apparaat per 30 min, geen IP).
- **GS1 Digital Link**: `qr.veripasso.com/01/{GTIN}[/10/{lot}][/21/{serie}]` → resolver →
  doorverwijzing naar het meest specifieke paspoort (exemplaar → batch → model).
- **Machineleesbaar**: dezelfde URL met `Accept: application/json` (of JSON-LD, XML), of de
  B2B-API `/api/v1` ([api-v1.md](api-v1.md)); lezen zonder sleutel, schrijven met API-sleutel.
- **Ingelogde gebruiker**: `app.veripasso.com` → Caddy → app; uploads gaan rechtstreeks van de
  browser naar R2 met een eenmalige, getekende link.
- **Wijziging aan een paspoort**: opgeslagen in de database → nieuwe archiefversie (hashketen)
  → cache van model, batches en exemplaren ververst → noodkopie binnen ±2 minuten bijgewerkt.

## 4. Back-ups en herstel

| Kopie | Wat | Waar | Bewaard |
|---|---|---|---|
| 1 | database (versleuteld, AES-256) | server `/var/backups/veripasso` | 7 dagen |
| 2 | database (versleuteld) | Cloudflare R2 `veripasso-backups/db` | onbeperkt |
| 3 | database + configuratie + **alle foto's en documenten** (alles versleuteld; bestanden met rclone crypt, sleutel = back-up-wachtzin) | Hetzner Storage Box, Helsinki (SFTP poort 23, map `veripasso/`) | dumps en configuratie 30 dagen; bestanden onbeperkt; plus 10 dagelijkse snapshots |

- Elke nacht 03:15 UTC (05:15 NL), ook vlak vóór elke uitrol.
- Bestanden naar Hetzner met `rclone copy`: wat in R2 verdwijnt, blijft op Hetzner staan.
- Hetzner-snapshots zijn vanaf de server **niet** te wissen: bescherming tegen een hack.
- De back-up gebruikt een **beperkte R2-sleutel**: lezen van foto's/documenten, schrijven alleen in de back-upbucket.
- **Bewaking**: Cloudflare Worker controleert elke 5 min app, database, website, noodkopieën en capaciteit; pushmelding via ntfy. backup.sh meldt elke fout ook direct.
- **Noodherstel in stappen** (niets automatisch): `node scripts/noodherstel.mjs` (diagnose) → `--repair` (STRATO herstarten) → `--new-server` → `--switch-dns <IP>`, elk met bevestiging; zie noodplan. Proef: `--test`.
- Status in **Systeemstatus** (tegel "Laatste back-up"; waarschuwing als een kopie mislukt).
- **Nodig om te herstellen**: de back-up-wachtzin (gegevensdocument) en toegang tot de opslag.
- **Hersteltests**: 2026-10-13 (vanaf de server), 2026-10-18 (vanaf Hetzner) en **2026-10-19: volledig
  op een nieuwe server zonder STRATO, in 3 minuten, alles gelijk aan live** ([verslag](verification/hersteltest-2026-10-19.md)). Elk kwartaal herhalen.
- Maximaal dataverlies (RPO): 1 dag. Hersteltijd (RTO): enkele uren op een nieuwe server.
  (Nog vast te leggen als afspraak met klanten.)

Scenario's (server weg, database kapot, STRATO én Cloudflare weg, hack): [noodplan.md](noodplan.md).

## 5. Beveiliging in het kort

- Server: alleen 22/80/443, SSH alleen met sleutel, geen wachtwoordlogin, fail2ban, firewall.
- Database alleen op het interne Docker-netwerk; geheimen alleen in `deploy/.env` (rechten 600).
- App: rollen en bedrijfsscheiding server-side (getest), MFA beschikbaar, rate limits,
  invoercontrole, auditlog, uploads gecontroleerd op type en grootte.
- API-sleutels: alleen als SHA-256 opgeslagen, eenmalig zichtbaar, intrekbaar.
- Back-ups versleuteld; derde kopie bij een andere partij in een ander land.

## 6. Kosten (maandelijks, indicatief)

| Post | Ongeveer |
|---|---|
| STRATO VPS Linux M | volgens STRATO-contract |
| Cloudflare (DNS, Worker, R2) | gratis laag; R2 per GB boven 10 GB |
| Hetzner Storage Box BX11 (1 TB) | € 3,87 |
| GitHub | gratis |

## 7. Beheer in de praktijk

| Taak | Hoe |
|---|---|
| Nieuwe versie live zetten | op de server `/opt/veripasso/deploy/update.sh` (maakt eerst een back-up, bouwt, herstart, controleert gezondheid) |
| Terug naar vorige versie | [noodplan.md](noodplan.md) scenario 3 |
| Gezondheid | `https://app.veripasso.com/api/health`, Systeemstatus in de app |
| Logs | `docker compose logs app` in `/opt/veripasso/deploy` |
| Worker bijwerken | `cd edge/cloudflare && npx wrangler deploy` |
| Back-up handmatig | `/opt/veripasso/deploy/backup.sh` |

## 8. Wat nog ontbreekt (infra)

- Pushmeldingen betrouwbaar maken: ntfy-account met token (zonder account weigert ntfy berichten vanaf Cloudflare).
- Afspraken RPO/RTO vastleggen; hersteltest elk kwartaal inplannen.
- Back-up-dienstverlener voor paspoorten (gebouwd, staat uit tot er een partij is; zie
  [eu-register-en-backup.md](eu-register-en-backup.md)).
- Content-Security-Policy-header; loadtest.
