# HyperClaw Installation Guide

Set up HyperClaw LLM API access for OpenClaw agents.

> **⚠️ Important: HyperCLI vs HyperClaw API Keys**
> 
> These are **two different things**:
> - **HyperCLI API Key** — Used for GPU orchestration, job management, and billing at `api.hypercli.com`
> - **HyperClaw API Key** — Used for LLM inference (chat completions) at `api.hyperclaw.app`
> 
> This guide sets up a **HyperClaw** API key for LLM access. HyperClaw keys start with `sk-`.

## Quick Start (Recommended)

The fastest way to get set up:

```bash
# 1. Install HyperCLI
pip install "hypercli-cli[all]"

# 2. Run guided onboarding
hyper claw onboard
```

This walks you through everything: wallet creation, funding, plan selection, payment, OpenClaw config, and verification.

**Options:**
```bash
hyper claw onboard --dry-run   # Preview steps without making changes
hyper claw onboard --json      # JSON mode for agent integration (writes state to ~/.hypercli/onboard/state.json)
hyper claw onboard --plan 1aiu --amount 35  # Skip prompts
hyper claw onboard --status    # Check onboard progress
hyper claw onboard --reset     # Start fresh
```

The onboard flow is resumable — if interrupted (Ctrl+C, network error), just run `hyper claw onboard` again to pick up where you left off.

## Manual Steps (Alternative)

If you prefer to run each step manually:

### 1. Install HyperCLI

```bash
pip install "hypercli-cli[all]"
hyper --version
```

### 2. Create Wallet

```bash
hyper wallet create
```

Set a passphrase when prompted (or press Enter for none). Wallet is stored at `~/.hypercli/wallet.json`.

### 3. Fund Wallet

Get your wallet address and QR code:

```bash
hyper wallet address
hyper wallet qr -o wallet_qr.png
```

Send USDC on **Base network** to this address.

Check balance:
```bash
hyper wallet balance
```

### 4. Choose Plan and Subscribe

View available plans:
```bash
hyper claw plans
```

Plans and pricing:
- **1aiu** (1 Agent): $35/mo — 100K TPM / 2K RPM
- **2aiu** (2 Agents): $65/mo — 200K TPM / 4K RPM
- **5aiu** (5 Agents): $120/mo — 500K TPM / 10K RPM
- **10aiu** (10 Agents): $225/mo — 1M TPM / 20K RPM

Subscribe:
```bash
hyper claw subscribe 1aiu 35    # 1 Agent plan
hyper claw subscribe 5aiu 120   # 5 Agents plan
```

On success, your API key is saved to `~/.hypercli/claw-key.json`.

### 5. Configure OpenClaw

```bash
# Patch config and set as default model
hyper claw openclaw-setup --default

# Restart OpenClaw
openclaw gateway restart
```

### 6. Verify

```bash
curl -s https://api.hyperclaw.app/v1/models \
  -H "Authorization: Bearer $(jq -r '.key' ~/.hypercli/claw-key.json)"
```

## Agent Integration (JSON Mode)

For OpenClaw agents onboarding users programmatically:

```bash
hyper claw onboard --json --plan 1aiu --amount 35
```

State is written to `~/.hypercli/onboard/state.json` at each step:

```json
{
  "version": 1,
  "current_step": "funding",
  "steps": {
    "wallet": {"status": "complete", "address": "0x..."},
    "funding": {"status": "waiting", "balance": "0.00", "qr_path": "~/.hypercli/onboard/wallet_qr.png"}
  }
}
```

The agent can:
1. Run `hyper claw onboard --json` 
2. Poll `--status` to check progress
3. Send the QR image from `qr_path` to the user
4. Resume with `hyper claw onboard --json` after user funds wallet

## Troubleshooting

### Wallet passphrase issues
If you forget your passphrase, create a new wallet and transfer funds.

### Insufficient balance
USDC must be on **Base network** (not Ethereum mainnet). Check with `hyper wallet balance`.

### Key not working
Run `hyper claw status` to check expiration. Renew with `hyper claw subscribe`.

### Rate limits
1AIU = 100K TPM / 2K RPM. Upgrade to higher plans for more capacity.

## Quick Reference

| Command | Description |
|---------|-------------|
| `hyper claw onboard` | **Guided setup (recommended)** |
| `hyper claw onboard --dry-run` | Preview onboarding steps |
| `hyper claw onboard --json` | JSON mode for agent integration |
| `hyper claw plans` | List available plans |
| `hyper claw subscribe 1aiu 35` | Purchase 1 Agent plan |
| `hyper claw status` | Check subscription status |
| `hyper claw openclaw-setup` | Patch OpenClaw config |
| `hyper wallet create` | Create new wallet |
| `hyper wallet address` | Show wallet address |
| `hyper wallet qr -o file.png` | Save QR code |
| `hyper wallet balance` | Check USDC balance |

## API Endpoints

| Service | Endpoint | Purpose |
|---------|----------|---------|
| HyperClaw | `https://api.hyperclaw.app/v1` | LLM inference (chat completions) |
| HyperCLI | `https://api.hypercli.com` | GPU orchestration & billing |
