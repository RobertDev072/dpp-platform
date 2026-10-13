# VeriPasso - productie-image (Linux, linux/amd64 of linux/arm64).
#
# Een gewone Next.js-server (output: "standalone") met de Express-API erin. Bij het
# starten draaien eerst de databasemigraties (idempotent, elk in een eigen transactie),
# daarna de server. Gebruikt door deploy/compose.yaml.
#
# Het image bevat geen geheimen: die komen als omgevingsvariabelen (deploy/.env).

# Basis-images via de AWS-spiegel van de officiële Docker Hub-images (zelfde inhoud):
# Docker Hub begrenst anonieme downloads per IP.

# --- build ------------------------------------------------------------------------
FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------------------
FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS runtime
WORKDIR /app

ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=${GIT_SHA}

# Zelfstandige Next.js-server + statische bestanden.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Migraties en beheerscripts (seed-system-owner, backfill) met hetzelfde image. De
# scripts gebruiken de broncode in src/; de benodigde pakketten (pg, dotenv, bcryptjs)
# staan al in de standalone-node_modules.
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts/migrate.js /app/scripts/seed-system-owner.js /app/scripts/backfill-passport-versions.js ./scripts/

RUN printf '#!/bin/sh\nset -e\nnode scripts/migrate.js\nexec node server.js\n' > /app/start.sh \
 && chmod 755 /app/start.sh

USER node
EXPOSE 3000
CMD ["/app/start.sh"]
