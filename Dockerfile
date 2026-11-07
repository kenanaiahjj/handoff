FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .

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

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/asbir-handoff \
  && chown node:node /var/lib/asbir-handoff

COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/web ./apps/web
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/integrations ./integrations

USER node

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@asbir/web", "--", "--hostname", "0.0.0.0", "--port", "3000"]
