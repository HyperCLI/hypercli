#!/bin/sh
set -eu

# These are hosted defaults only. Buzz Desktop's resolved launch environment
# remains authoritative, including explicit empty values that should fail the
# native runtime's own validation rather than being silently replaced here.
runtime_config=$(python3 /opt/hypercli/lib/runtime-config.py)
eval "${runtime_config}"
unset runtime_config
hypercli_api_base="${HYPER_API_BASE}"
openai_compat_base="${hypercli_api_base%/}"
if [ -n "$openai_compat_base" ] && [ "${openai_compat_base%/v1}" = "$openai_compat_base" ]; then
  openai_compat_base="${openai_compat_base}/v1"
fi

if [ -z "${BUZZ_AGENT_PROVIDER+x}" ]; then
  export BUZZ_AGENT_PROVIDER=openai
fi
if [ -z "${BUZZ_AGENT_MODEL+x}" ]; then
  export BUZZ_AGENT_MODEL=coding-anthropic
fi
if [ -z "${OPENAI_COMPAT_BASE_URL+x}" ]; then
  if [ -z "$openai_compat_base" ]; then
    echo "HYPER_API_BASE is required" >&2
    exit 2
  fi
  export OPENAI_COMPAT_BASE_URL="$openai_compat_base"
fi
if [ -z "${OPENAI_COMPAT_API+x}" ]; then
  export OPENAI_COMPAT_API=chat
fi
if [ -z "${OPENAI_COMPAT_API_KEY+x}" ] && [ -n "${HYPER_RUNTIME_API_KEY:-}" ]; then
  export OPENAI_COMPAT_API_KEY="${HYPER_RUNTIME_API_KEY}"
fi

exec /opt/hypercli/bin/entrypoint "$@"
