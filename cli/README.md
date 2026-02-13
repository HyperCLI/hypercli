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

# Flows (recommended media path)
hyper flow text-to-image "a cinematic portrait"
hyper flow text-to-image "a cinematic portrait" --x402

# HyperClaw checkout/config
hyper claw plans
hyper claw subscribe 1aiu
hyper claw config env
```

## Notes

- `hyper llm` command surface has been removed.
- For inference setup, use HyperClaw (`hyper claw config ...`) and your agent/client's OpenAI-compatible configuration.
