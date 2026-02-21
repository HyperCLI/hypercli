# HyperCLI — GPU & Agent Management

HyperCLI (`hyper`) is the CLI for HyperClaw infrastructure. Use it to manage GPU jobs, agents, and subscriptions.

## Authentication

```bash
# Login with wallet (agents/claw features)
hyper claw login

# Login with API key (GPU jobs)
hyper login
```

Credentials are stored in `~/.hypercli/`.

## GPU Jobs

```bash
hyper jobs list                    # List all jobs
hyper jobs create <config.yaml>    # Launch a GPU job
hyper jobs get <job_id>            # Job details
hyper jobs logs <job_id>           # Stream container logs
hyper jobs metrics <job_id>        # GPU metrics (utilization, memory, temp)
hyper jobs cancel <job_id>         # Kill a job
hyper jobs extend <job_id>         # Extend runtime
```

### Available GPUs
- **B200** — NVIDIA Blackwell, 192GB HBM3e (p6-b200.48xlarge)
- **H100/H200** — Hopper generation
- **L40S** — Ada Lovelace, good for inference
- **L4** — Budget inference GPU
- **RTX PRO 6000** — Workstation GPU

## Agents (Reef Pods)

```bash
hyper agents list                  # List your agents
hyper agents create                # Create a new agent pod
hyper agents status <id>           # Agent details + URLs
hyper agents start <id>            # Start a stopped agent
hyper agents stop <id>             # Stop (preserves state)
hyper agents delete <id>           # Delete permanently
hyper agents exec <id> "command"   # Run command inside agent
hyper agents shell <id>            # Interactive shell (WebSocket PTY)
hyper agents logs <id>             # Stream agent logs
hyper agents chat <id>             # Interactive chat with agent's AI
hyper agents token <id>            # Refresh JWT token
```

Each agent is a full Linux desktop (XFCE) with browser, OpenClaw, and development tools.

## Subscriptions

```bash
hyper claw subscribe <plan> <amount>   # Purchase a plan with USDC
hyper claw status                      # Check subscription status
```

### Plans
- **1aiu** — $25/30 days, 1 agent
- **5aiu** — $100/30 days, 5 agents
- **10aiu** — $200/30 days, 10 agents

## Configuration

```bash
hyper claw config openclaw --key <api_key> --apply   # Configure OpenClaw with HyperClaw provider
hyper claw config openclaw --key <api_key> --dev --apply  # Dev mode (local API)
```

## API

- **Production**: `https://api.hyperclaw.app`
- **Models**: Kimi K2.5, GLM-5, Minimax M2.5, Qwen3 Embedding
- **Auth**: Bearer token (sk-xxx) or wallet SIWE
