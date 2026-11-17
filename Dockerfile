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
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    npm run build --workspace @asbir/web \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000

WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/web ./apps/web
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/integrations ./integrations
COPY --chown=node:node --chmod=755 deploy/start.sh ./start.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./start.sh"]
