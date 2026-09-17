#!/bin/sh
set -eu

claude_dir=/home/node/.claude
settings="${claude_dir}/settings.json"
settings_marker="${claude_dir}/.hypercli-settings.json"
settings_schema=https://json.schemastore.org/claude-code-settings.json
legacy_model=kimi-k2.6-anthropic
inference_mode=${HYPERCLI_RUNTIME_INFERENCE:-native}
mkdir -p "${claude_dir}"

is_generated_catalog() {
  candidate=$1
  expected_model=$2
  [ -f "${candidate}" ] && [ ! -L "${candidate}" ] &&
    jq -e \
      --arg schema "${settings_schema}" \
      --arg model "${expected_model}" \
      'type == "object"
       and (keys | sort) == (["$schema", "availableModels", "model"] | sort)
       and .["$schema"] == $schema
       and .model == $model
       and .availableModels == [$model]' \
      "${candidate}" >/dev/null 2>&1
}

managed_model=
if [ -f "${settings_marker}" ] && [ ! -L "${settings_marker}" ]; then
  managed_model=$(jq -r \
    'select(
       type == "object"
       and .managed_by == "hypercli"
       and .version == 1
       and (.model | type) == "string"
       and (.model | length) > 0
     ) | .model' \
    "${settings_marker}" 2>/dev/null || true)
fi

case "${inference_mode}" in
  native|"")
    if [ -n "${managed_model}" ] && is_generated_catalog "${settings}" "${managed_model}"; then
      rm -f "${settings}"
    elif is_generated_catalog "${settings}" "${legacy_model}"; then
      # Migrate only the exact three-key catalog produced by the old image.
      # Any extra key or different value makes the file user-owned.
      rm -f "${settings}"
    fi
    rm -f "${settings_marker}"
    ;;
  hypercli)
    model=${BUZZ_ACP_MODEL:-coding-anthropic}
    if [ -L "${settings_marker}" ]; then
      # Replace the link itself; never follow persisted user-controlled links.
      rm -f "${settings_marker}"
    elif [ -e "${settings_marker}" ] && [ ! -f "${settings_marker}" ]; then
      printf 'refusing non-file HyperCLI settings marker: %s\n' \
        "${settings_marker}" >&2
      exit 2
    fi
    if [ -n "${managed_model}" ] && ! is_generated_catalog "${settings}" "${managed_model}"; then
      # The user edited a formerly managed file. Relinquish ownership.
      rm -f "${settings_marker}"
      managed_model=
    fi
    if [ ! -e "${settings}" ] && [ ! -L "${settings}" ] ||
       [ -n "${managed_model}" ] ||
       is_generated_catalog "${settings}" "${legacy_model}"; then
      umask 077
      settings_tmp=$(mktemp "${claude_dir}/.settings.json.hypercli.XXXXXX")
      marker_tmp=$(mktemp "${claude_dir}/.hypercli-settings.json.XXXXXX")
      trap 'rm -f "${settings_tmp:-}" "${marker_tmp:-}"' EXIT HUP INT TERM
      jq -n --arg schema "${settings_schema}" --arg model "${model}" '{
        "$schema": $schema,
        model: $model,
        availableModels: [$model]
      }' > "${settings_tmp}"
      jq -n --arg model "${model}" '{
        managed_by: "hypercli",
        version: 1,
        model: $model
      }' > "${marker_tmp}"
      chmod 0600 "${settings_tmp}" "${marker_tmp}"
      mv -f "${settings_tmp}" "${settings}"
      mv -f "${marker_tmp}" "${settings_marker}"
      trap - EXIT HUP INT TERM
    fi
    ;;
  *)
    printf 'unsupported HYPERCLI_RUNTIME_INFERENCE value: %s\n' \
      "${inference_mode}" >&2
    exit 2
    ;;
esac

exec /usr/local/bin/hypercli-coding-entrypoint "$@"
