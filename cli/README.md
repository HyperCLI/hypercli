# hypercli-cli

Command-line interface for HyperCLI jobs, flows, x402 pay-per-use launches, and HyperCLI checkout tooling.

## Install

```bash
pip install hypercli-cli
```

## Configure

```bash
hyper configure
```

## Core Commands

```bash
# GPU discovery and launch
hyper instances list
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 -g l4 -c "nvidia-smi"

# x402 pay-per-use GPU launch
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 -g l4 -c "nvidia-smi" --x402 --amount 0.01

# Job lifecycle
hyper jobs list
hyper jobs logs <job_id>
hyper jobs metrics <job_id>
hyper jobs exec <job_id> "nvidia-smi"
hyper jobs shell <job_id>

# Dry-run launch validation
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 -g l4 -c "nvidia-smi" --dry-run

# Flows (recommended media path)
hyper flow text-to-image "a cinematic portrait"
hyper flow text-to-image "a cinematic portrait" --x402

# Direct inference and reusable uploads
hyper llm chat "Summarize the current platform status"
hyper files upload ./source.png

# HyperCLI checkout/config
hyper agent plans
hyper agent subscribe solo
hyper agent activate-code PROMO123
hyper agent config env
hyper agent exec <agent_id> "ls -la"
hyper agent shell <agent_id>
hyper agents create --name docs-demo --size small --wait
hyper agents wait docs-demo --timeout 300
hyper agents stop docs-demo --wait --timeout 900
```

Agent waits are event-assisted and confirm state through REST. `hyper agents
status` and `hyper agents list` are one-shot snapshots.

The current paid plan IDs are `solo` ($39, 25M pooled tokens/day, one small
agent), `team` ($79, 50M pooled tokens/day, up to three medium agents), and
`pro` ($149, 100M pooled tokens/day, up to three large agents). Discover the
live catalog with `hyper agent plans` before checkout.

## Notes

- `hyper llm` provides one-shot chat and image inference. For persistent agent
  configuration, use `hyper config ...` and the OpenAI/Anthropic-compatible
  provider settings.
- Use `hyper flow status <render_id> --output json` for structured status.
  `hyper flow get` uses `--format` for metadata and `--output` for downloads.
