# VeriPasso - productie-image voor AWS ECS Fargate (linux/arm64 of linux/amd64).
#
# Bouwen (lokaal of in CI):
#   docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t veripasso:local .
# Draaien (lokaal testen, met een eigen .env):
#   docker run --rm -p 3000:3000 --env-file .env veripasso:local
#
# Het image bevat geen geheimen: database-wachtwoord en COOKIE_SECRET komen bij het
# starten uit AWS Secrets Manager (zie infra/), bestandsopslag via de IAM-rol.

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
    GIT_SHA=${GIT_SHA} \
    DATABASE_CA_CERT_FILE=/app/certs/rds-global-bundle.pem

# CA-bundel van Amazon RDS: TLS naar de database mét certificaatcontrole.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem

# Zelfstandige Next.js-server (output: "standalone") + statische bestanden.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Migraties en beheerscripts voor eenmalige ECS-taken (npm run migrate e.d. draaien
# met hetzelfde image, zie docs/aws-deployment-runbook.md).
COPY --from=build --chown=node:node /app/db ./db
# De scripts gebruiken de broncode in src/ (in de Next-build is die gebundeld); de
# benodigde pakketten (pg, dotenv, bcryptjs, AWS SDK) staan al in de standalone-node_modules.
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts/migrate.js /app/scripts/seed-system-owner.js /app/scripts/backfill-passport-versions.js ./scripts/

USER node
EXPOSE 3000
CMD ["node", "server.js"]
