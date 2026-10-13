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
set -euo pipefail

cd "$(dirname "$0")"
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

if command -v rclone >/dev/null && rclone listremotes | grep -q "^${RCLONE_TARGET%%:*}:"; then
  rclone copy "$FILE" "$RCLONE_TARGET"
  echo "$(date -u +%FT%TZ) gekopieerd naar $RCLONE_TARGET"
else
  echo "LET OP: geen rclone-remote ingesteld; back-up staat alleen op deze server."
fi

find "$TARGET_DIR" -name 'veripasso-*.dump.gpg' -mtime +7 -delete
