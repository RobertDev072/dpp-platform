#!/usr/bin/env bash
# Nieuwe versie uitrollen: laatste code van main ophalen, image bouwen, herstarten.
# Migraties draaien automatisch bij het starten van de app (Dockerfile).
#
#   sudo /opt/veripasso/deploy/update.sh
set -euo pipefail

cd "$(dirname "$0")/.."
git fetch --quiet origin main
git reset --hard origin/main
export GIT_SHA=$(git rev-parse HEAD)

cd deploy
docker compose build app
docker compose up -d
docker image prune -f >/dev/null

# Wachten tot de app gezond is (database bereikbaar, migraties gedaan).
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo unknown)
  if [ "$status" = "healthy" ]; then
    echo "Uitgerold: ${GIT_SHA:0:7} (app gezond)"
    exit 0
  fi
  sleep 5
done
echo "App is na 150 seconden niet gezond. Logs: docker compose logs --tail=100 app"
exit 1
