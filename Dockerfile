# VeriPasso - productie-image voor AWS Lambda (linux/amd64 of linux/arm64).
#
# Een gewone Next.js-server; de Lambda Web Adapter (extensie hieronder) vertaalt
# Lambda-aanroepen naar HTTP-verzoeken op poort 3000. Buiten Lambda doet de adapter
# niets, dus hetzelfde image draait ook gewoon lokaal of in een andere container-dienst.
#
# Bouwen (lokaal of in CI; Lambda accepteert geen multi-platform/attestation-manifest):
#   docker build --provenance=false --build-arg GIT_SHA=$(git rev-parse HEAD) -t veripasso:local .
# Draaien (lokaal testen, met een eigen .env):
#   docker run --rm -p 3000:3000 --env-file .env veripasso:local
#
# Het image bevat geen geheimen: die zet de infrastructuur als omgevingsvariabelen
# (verwijzingen naar AWS Secrets Manager, zie infra/), bestandsopslag via de IAM-rol.

# Basis-images via de AWS-spiegel van de officiële Docker Hub-images (zelfde inhoud):
# Docker Hub begrenst anonieme downloads per IP, en GitHub-runners delen hun IP's.

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
    GIT_SHA=${GIT_SHA} \
    DATABASE_CA_CERT_FILE=/app/certs/rds-global-bundle.pem

# CA-bundel van Amazon RDS: TLS naar de database mét certificaatcontrole. ADD van een
# URL maakt map en bestand alleen voor root leesbaar; de app draait als "node", dus
# de rechten expliciet zetten (map 755, bestand 644).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 755 /app/certs && chmod 644 /app/certs/rds-global-bundle.pem

# Lambda Web Adapter (officieel image van AWS Labs, vaste versie).
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

# Zelfstandige Next.js-server (output: "standalone") + statische bestanden.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Migraties (op Lambda via een directe aanroep, zie src/routes/internalEvents.routes.js)
# en beheerscripts voor handmatig gebruik met hetzelfde image.
COPY --from=build --chown=node:node /app/db ./db
# De scripts gebruiken de broncode in src/ (in de Next-build is die gebundeld); de
# benodigde pakketten (pg, dotenv, bcryptjs, AWS SDK) staan al in de standalone-node_modules.
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts/migrate.js /app/scripts/seed-system-owner.js /app/scripts/backfill-passport-versions.js ./scripts/

# Op Lambda is alleen /tmp schrijfbaar: de Next.js-cache (o.a. geoptimaliseerde
# afbeeldingen) wijst daarheen; het startscript maakt de map aan.
RUN rm -rf /app/.next/cache && ln -s /tmp/next-cache /app/.next/cache \
 && printf '#!/bin/sh\nmkdir -p /tmp/next-cache\nexec node server.js\n' > /app/start.sh \
 && chmod 755 /app/start.sh

USER node
EXPOSE 3000
CMD ["/app/start.sh"]
