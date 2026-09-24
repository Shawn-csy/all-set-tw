FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

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
