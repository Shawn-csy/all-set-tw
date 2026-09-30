#!/bin/sh
set -eu

secret_path=/run/secrets/config_encryption_key
base_vars=/workspace/apps/worker/.dev.vars.base
runtime_vars=/workspace/apps/worker/.dev.vars
wrangler_config=${WRANGLER_CONFIG:-wrangler.production.local.toml}

if [ ! -r "$base_vars" ]; then
  echo "Missing production vars file: $base_vars" >&2
  exit 1
fi

if [ ! -r "$secret_path" ]; then
  echo "Missing Docker secret: $secret_path" >&2
  exit 1
fi

cp "$base_vars" "$runtime_vars"
chmod 600 "$runtime_vars"

CONFIG_ENCRYPTION_KEY="$(tr -d '\r\n' < "$secret_path")"
if [ -z "$CONFIG_ENCRYPTION_KEY" ]; then
  echo "The production config encryption key is empty" >&2
  exit 1
fi

export CONFIG_ENCRYPTION_KEY
export X_BROWSER_HEADFUL="${X_BROWSER_HEADFUL:-false}"
export WRANGLER_CONFIG="$wrangler_config"
export WRANGLER_DEV_PORT="${WRANGLER_DEV_PORT:-8787}"

/workspace/node_modules/.bin/wrangler d1 migrations apply DB --remote \
  --config "/workspace/apps/worker/$WRANGLER_CONFIG"

exec node /workspace/scripts/dev-worker.mjs
