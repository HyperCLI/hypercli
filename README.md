# HyperCLI
![Build](https://github.com/HyperCLI/hypercli/actions/workflows/build.yml/badge.svg)

HyperCLI is the SDK/CLI/docs workspace for:

- GPU job orchestration against Orchestra (`/api/jobs`)
- Media Flow APIs (`/api/flow/*`)
- x402 pay-per-use launches (`/api/x402/job`, `/api/x402/flow/{flow_type}`)
- HyperClaw checkout and agent setup (`hyper claw *`)

## Install

```bash
pip install hypercli-sdk hypercli-cli
```

## Configure

```bash
hyper configure
export HYPERCLI_API_KEY=...
```

## Quick Commands

```bash
# Launch account-billed GPU job
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 -g l4 -c "nvidia-smi"

# Launch pay-per-use x402 GPU job
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 -g l4 -c "nvidia-smi" --x402 --amount 0.01

# Run account-billed flow
hyper flow text-to-image "a cinematic portrait"

# Run pay-per-use x402 flow
hyper flow text-to-image "a cinematic portrait" --x402

# HyperClaw plan + config workflow
hyper claw plans
hyper claw subscribe basic
hyper claw config env
```

## Agents Billing Notes

HyperClaw now supports three distinct entitlement paths:

- Stripe recurring checkout
- x402 wallet-funded checkout
- Orchestra balance-funded entitlement purchase

It also supports unapplied grant codes:

- an unactivated code is a `grant`
- redeeming it creates or extends the matching entitlement window

## Repo Layout

- `sdk/` Python SDK (`hypercli-sdk`)
- `cli/` CLI (`hypercli-cli`)
- `docs/` Mintlify docs source
- `site/` web properties

## Frontend E2E Debugging

Use the agents E2E debug mode when chasing Claw launch or gateway UI failures.
It keeps the container alive while you rerun Playwright inside the same
container. This spec must exercise Stripe checkout: success means Stripe
redirects back to `/plans`, the backend reports more granted slots, and an
agent launches/connects from the purchased slot.

```bash
cd ~/dev/hypercli
IMAGE_TAG=local-agents-debug .github/scripts/build_e2e_image.sh
mkdir -p .e2e-artifacts-local-live
docker run --init --name hypercli-e2e-agents-debug \
  --env-file .env.agents \
  -e TEST_CLAW_ADMIN_LOGIN_SHORTCUT=1 \
  -e E2E_KEEP_ALIVE_ON_FAILURE=1 \
  -e E2E_ARTIFACTS_DIR=/artifacts \
  -v "$PWD/.e2e-artifacts-local-live:/artifacts" \
  hypercli-e2e:local-agents-debug \
  bash -lc 'cd /workspace && ./.github/scripts/run_e2e_agents.sh'
```

Then rerun only the failing spec:

```bash
docker exec -it hypercli-e2e-agents-debug bash
cd /workspace/site
npx playwright test \
  --config tests/claw/playwright.config.ts \
  tests/claw/agents-subscription.spec.ts
```

Keep secrets in `.env.agents`, not inline `docker run -e` arguments. The E2E
image contains a copied workspace, so rebuild after source edits or bind-mount
the specific test file you are iterating on.

CI failure notifications prefer Playwright video artifacts: `video.webm` is
converted to MP4 and sent before falling back to a screenshot. If you only see a
screenshot, inspect the uploaded `test-results` artifact for missing video or
ffmpeg conversion errors.

## Current Notes

- CLI `llm` command surface was removed; inference setup is documented through HyperClaw pages and `hyper claw config` output.
- Public flow pricing and metadata come from `GET /flows` and `GET /flows/{name}`.
- Claw files UI should use `site/apps/claw/src/components/dashboard/files` and
  `AgentFilesPanel`; the old `dashboard/files-panel` duplicate was removed.
