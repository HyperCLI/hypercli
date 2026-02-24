#!/usr/bin/env bash
# Copy dev env to each app's .env.local (overrides .env.production)
set -euo pipefail
for d in apps/*/; do
  cp env.dev "$d/.env.local"
  echo "[env-dev] Copied env.dev → $d.env.local"
done
