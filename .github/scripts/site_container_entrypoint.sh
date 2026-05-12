#!/usr/bin/env bash

set -euo pipefail

cd /workspace/site

site_workspace="${SITE_WORKSPACE:-@hypercli/claw}"
site_app_dir="${SITE_APP_DIR:-apps/claw}"
site_publish_dir="${SITE_PUBLISH_DIR:-.site-artifact/claw}"
deploy_message="${NETLIFY_DEPLOY_MESSAGE:-CI deploy ${GITHUB_SHA:-local}}"

if [[ "${AGENTS_WS_URL:-}" == '$NEXT_PUBLIC_AGENTS_WS_URL' ]]; then
  export AGENTS_WS_URL="${NEXT_PUBLIC_AGENTS_WS_URL:-}"
fi

materialize_env_file() {
  local target="$1"
  : > "${target}"
  env | awk -F= '
    /^NEXT_PUBLIC_/ || /^AGENTS_WS_URL=/ || /^HYPERCLAW_/ {
      print
    }
  ' | sort >> "${target}"
}

materialize_env_file apps/main/.env.local
materialize_env_file apps/console/.env.local
materialize_env_file apps/claw/.env.local

build_site() {
  npm run build -- --filter="${site_workspace}"
}

assemble_static_artifact() {
  local app_dir="$1"
  local publish_dir="$2"
  local server_app_dir="${app_dir}/.next/server/app"

  rm -rf "${publish_dir}"
  mkdir -p "${publish_dir}/_next"

  if [[ -d "${app_dir}/public" ]]; then
    cp -a "${app_dir}/public/." "${publish_dir}/"
  fi
  cp -a "${app_dir}/.next/static" "${publish_dir}/_next/static"

  while IFS= read -r html_file; do
    local rel="${html_file#${server_app_dir}/}"
    local route="${rel%.html}"
    if [[ "${route}" == "_global-error" ]]; then
      continue
    fi
    if [[ "${route}" == "_not-found" ]]; then
      cp "${html_file}" "${publish_dir}/404.html"
      continue
    fi
    if [[ "${route}" == "index" ]]; then
      cp "${html_file}" "${publish_dir}/index.html"
      continue
    fi
    mkdir -p "${publish_dir}/${route}"
    cp "${html_file}" "${publish_dir}/${route}/index.html"
  done < <(find "${server_app_dir}" -type f -name '*.html' | sort)

  cat > "${publish_dir}/_redirects" <<'REDIRECTS'
/_next/static/* /_next/static/:splat 200
/* /index.html 200
REDIRECTS
}

case "${SITE_ACTION:-build}" in
  build)
    build_site
    assemble_static_artifact "${site_app_dir}" "${site_publish_dir}"
    ;;
  deploy)
    if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
      echo "NETLIFY_AUTH_TOKEN is required for SITE_ACTION=deploy" >&2
      exit 1
    fi
    if [[ -z "${NETLIFY_SITE_ID:-}" ]]; then
      echo "NETLIFY_SITE_ID is required for SITE_ACTION=deploy" >&2
      exit 1
    fi

    build_site
    assemble_static_artifact "${site_app_dir}" "${site_publish_dir}"

    deploy_args=(
      deploy
      --no-build
      --dir "${site_publish_dir}"
      --site "${NETLIFY_SITE_ID}"
      --auth "${NETLIFY_AUTH_TOKEN}"
      --message "${deploy_message}"
      --timeout "${NETLIFY_DEPLOY_TIMEOUT:-900}"
    )

    if [[ "${NETLIFY_PROD:-false}" == "true" ]]; then
      deploy_args+=(--prod)
    fi

    netlify "${deploy_args[@]}"
    ;;
  *)
    echo "Unknown SITE_ACTION=${SITE_ACTION}" >&2
    exit 1
    ;;
esac
