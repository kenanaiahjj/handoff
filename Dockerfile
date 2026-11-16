FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .

# Changes with every deploy so open apps offer "A new version is available" (e.g. the git SHA).
ARG ASBIR_BUILD_ID=dev
ENV ASBIR_BUILD_ID=$ASBIR_BUILD_ID

RUN npm ci \
  && BETTER_AUTH_URL=https://handoff.invalid \
    BETTER_AUTH_SECRET=build-only-secret-not-used-at-runtime \
    ASBIR_DATA_DIR=/tmp/asbir-build-data \
    npm run build --workspace @asbir/web \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  ASBIR_DATA_DIR=/var/lib/asbir-handoff

WORKDIR /workspace

# Litestream streams SQLite backups to a bucket when LITESTREAM_REPLICA_URL is set (see deploy/README.md).
ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates libstdc++6 curl \
  && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-$(dpkg --print-architecture).deb" -o /tmp/litestream.deb \
  && dpkg -i /tmp/litestream.deb \
  && rm /tmp/litestream.deb \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/asbir-handoff \
  && chown node:node /var/lib/asbir-handoff

COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/web ./apps/web
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/integrations ./integrations
COPY --chown=node:node deploy/litestream.yml /etc/litestream.yml
COPY --chown=node:node --chmod=755 deploy/start.sh ./start.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./start.sh"]
