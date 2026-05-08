# hypercli-cli

Command-line interface for HyperCLI jobs, flows, x402 pay-per-use launches, and HyperClaw checkout tooling.

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

# HyperClaw checkout/config
hyper agent plans
hyper agent subscribe basic
hyper agent activate-code PROMO123
hyper agent config env
hyper agent exec <agent_id> "ls -la"
hyper agent shell <agent_id>
```

## Notes

- `hyper llm` command surface has been removed.
- For inference setup, use HyperClaw (`hyper agent config ...`) and your agent/client's OpenAI-compatible configuration.
