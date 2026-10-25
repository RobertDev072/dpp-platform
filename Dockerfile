# VeriPasso - productie-image (Linux, linux/amd64 of linux/arm64).
#
# Een gewone Next.js-server (output: "standalone") met de Express-API erin. Bij het
# starten draaien eerst de databasemigraties (idempotent, elk in een eigen transactie),
# daarna de server. Gebruikt door deploy/compose.yaml.
#
# Het image bevat geen geheimen: die komen als omgevingsvariabelen (deploy/.env).

# Basis-image: officieel Node-image van Docker Hub (zelfde bron als postgres en caddy in
# deploy/compose.yaml). De AWS-spiegel (public.ecr.aws) gaf in CI 429 "Data limit exceeded".

# --- build ------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
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
# Blogartikelen (de pagina's zijn statisch, maar zo kan Next ze ook bij runtime lezen).
COPY --from=build --chown=node:node /app/content ./content
COPY --from=build --chown=node:node /app/scripts/migrate.js /app/scripts/seed-system-owner.js /app/scripts/backfill-passport-versions.js ./scripts/

RUN printf '#!/bin/sh\nset -e\nnode scripts/migrate.js\nexec node server.js\n' > /app/start.sh \
 && chmod 755 /app/start.sh

USER node
EXPOSE 3000
CMD ["/app/start.sh"]
