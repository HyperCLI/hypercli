# HyperCLI

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
hyper claw subscribe 1aiu
hyper claw config env
```

## Repo Layout

- `sdk/` Python SDK (`hypercli-sdk`)
- `cli/` CLI (`hypercli-cli`)
- `docs/` Mintlify docs source
- `site/` web properties

## Current Notes

- CLI `llm` command surface was removed; inference setup is documented through HyperClaw pages and `hyper claw config` output.
- Public flow pricing and metadata come from `GET /flows` and `GET /flows/{name}`.
