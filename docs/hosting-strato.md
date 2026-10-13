# Infrastructuur VeriPasso (STRATO VPS)

Stand: 2026-10-13 — **live**. Bij storingen: [noodplan.md](noodplan.md). Eén Linux-server met Docker; bestanden en back-ups in
Cloudflare R2; DNS bij Cloudflare. Configuratie in [`deploy/`](../deploy/). Er staan
geen geheimen in dit document.

```
bezoeker ─> Cloudflare DNS ─> STRATO VPS 87.106.4.92 / 2a02:2479:118:ef00::1
                                └─ Caddy :443 (HTTPS) ─> app :3000 ─> PostgreSQL 17
browser ─ upload/download (presigned, 5 min) ─> Cloudflare R2 (EU)
back-up ─ elke nacht 03:15, versleuteld ──────> Cloudflare R2 (EU)
```

## Onderdelen

| Onderdeel | Wat | Details |
|---|---|---|
| Server | STRATO VPS Linux M: 2 vCores, 4 GB, 120 GB, Ubuntu 24.04 LTS | firewall (ufw): alleen 22, 80, 443; inloggen alleen met SSH-sleutel; fail2ban; automatische beveiligingsupdates; 2 GB swap. STRATO-firewall in het klantenpaneel staat **uit** (de server-firewall doet het werk). |
| Containers | `deploy/compose.yaml`: `app`, `db`, `caddy` | starten vanzelf na een herstart; code in `/opt/veripasso` |
| HTTPS | Caddy, Let's Encrypt, automatisch verlengd | TLS 1.2+ (1.1 geweigerd), HTTP/2 en HTTP/3, HSTS; HTTP → HTTPS |
| Database | PostgreSQL 17 in Docker | alleen bereikbaar op het interne Docker-netwerk; migraties draaien bij elke start |
| Bestanden | Cloudflare R2, jurisdictie EU: `veripasso-images`, `veripasso-documents` | privé; CORS alleen `https://app.veripasso.com`; de server heeft een eigen sleutel die alleen bij de VeriPasso-buckets kan |
| Back-ups | `deploy/backup.sh` via cron (03:15) | `pg_dump`, AES-256 versleuteld, 7 dagen op de server (`/var/backups/veripasso`) + kopie naar R2 `veripasso-backups/db`. Terugzetten getest op 2026-10-13. |
| Monitoring | in de app: `/admin/systeemstatus` (Platform Owner) | database, opslag, fouten, snelheid, groei; **capaciteit**: schijf, geheugen, laatste back-up, certificaten, R2 t.o.v. gratis 10 GB. Extern te bewaken via `/api/health/capacity` (503 bij een waarschuwing). |

## Domeinen (Cloudflare DNS, alle "DNS only")

| Domein | Rol |
|---|---|
| `www.veripasso.com` | landingspagina (`veripasso.com` → 301 naar www) |
| `app.veripasso.com` | de SaaS (`/` → `/login`) |
| `qr.veripasso.com` | QR-scans en paspoorten. **Permanent**: staat op elke gedrukte code. Nooit wijzigen of verwijderen. |

Per domein een A-record (`87.106.4.92`) en een AAAA-record (`2a02:2479:118:ef00::1`).
De domeinverdeling regelt de app zelf (`proxy.js`, `src/utils/domainRouting.js`).

## Geheimen: waar ze staan

| Wat | Waar |
|---|---|
| databasewachtwoord, `COOKIE_SECRET`, `MFA_ENCRYPTION_KEY`, R2-sleutel | `/opt/veripasso/deploy/.env` op de server (alleen root) |
| wachtzin back-ups | `/root/.veripasso-backup-pass` op de server **én** in de wachtwoordmanager |
| R2-sleutel voor back-ups | `/root/.config/rclone/rclone.conf` (alleen root) |
| root-wachtwoord (alleen voor de VNC-console) | wachtwoordmanager |

Zonder `MFA_ENCRYPTION_KEY` werken bestaande tweestapsverificaties niet meer en zonder de
back-up-wachtzin zijn back-ups niet terug te zetten: bewaar beide ook buiten de server.

## Beheer

Inloggen: `ssh root@87.106.4.92` (alleen met de SSH-sleutel). Noodtoegang: VNC-console
in het STRATO-klantenpaneel.

```bash
cd /opt/veripasso/deploy
/opt/veripasso/deploy/update.sh          # nieuwe versie van main uitrollen (na groene CI)
docker compose ps                        # status (app moet "healthy" zijn)
docker compose logs -f app               # logs
/opt/veripasso/deploy/backup.sh          # handmatige back-up
df -h; free -h                           # schijf en geheugen
```

**Back-up terugzetten:**
```bash
cd /opt/veripasso/deploy
gpg --batch --passphrase-file /root/.veripasso-backup-pass -d /var/backups/veripasso/<bestand>.dump.gpg > /tmp/restore.dump
docker compose stop app
docker compose exec -T db pg_restore -U veripasso -d veripasso --clean --if-exists < /tmp/restore.dump
docker compose start app && rm /tmp/restore.dump
```
Back-ups op R2 ophalen: `rclone copy r2:veripasso-backups/db/<bestand> /var/backups/veripasso/`.

**Platform Owner aanmaken of resetten:** `SYSTEM_OWNER_*` meegeven aan
`docker compose exec -e … app node scripts/seed-system-owner.js` (niet in `.env` laten staan).

## Kosten

STRATO VPS Linux M (vast maandbedrag) + Cloudflare (DNS gratis; R2 gratis tot 10 GB
opslag, geen kosten voor dataverkeer).

## Nog open

- Externe monitor instellen (bijv. UptimeRobot) op `/api/health` en `/api/health/capacity`.
- Cloudflare vóór `qr.veripasso.com` (paspoortcache + gebundelde scans): klaar in de code, nog niet actief — zie [cloudflare.md](cloudflare.md).
- Eén server = geen automatische uitwijk bij een storing; herstel via de back-ups op R2.
- Infrastructuurbewijs voor de compliance-matrix opnieuw vastleggen (TLS, back-up/restore).

## Opnieuw opbouwen (nieuwe server)

1. Ubuntu 24.04 met de SSH-sleutel; `apt install ufw git gpg rclone fail2ban unattended-upgrades`; ufw 22/80/443; `curl -fsSL https://get.docker.com | sh`.
2. `git clone https://github.com/RobertDev072/dpp-platform.git /opt/veripasso`; `deploy/.env` vanuit `deploy/.env.example` (geheimen met `openssl rand -hex 32`, of de oude waarden uit de wachtwoordmanager).
3. rclone-remote `r2` (provider Cloudflare, endpoint `https://<account-id>.eu.r2.cloudflarestorage.com`), back-up-wachtzin terugzetten, cron `15 3 * * * root /opt/veripasso/deploy/backup.sh`.
4. DNS-records naar het nieuwe IP; `docker compose up -d --build`; laatste back-up terugzetten.
