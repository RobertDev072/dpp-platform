#!/usr/bin/env bash
# Noodherstel: zet VeriPasso volledig terug op een LEGE Ubuntu 24.04-server, uitsluitend
# vanuit de Hetzner Storage Box (configuratie, database) en de code op GitHub. Werkt zonder
# de oude STRATO-server. Zie docs/noodplan.md, scenario 5b.
#
# Nodig op deze server (de wizard scripts/noodherstel.mjs zet ze klaar):
#   /root/.veripasso-backup-pass         back-up-wachtzin (gegevensdocument, hoofdstuk 4)
#   /root/.ssh/veripasso_backup_ed25519  SSH-sleutel van de Storage Box (gegevensdocument, 8b)
#
# Gebruik (als root):
#   bash recover.sh            echt herstel: app + HTTPS (Caddy) + nachtelijke back-up
#   bash recover.sh --test     hersteltest: geen HTTPS, geen achtergrondtaken, geen back-ups;
#                              controleert alleen of alle gegevens volledig terug zijn
# Optioneel: STORAGEBOX=u694623@u694623.your-storagebox.de  REPO=https://github.com/...
set -Eeuo pipefail

MODE=live
[ "${1:-}" = "--test" ] && MODE=test
STORAGEBOX=${STORAGEBOX:-u694623@u694623.your-storagebox.de}
REPO=${REPO:-https://github.com/RobertDev072/dpp-platform.git}
DIR=/opt/veripasso
KEY=/root/.ssh/veripasso_backup_ed25519
PASSFILE=/root/.veripasso-backup-pass
START=$(date +%s)
REPORT=/root/herstel-verslag.txt
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$REPORT"; }
trap 'log "FOUT op regel $LINENO: herstel afgebroken"' ERR

: > "$REPORT"
log "Noodherstel VeriPasso gestart (modus: $MODE) op $(hostname) $(curl -s -m 5 https://api.ipify.org || true)"
[ -s "$PASSFILE" ] || { log "Back-up-wachtzin ontbreekt: $PASSFILE"; exit 1; }
[ -s "$KEY" ] || { log "Storage Box-sleutel ontbreekt: $KEY"; exit 1; }
chmod 600 "$PASSFILE" "$KEY"

log "1/7 Software installeren (Docker, rclone, gpg)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 rclone gnupg git curl >/dev/null
systemctl enable --now docker >/dev/null

log "2/7 Verbinding met de Hetzner Storage Box"
rclone config create hetzner sftp host="${STORAGEBOX#*@}" port=23 user="${STORAGEBOX%@*}" key_file="$KEY" >/dev/null
rclone lsf hetzner:veripasso/ >/dev/null
# Versleutelde bestanden (foto's, documenten): zelfde sleutel als de back-ups.
rclone config create hetzner-crypt crypt remote=hetzner:veripasso/files-enc \
  password="$(rclone obscure "$(head -n1 "$PASSFILE")")" filename_encryption=standard directory_name_encryption=true >/dev/null

log "3/7 Code ophalen ($REPO)"
rm -rf "$DIR"
if ! git clone -q --depth 1 "$REPO" "$DIR" 2>/dev/null; then
  # GitHub onbereikbaar: de reservekopie van de code op de Storage Box (backup.sh, elke nacht).
  log "    GitHub onbereikbaar; code uit de reservekopie op Hetzner"
  mkdir -p "$DIR" && rclone cat hetzner:veripasso/code/veripasso-code.tar.gz | tar -xz -C "$DIR"
  git -C "$DIR" init -q && git -C "$DIR" add -A && git -C "$DIR" -c user.email=herstel@veripasso -c user.name=herstel commit -qm "reservekopie" || true
fi
cd "$DIR/deploy"

log "4/7 Configuratie (.env) uit Hetzner ontsleutelen"
CFG=$(rclone lsf hetzner:veripasso/config | sort | tail -1)
rclone copyto "hetzner:veripasso/config/$CFG" /tmp/env.gpg
gpg --batch --quiet --passphrase-file "$PASSFILE" -d /tmp/env.gpg > .env
rm -f /tmp/env.gpg && chmod 600 .env
log "    configuratie: $CFG"
if [ "$MODE" = test ]; then
  # Testserver: geen HTTPS-certificaten aanvragen, niets naar R2 of externe partijen.
  sed -i -E 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' .env
  printf '\nBACKGROUND_JOBS=off\nBACKUP_DPP_PROVIDER_URL=\nEU_DPP_REGISTRY_URL=\n' >> .env
fi
mkdir -p /var/lib/veripasso-status /var/backups/veripasso

log "5/7 Database terugzetten uit de laatste dump"
DUMP=$(rclone lsf hetzner:veripasso/db | sort | tail -1)
rclone copyto "hetzner:veripasso/db/$DUMP" /tmp/db.dump.gpg
gpg --batch --quiet --passphrase-file "$PASSFILE" -d /tmp/db.dump.gpg > /tmp/db.dump
docker compose up -d --wait db >/dev/null 2>&1
docker compose exec -T db pg_restore -U veripasso -d veripasso --clean --if-exists --no-owner < /tmp/db.dump 2>/tmp/restore.err || true
grep -v "does not exist, skipping" /tmp/restore.err | grep -i error | head -5 | tee -a "$REPORT" || true
rm -f /tmp/db.dump /tmp/db.dump.gpg
log "    dump: $DUMP"

log "6/7 App bouwen en starten (enkele minuten)"
docker compose up -d --build --wait --wait-timeout 600 app >/dev/null 2>&1
curl -fsS http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1 || docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1))"
log "    app gezond"

