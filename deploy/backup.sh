#!/usr/bin/env bash
# Dagelijkse database-back-up: versleutelde dump, lokaal 7 dagen bewaard en (als rclone
# is ingesteld) een kopie naar Cloudflare R2, buiten de server. Zie docs/hosting-strato.md.
#
#   sudo /opt/veripasso/deploy/backup.sh          (handmatig)
#   cron: 15 3 * * * root /opt/veripasso/deploy/backup.sh >> /var/log/veripasso-backup.log 2>&1
#
# Vereist: /root/.veripasso-backup-pass (wachtzin, chmod 600). Zonder die wachtzin
# is een back-up niet terug te zetten: bewaar hem ook buiten de server.
# Optioneel: rclone-remote "r2" (rclone config) en RCLONE_TARGET, bijv. r2:veripasso-backups/db
# Optioneel: rclone-remote "hetzner" (Hetzner Storage Box, SFTP poort 23) voor de derde kopie,
# volledig los van STRATO en Cloudflare. Zie docs/noodplan.md.
set -Eeuo pipefail

cd "$(dirname "$0")"

# Pushmelding via ntfy (geheim onderwerp in /root/.veripasso-ntfy; zelfde kanaal als de
# Cloudflare-bewaking). Elke fout in dit script levert direct een melding op.
notify() {
  local topic
  topic=$(cat /root/.veripasso-ntfy 2>/dev/null || true)
  [ -n "$topic" ] || return 0
  curl -s -m 15 -H "Title: $1" -H "Priority: ${3:-high}" -H "Tags: ${4:-rotating_light}" -d "$2" "https://ntfy.sh/$topic" >/dev/null || true
}
trap 'notify "BACK-UP MISLUKT" "deploy/backup.sh stopte met een fout (regel $LINENO). Zie /var/log/veripasso-backup.log en noodplan."' ERR
PASSFILE=/root/.veripasso-backup-pass
TARGET_DIR=/var/backups/veripasso
RCLONE_TARGET=${RCLONE_TARGET:-r2:veripasso-backups/db}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$TARGET_DIR/veripasso-$STAMP.dump.gpg"

[ -s "$PASSFILE" ] || { echo "Wachtzin ontbreekt: $PASSFILE"; exit 1; }
mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"

# pg_dump in de databasecontainer (custom-formaat, gecomprimeerd), meteen versleuteld.
docker compose exec -T db pg_dump -U veripasso -d veripasso -Fc \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASSFILE" -o "$FILE"

# Een lege of half geschreven dump is geen back-up.
[ "$(stat -c %s "$FILE")" -gt 1024 ] || { echo "Back-up te klein: $FILE"; exit 1; }
echo "$(date -u +%FT%TZ) back-up gemaakt: $FILE ($(du -h "$FILE" | cut -f1))"

OFFSITE=false
OFFSITE_BYTES=0
if command -v rclone >/dev/null && rclone listremotes | grep -q "^${RCLONE_TARGET%%:*}:"; then
  rclone copy "$FILE" "$RCLONE_TARGET"
  echo "$(date -u +%FT%TZ) gekopieerd naar $RCLONE_TARGET"
  OFFSITE=true
  OFFSITE_BYTES=$(rclone size --json "$RCLONE_TARGET" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
else
  echo "LET OP: geen rclone-remote ingesteld; back-up staat alleen op deze server."
fi

find "$TARGET_DIR" -name 'veripasso-*.dump.gpg' -mtime +7 -delete

# --- derde kopie: Hetzner Storage Box (andere partij, ander land) ---------------------------
# Database-dump, versleutelde configuratie en ALLE bestanden uit R2 (foto's, documenten).
# Alleen "copy" (nooit "sync"): wat in R2 verdwijnt, blijft op de Storage Box staan.
# Daarnaast maakt Hetzner zelf dagelijkse snapshots die vanaf deze server niet te wissen zijn.
THIRD=null
THIRD_TARGET=${THIRD_TARGET:-hetzner:veripasso}
# Elke stap expliciet met || return: "set -e" geldt niet binnen een if-voorwaarde.
third_copy() {
  local envfile="$TARGET_DIR/env-$STAMP.gpg" bucket
  rclone copy "$FILE" "$THIRD_TARGET/db" || return 1
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASSFILE" -o "$envfile" .env || return 1
  rclone copy "$envfile" "$THIRD_TARGET/config" || { rm -f "$envfile"; return 1; }
  rm -f "$envfile"
  # Bestanden versleuteld (rclone crypt; bestandsnamen ook): ook niet-openbare documenten
  # zijn op de Storage Box onleesbaar. Sleutel = de back-up-wachtzin (geen extra geheim).
  if ! rclone listremotes | grep -q "^hetzner-crypt:"; then
    rclone config create hetzner-crypt crypt remote="$THIRD_TARGET/files-enc" \
      password="$(rclone obscure "$(head -n1 "$PASSFILE")")" filename_encryption=standard directory_name_encryption=true >/dev/null || return 1
  fi
  for bucket in ${THIRD_BUCKETS:-veripasso-images veripasso-documents}; do
    rclone copy "r2:$bucket" "hetzner-crypt:$bucket" --transfers 8 || return 1
  done
  # Oude onversleutelde kopie (vóór 2026-10-19) opruimen zodra de versleutelde compleet is.
  if rclone lsf "$THIRD_TARGET/files" >/dev/null 2>&1; then
    rclone purge "$THIRD_TARGET/files" || return 1
  fi
  # Database-dumps en configuratie 30 dagen bewaren; bestanden blijven altijd staan.
  rclone delete --min-age 30d "$THIRD_TARGET/db" || return 1
  rclone delete --min-age 30d "$THIRD_TARGET/config" || return 1
}
if command -v rclone >/dev/null && rclone listremotes | grep -q "^${THIRD_TARGET%%:*}:"; then
  if third_copy; then
    THIRD=true
    echo "$(date -u +%FT%TZ) derde kopie bijgewerkt: $THIRD_TARGET"
  else
    THIRD=false
    echo "FOUT: derde kopie naar $THIRD_TARGET mislukt"
    notify "Derde back-up (Hetzner) MISLUKT" "De database-back-up staat op de server en in R2, maar de kopie naar Hetzner is mislukt. Zie /var/log/veripasso-backup.log."
  fi
  # Het back-uplog zelf ook buiten de server bewaren (bewijs van de werking).
  rclone copyto /var/log/veripasso-backup.log "$THIRD_TARGET/logs/veripasso-backup.log" 2>/dev/null || true
fi

# Status voor de monitoring in de app (deploy/compose.yaml koppelt deze map alleen-lezen).
STATUS_DIR=/var/lib/veripasso-status
mkdir -p "$STATUS_DIR"
printf '{"at":"%s","file":"%s","bytes":%s,"offsite":%s,"offsiteTarget":"%s","offsiteTotalBytes":%s,"thirdCopy":%s,"thirdCopyTarget":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$(basename "$FILE")" "$(stat -c %s "$FILE")" "$OFFSITE" "$RCLONE_TARGET" "${OFFSITE_BYTES:-0}" "$THIRD" "$THIRD_TARGET" \
  > "$STATUS_DIR/last-backup.json.tmp"
mv "$STATUS_DIR/last-backup.json.tmp" "$STATUS_DIR/last-backup.json"
chmod 644 "$STATUS_DIR/last-backup.json"
