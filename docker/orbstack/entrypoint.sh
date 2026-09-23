#!/bin/sh
set -eu

secret_path=/run/secrets/config_encryption_key
base_vars=/workspace/apps/worker/.dev.vars.base
runtime_vars=/workspace/apps/worker/.dev.vars

if [ ! -r "$secret_path" ]; then
  echo "Missing Docker secret: config_encryption_key" >&2
  exit 1
fi

if [ -r "$base_vars" ]; then
  cp "$base_vars" "$runtime_vars"
else
  : > "$runtime_vars"
fi
chmod 600 "$runtime_vars"

CONFIG_ENCRYPTION_KEY="$(tr -d '\r\n' < "$secret_path")"
if [ -z "$CONFIG_ENCRYPTION_KEY" ]; then
  echo "The config encryption key secret is empty." >&2
  exit 1
fi
export CONFIG_ENCRYPTION_KEY
export X_BROWSER_HEADFUL="${X_BROWSER_HEADFUL:-false}"

exec npm run dev -w @taiwan-fin-hub/worker