log "7/7 Controle van de herstelde gegevens"
SQL() { docker compose exec -T db psql -U veripasso -d veripasso -tAc "$1"; }
log "    bedrijven $(SQL 'SELECT count(*) FROM dbo.companies') · gebruikers $(SQL "SELECT count(*) FROM dbo.users WHERE status<>'deleted'") · producten $(SQL 'SELECT count(*) FROM dbo.products') · gepubliceerd $(SQL "SELECT count(*) FROM dbo.products WHERE status='published'")"
log "    paspoortversies $(SQL 'SELECT count(*) FROM dbo.passportversions') · documenten $(SQL 'SELECT count(*) FROM dbo.documents') · batches $(SQL 'SELECT count(*) FROM dbo.productbatches') · exemplaren $(SQL 'SELECT count(*) FROM dbo.productitems')"
# Hashketen van elk paspoort (integriteit van het archief).
docker compose exec -T app node -e "
const a=require('/app/src/services/passportArchive.service');const {getPool}=require('/app/src/config/db');
(async()=>{const ids=(await (await getPool()).query('SELECT DISTINCT product_id FROM dbo.passportversions')).rows.map(r=>r.product_id);
let bad=0;for(const id of ids){const r=await a.verifyChain(id);if(!r.valid)bad++;}
console.log('    hashketen: '+(ids.length-bad)+' van '+ids.length+' paspoorten geldig');process.exit(bad?1:0)})()" 2>/dev/null | tee -a "$REPORT"
# Bestaat elk bestand waar de database naar verwijst, op de Hetzner-kopie?
LIST=$(mktemp)
SQL "SELECT 'veripasso-images/'||photo_blob_name FROM dbo.products WHERE photo_blob_name IS NOT NULL UNION ALL SELECT 'veripasso-images/'||photo_thumb_blob_name FROM dbo.products WHERE photo_thumb_blob_name IS NOT NULL UNION ALL SELECT 'veripasso-documents/'||blob_name FROM dbo.documents WHERE blob_name IS NOT NULL" > "$LIST"
TOTAL=$(grep -c . "$LIST" || true); MISSING=0
while read -r f; do [ -n "$f" ] || continue; [ -n "$(rclone lsf "hetzner-crypt:$f" 2>/dev/null)" ] || MISSING=$((MISSING+1)); done < "$LIST"
rm -f "$LIST"
log "    bestanden: $((TOTAL-MISSING)) van $TOTAL waar de database naar verwijst staan op Hetzner"
# Een echt paspoort opvragen bij de herstelde app (zoals een scanner of extern systeem).
PID=$(SQL "SELECT public_id FROM dbo.products WHERE status='published' ORDER BY id LIMIT 1")
if [ -n "$PID" ]; then
  OUT=$(docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/dpp/$PID',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>console.log(j.digitalProductPassportId+' · '+j.product.name+' · '+j.dataElements.length+' velden'))" 2>/dev/null || echo "MISLUKT")
  log "    paspoort opgevraagd: $OUT"
fi

if [ "$MODE" = live ]; then
  log "Beveiliging: firewall (alleen 22/80/443), fail2ban, automatische updates"
  apt-get install -y -qq ufw fail2ban unattended-upgrades >/dev/null
  ufw --force reset >/dev/null; ufw default deny incoming >/dev/null; ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null; ufw --force enable >/dev/null
  sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh || true
  systemctl enable --now fail2ban unattended-upgrades >/dev/null 2>&1 || true

  log "Back-up inrichten (R2-koppeling met de opslagsleutel uit .env, nachtelijke cron)"
  set -a; . ./.env; set +a
  rclone config create r2 s3 provider=Cloudflare access_key_id="$S3_ACCESS_KEY_ID" secret_access_key="$S3_SECRET_ACCESS_KEY" \
    endpoint="$S3_ENDPOINT" no_check_bucket=true >/dev/null
  echo "15 3 * * * root /opt/veripasso/deploy/backup.sh >> /var/log/veripasso-backup.log 2>&1" > /etc/cron.d/veripasso-backup
  # Deze server wordt de actieve: een oude server (STRATO) uploadt daarna geen back-ups meer.
  cat /etc/machine-id | rclone rcat hetzner:veripasso/ACTIVE_SERVER
  log "    deze server is nu de actieve back-upserver (veripasso/ACTIVE_SERVER)"

  docker compose up -d caddy >/dev/null 2>&1 || true
  log "Nog niet gedaan: DNS. Controleer dit verslag; daarna op je pc: node scripts/noodherstel.mjs --switch-dns <IP>"
fi
log "Klaar in $(( ($(date +%s) - START) / 60 )) min $(( ($(date +%s) - START) % 60 )) s. Verslag: $REPORT"
