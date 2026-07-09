#!/usr/bin/env bash

set -euo pipefail

cd /workspace/site

deploy_message="${NETLIFY_DEPLOY_MESSAGE:-CI deploy ${GITHUB_SHA:-local}}"
default_site_targets=$'main|@hypercli/main|apps/main|.site-artifact/main|\nconsole|@hypercli/console|apps/console|.site-artifact/console|\nclaw|@hypercli/claw|apps/claw|.site-artifact/claw|'
site_targets="${SITE_TARGETS:-${default_site_targets}}"

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
  local name="$1"
  local workspace="$2"

  echo "::group::Build ${name} (${workspace})"
  npm run build -- --filter="${workspace}"
  echo "::endgroup::"
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

  # Router assembly. Order matters (Netlify matches top-down, first wins):
  # asset/aliased rules -> the app's own public/_redirects (domain 301s,
  # /instructions etc. — copied above, must NOT be clobbered) -> SPA
  # catch-all LAST. The catch-all is non-forced, so real exported routes
  # (e.g. /desktop-login/index.html) always win over it.
  local app_redirects=""
  if [[ -f "${publish_dir}/_redirects" ]]; then
    app_redirects="$(cat "${publish_dir}/_redirects")"
  fi
  cat > "${publish_dir}/_redirects" <<'REDIRECTS'
/_next/static/* /_next/static/:splat 200
/job/* /job 200
/billing/* /billing 200
REDIRECTS
  if [[ -n "${app_redirects}" ]]; then
    printf '%s\n' "${app_redirects}" >> "${publish_dir}/_redirects"
  fi
  printf '/* /index.html 200\n' >> "${publish_dir}/_redirects"
}

deploy_artifact() {
  local name="$1"
  local publish_dir="$2"
  local site_id="$3"

  if [[ -z "${site_id}" ]]; then
    echo "Netlify site ID is required for deploy target ${name}" >&2
    exit 1
  fi

  echo "::group::Deploy ${name}"
  pushd "${publish_dir}" >/dev/null
  deploy_args=(
    deploy
    --no-build
    --dir "."
    --site "${site_id}"
    --auth "${NETLIFY_AUTH_TOKEN}"
    --message "${deploy_message}"
    --timeout "${NETLIFY_DEPLOY_TIMEOUT:-900}"
  )

  if [[ "${NETLIFY_PROD:-false}" == "true" ]]; then
    deploy_args+=(--prod)
  fi

  netlify "${deploy_args[@]}"
  popd >/dev/null
  echo "::endgroup::"
}

for_each_target() {
  local mode="$1"

  while IFS='|' read -r name workspace app_dir publish_dir site_id; do
    if [[ -z "${name}" || "${name}" == \#* ]]; then
      continue
    fi

    build_site "${name}" "${workspace}"
    assemble_static_artifact "${app_dir}" "${publish_dir}"

    if [[ "${mode}" == "deploy" ]]; then
      deploy_artifact "${name}" "${publish_dir}" "${site_id}"
    fi
  done <<< "${site_targets}"
}

run_target() {
  local mode="$1"
  local name="$2"
  local workspace="$3"
  local app_dir="$4"
  local publish_dir="$5"
  local site_id="$6"

  build_site "${name}" "${workspace}"
  assemble_static_artifact "${app_dir}" "${publish_dir}"

  if [[ "${mode}" == "deploy" ]]; then
    deploy_artifact "${name}" "${publish_dir}" "${site_id}"
  fi
}

for_each_target_parallel() {
  local mode="$1"
  local status=0
  local pids=()
  local names=()

  while IFS='|' read -r name workspace app_dir publish_dir site_id; do
    if [[ -z "${name}" || "${name}" == \#* ]]; then
      continue
    fi

    (
      set -euo pipefail
      run_target "${mode}" "${name}" "${workspace}" "${app_dir}" "${publish_dir}" "${site_id}"
    ) &
    pids+=("$!")
    names+=("${name}")
  done <<< "${site_targets}"

  for index in "${!pids[@]}"; do
    if ! wait "${pids[$index]}"; then
      echo "Site target ${names[$index]} failed" >&2
      status=1
    fi
  done

  return "${status}"
}

case "${SITE_ACTION:-build}" in
  build)
    if [[ "${SITE_PARALLEL:-false}" == "true" || "${SITE_PARALLEL:-false}" == "1" ]]; then
      for_each_target_parallel build
    else
      for_each_target build
    fi
    ;;
  deploy)
    if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
      echo "NETLIFY_AUTH_TOKEN is required for SITE_ACTION=deploy" >&2
      exit 1
    fi

    if [[ "${SITE_PARALLEL:-false}" == "true" || "${SITE_PARALLEL:-false}" == "1" ]]; then
      for_each_target_parallel deploy
    else
      for_each_target deploy
    fi
    ;;
  *)
    echo "Unknown SITE_ACTION=${SITE_ACTION}" >&2
    exit 1
    ;;
esac
