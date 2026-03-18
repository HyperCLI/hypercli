#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_ENV="${ROOT_DIR}/env.dev"

if [[ ! -f "${BASE_ENV}" ]]; then
  echo "Missing base env file: ${BASE_ENV}" >&2
  exit 1
fi

write_local_env() {
  local app="$1"
  local target="${ROOT_DIR}/apps/${app}/.env.local"
  local main_site_url="${LOCAL_MAIN_SITE_URL:-http://localhost:4000}"
  local console_url="${LOCAL_CONSOLE_URL:-http://localhost:4001}"
  local agents_url="${LOCAL_AGENTS_URL:-http://localhost:4003}"
  local cookie_domain="${LOCAL_COOKIE_DOMAIN:-localhost}"
  local hyperclaw_cookie_domain="${LOCAL_HYPERCLAW_COOKIE_DOMAIN:-${cookie_domain}}"
  local domain="${LOCAL_DOMAIN:-localhost}"

  cp "${BASE_ENV}" "${target}"

  sed -i \
    -e "s|^NEXT_PUBLIC_MAIN_SITE_URL=.*|NEXT_PUBLIC_MAIN_SITE_URL=${main_site_url}|" \
    -e "s|^NEXT_PUBLIC_CONSOLE_URL=.*|NEXT_PUBLIC_CONSOLE_URL=${console_url}|" \
    -e "s|^NEXT_PUBLIC_AGENTS_URL=.*|NEXT_PUBLIC_AGENTS_URL=${agents_url}|" \
    -e "s|^NEXT_PUBLIC_COOKIE_DOMAIN=.*|NEXT_PUBLIC_COOKIE_DOMAIN=${cookie_domain}|" \
    -e "s|^NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN=.*|NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN=${hyperclaw_cookie_domain}|" \
    -e "s|^NEXT_PUBLIC_DOMAIN=.*|NEXT_PUBLIC_DOMAIN=${domain}|" \
    "${target}"
}

write_local_env "main"
write_local_env "console"
write_local_env "claw"

echo "Wrote apps/main/.env.local"
echo "Wrote apps/console/.env.local"
echo "Wrote apps/claw/.env.local"
