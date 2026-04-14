#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${HYPER_API_BASE:-https://api.hypercli.com}"
PLAN_ID="${HYPER_TEST_PLAN_ID:-1aiu}"
AMOUNT="${HYPER_TEST_AMOUNT_USDC:-0.01}"
PASSPHRASE="${HYPER_WALLET_PASSPHRASE:-}"
KEY_FILE="${HOME}/.hypercli/agent-key.json"
PASS_ARGS=()

if [[ -n "${PASSPHRASE}" ]]; then
  PASS_ARGS=(--passphrase "${PASSPHRASE}")
fi

echo "==> Checking wallet balance"
hyper wallet balance "${PASS_ARGS[@]}"

echo "==> Purchasing ${PLAN_ID} for \$${AMOUNT} via CLI"
hyper agent subscribe "${PLAN_ID}" "${AMOUNT}" "${PASS_ARGS[@]}"

if [[ ! -f "${KEY_FILE}" ]]; then
  echo "Missing key file: ${KEY_FILE}" >&2
  exit 1
fi

API_KEY="$(python3 - <<'PY'
import json
from pathlib import Path
path = Path.home() / ".hypercli" / "agent-key.json"
data = json.loads(path.read_text())
print(str(data["key"]))
PY
)"

if [[ -z "${API_KEY}" ]]; then
  echo "No API key returned from subscription flow" >&2
  exit 1
fi

echo "==> Validating returned key against ${BASE_URL%/}/v1/models"
HTTP_CODE="$(curl -sS -o /tmp/hyper-x402-models.json -w '%{http_code}' \
  --location "${BASE_URL%/}/v1/models" \
  --header "Authorization: Bearer ${API_KEY}")"

cat /tmp/hyper-x402-models.json
echo

if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "Model validation failed with HTTP ${HTTP_CODE}" >&2
  exit 1
fi

python3 - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/hyper-x402-models.json").read_text())
models = payload.get("data")
if not isinstance(models, list) or not models:
    raise SystemExit("No models returned for x402-issued API key")
print(f"Validated {len(models)} models")
PY

echo "==> x402 subscription smoke passed"
