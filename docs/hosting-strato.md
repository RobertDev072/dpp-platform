# VeriPasso op een STRATO VPS Linux M

Eén Linux-server (2 vCores, 4 GB, 120 GB NVMe) met daarop, in Docker:
de app, PostgreSQL 17 en Caddy (HTTPS met automatische Let's Encrypt-certificaten).
Bestanden (foto's/documenten) optioneel in Cloudflare R2; DNS en de QR-cache bij
Cloudflare. Alle bestanden staan in [`deploy/`](../deploy/).

```
bezoeker ─> Cloudflare (DNS; cache voor qr.) ─> STRATO VPS
                                                  └─ Caddy :443 ─> app :3000 ─> PostgreSQL
bestanden ─> Cloudflare R2        back-ups ─> elke nacht versleuteld naar R2
```

Opdrachten met `ssh` voer je uit op je eigen computer; alle andere opdrachten op de
server (na het inloggen).

## 1. Server bestellen en inloggen

1. Bestel **VPS Linux M** en kies als besturingssysteem **Ubuntu 24.04 LTS**.
2. Maak op je eigen computer (PowerShell) een SSH-sleutel, als je die nog niet hebt:
   ```bash
   ssh-keygen -t ed25519
   ```
   Je publieke sleutel staat dan in `C:\Users\<jij>\.ssh\id_ed25519.pub`.
3. Log in met het root-wachtwoord uit het STRATO-klantenpaneel (IP-adres staat daar ook):
   ```bash
   ssh root@<IP-ADRES>
   ```
4. Zet je publieke sleutel op de server en zet inloggen met wachtwoord uit:
   ```bash
   mkdir -p ~/.ssh && nano ~/.ssh/authorized_keys     # plak de inhoud van id_ed25519.pub
   chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
   ```
   Test in een **tweede** venster dat `ssh root@<IP-ADRES>` zonder wachtwoord werkt. Pas dan:
   ```bash
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```

## 2. Server inrichten (eenmalig)

```bash
apt update && apt -y upgrade
apt -y install unattended-upgrades ufw git gpg rclone
dpkg-reconfigure -f noninteractive unattended-upgrades    # automatische beveiligingsupdates

# Firewall: alleen SSH, HTTP en HTTPS.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

# 2 GB swap: ruimte voor het bouwen van het image op een server met 4 GB.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker (officieel installatiescript van Docker).
curl -fsSL https://get.docker.com | sh
```
Heeft STRATO in het klantenpaneel ook een firewall voor de VPS, zet daar dezelfde poorten
open (22, 80, 443).

## 3. Code en configuratie

```bash
git clone https://github.com/RobertDev072/dpp-platform.git /opt/veripasso
cd /opt/veripasso/deploy
cp .env.example .env
openssl rand -hex 32      # 3x uitvoeren: voor POSTGRES_PASSWORD, COOKIE_SECRET, MFA_ENCRYPTION_KEY
nano .env
chmod 600 .env
```
Vul in `.env` minimaal in: `POSTGRES_PASSWORD`, `COOKIE_SECRET`, `MFA_ENCRYPTION_KEY`,
`ACME_EMAIL` (jouw e-mailadres, voor Let's Encrypt). De domeinen staan al goed.
Bewaar `.env` ook veilig buiten de server (wachtwoordmanager): zonder `MFA_ENCRYPTION_KEY`
werken bestaande tweestapsverificaties niet meer.

## 4. DNS naar de server (Cloudflare)

Cloudflare > veripasso.com > DNS. Vervang de vier CNAME-records (nu naar CloudFront)
door A-records naar het IP-adres van de VPS, allemaal **DNS only** (grijze wolk):

| Naam | Type | Inhoud | Proxy |
|---|---|---|---|
| `@` | A | `<IP-ADRES>` | DNS only |
| `www` | A | `<IP-ADRES>` | DNS only |
| `app` | A | `<IP-ADRES>` | DNS only |
| `qr` | A | `<IP-ADRES>` | DNS only (later eventueel Proxied, zie docs/cloudflare.md) |

Heeft de VPS ook een IPv6-adres, voeg dan voor dezelfde namen AAAA-records toe.
Controleer even later met `nslookup app.veripasso.com` dat het IP van de VPS terugkomt.

## 5. Starten

```bash
cd /opt/veripasso/deploy
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build     # eerste keer 5-10 minuten
docker compose ps                                                # alle drie "running", app "healthy"
docker compose logs --tail=50 app
```
Daarna werken https://app.veripasso.com, https://www.veripasso.com en
https://qr.veripasso.com/p/... (Caddy haalt bij het eerste bezoek de certificaten).
De databasemigraties draaien automatisch bij elke start.

**Platform Owner aanmaken (eenmalig):** vul `SYSTEM_OWNER_*` in `.env`, dan:
```bash
docker compose up -d
docker compose exec app node scripts/seed-system-owner.js
```
Haal de `SYSTEM_OWNER_*`-waarden daarna weer uit `.env` en voer `docker compose up -d` uit.

## 6. Bestanden in Cloudflare R2 (voor foto's en documenten)

Zonder deze stap werkt alles, behalve uploads van foto's en documenten.

1. Cloudflare > R2 > **Create bucket**: `veripasso-images` en `veripasso-documents`
   (locatie Europa / EU-jurisdictie). Beide privé laten.
2. Per bucket > Settings > **CORS policy**:
   ```json
   [{ "AllowedOrigins": ["https://app.veripasso.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3000 }]
   ```
3. R2 > **Manage API tokens** > Create token: *Object Read & Write*, alleen deze twee buckets.
4. In `.env`:
   ```
   S3_ENDPOINT=https://<ACCOUNT-ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_ACCESS_KEY_ID=<access key id>
   S3_SECRET_ACCESS_KEY=<secret access key>
   S3_IMAGES_BUCKET=veripasso-images
   S3_DOCUMENTS_BUCKET=veripasso-documents
   ```
   (Gebruik je de EU-jurisdictie, dan is het endpoint `https://<ACCOUNT-ID>.eu.r2.cloudflarestorage.com`.)
5. `docker compose up -d`. In de app: Systeemstatus > Configuratie toont "Geconfigureerd".

De app overschrijft of verwijdert nooit gekoppelde bestanden, dus extra versiebeheer op
deze buckets is niet nodig.

## 7. Back-ups (elke nacht, versleuteld, buiten de server)

1. Wachtzin voor de versleuteling (bewaar hem ook in je wachtwoordmanager):
   ```bash
   openssl rand -base64 32 > /root/.veripasso-backup-pass && chmod 600 /root/.veripasso-backup-pass
   ```
2. Cloudflare R2: bucket `veripasso-backups` + een API-token (*Object Read & Write*, alleen die
   bucket). Optioneel: bucket > Settings > Object lifecycle: verwijderen na 30 dagen.
3. rclone instellen (remote-naam **r2**):
   ```bash
   rclone config create r2 s3 provider Cloudflare access_key_id <KEY> secret_access_key <SECRET> endpoint https://<ACCOUNT-ID>.r2.cloudflarestorage.com no_check_bucket true
   ```
4. Uitvoerbaar maken, eerste back-up en dagelijks inplannen:
   ```bash
   chmod +x /opt/veripasso/deploy/*.sh
   /opt/veripasso/deploy/backup.sh
   echo '15 3 * * * root /opt/veripasso/deploy/backup.sh >> /var/log/veripasso-backup.log 2>&1' > /etc/cron.d/veripasso-backup
   ```
Daarnaast kun je bij STRATO snapshots/back-ups van de hele VPS aanzetten (als je pakket dat biedt).

**Terugzetten** (bijv. na een fout):
```bash
cd /opt/veripasso/deploy
gpg --batch --passphrase-file /root/.veripasso-backup-pass -d /var/backups/veripasso/<bestand>.dump.gpg > /tmp/restore.dump
docker compose stop app
docker compose exec -T db pg_restore -U veripasso -d veripasso --clean --if-exists < /tmp/restore.dump
docker compose start app && rm /tmp/restore.dump
```
Test dit één keer, zodat je weet dat de back-up werkt.

## 8. Nieuwe versie uitrollen

Na een push naar `main` (en een groene CI):
```bash
/opt/veripasso/deploy/update.sh
```
Haalt de code op, bouwt het image, herstart en wacht tot de app gezond is.

## 9. Controleren en onderhoud

- `docker compose ps` / `docker compose logs -f app`: status en logs.
- `df -h` en `free -h`: schijf en geheugen.
- Systeemstatus in de app (als Platform Owner): database, opslag, fouten, snelheid.
- Gratis uptime-check (bijv. UptimeRobot) op `https://app.veripasso.com/api/health`.
- Ubuntu-beveiligingsupdates gaan automatisch; af en toe `apt upgrade` en een herstart
  (`reboot`; de containers starten vanzelf weer).

## 10. Cloudflare vóór qr.veripasso.com (later)

Zie [docs/cloudflare.md](cloudflare.md). Op deze server: `SYNC_URL` in de Worker wordt
`https://app.veripasso.com/api/edge/sync`, en zet `EDGE_SYNC_TOKEN` in `.env`. Zet in
Cloudflare **"Always Use HTTPS" uit** voor qr (Caddy stuurt zelf door naar HTTPS en heeft
poort 80 nodig om zijn certificaat te verlengen).
