FROM node:22-bookworm-slim AS builder

WORKDIR /workspace

RUN chown node:node /workspace

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts

RUN chown node:node /workspace

USER node
RUN npm ci --ignore-scripts
RUN npm run build -w @taiwan-fin-hub/web

FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN chown node:node /workspace

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts

RUN chown node:node /workspace

USER node
RUN npm ci --omit=dev --ignore-scripts \
      --workspace @taiwan-fin-hub/worker \
      --include-workspace-root=false \
  && npm install --omit=dev --ignore-scripts --no-save --workspaces=false wrangler@4.121.0 \
  && rm -rf /home/node/.npm

COPY --from=builder --chown=node:node /workspace/apps/web/dist ./apps/web/dist

USER root
COPY docker/orbstack/entrypoint.production.sh /usr/local/bin/taiwan-fin-hub-production
RUN chmod 0755 /usr/local/bin/taiwan-fin-hub-production

USER node
ENTRYPOINT ["/usr/local/bin/taiwan-fin-hub-production"]
