FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN npm ci --ignore-scripts
RUN npm run build -w @taiwan-fin-hub/web

COPY docker/orbstack/entrypoint.sh /usr/local/bin/taiwan-fin-hub-worker
RUN chmod 0755 /usr/local/bin/taiwan-fin-hub-worker \
  && chown -R node:node /workspace

USER node
ENTRYPOINT ["/usr/local/bin/taiwan-fin-hub-worker"]
