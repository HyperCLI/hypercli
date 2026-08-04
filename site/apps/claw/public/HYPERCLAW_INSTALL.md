# HyperClaw Installation Guide

Set up HyperClaw LLM API access for OpenClaw agents.

> **Important: use the managed account key**
>
> Current self-service onboarding returns a `hyper_api_...` key for inference
> and agent operations. Raw LiteLLM `sk-...` keys exist only for out-of-band
> flat-rate customers and are not issued by this flow.

## Quick Start (Recommended)

The fastest way to get set up:

```bash
# 1. Install HyperCLI
pip install "hypercli-cli[all]"

# 2. Run guided onboarding
hyper agent onboard
```

This walks you through everything: wallet creation, funding, plan selection, payment, OpenClaw config, and verification.

**Options:**
```bash
hyper agent onboard --dry-run   # Preview steps without making changes
hyper agent onboard --json      # JSON mode for agent integration (writes state to ~/.hypercli/onboard/state.json)
hyper agent onboard --plan solo --amount 39  # Skip prompts
hyper agent onboard --status    # Check onboard progress
hyper agent onboard --reset     # Start fresh
```

The onboard flow is resumable — if interrupted (Ctrl+C, network error), just run `hyper agent onboard` again to pick up where you left off.

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
hyper agent plans
```

Plans and pricing:
- **Solo** (`solo`): $39/month — 25M pooled tokens/day and 1 small agent
- **Team** (`team`): $79/month — 50M pooled tokens/day and up to 3 medium agents
- **Pro** (`pro`): $149/month — 100M pooled tokens/day and up to 3 large agents

Inference is pooled across every active entitlement. Each additional plan
quantity adds another entitlement and its included slots.

Subscribe:
```bash
hyper agent subscribe solo 39
hyper agent subscribe team 79
```

On success, your API key is saved to `~/.hypercli/agent-key.json`.

### 5. Configure OpenClaw

```bash
# Patch config and set as default model
hyper config openclaw --apply

# Restart OpenClaw
openclaw gateway restart
```

### 6. Verify

```bash
curl -s https://api.hypercli.com/v1/models \
  -H "Authorization: Bearer $(jq -r '.key' ~/.hypercli/agent-key.json)"
```

## Agent Integration (JSON Mode)

For OpenClaw agents onboarding users programmatically:

```bash
hyper agent onboard --json --plan solo --amount 39
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
1. Run `hyper agent onboard --json`
2. Poll `--status` to check progress
3. Send the QR image from `qr_path` to the user
4. Resume with `hyper agent onboard --json` after user funds wallet

## Troubleshooting

### Wallet passphrase issues
If you forget your passphrase, create a new wallet and transfer funds.

### Insufficient balance
USDC must be on **Base network** (not Ethereum mainnet). Check with `hyper wallet balance`.

### Key not working
Run `hyper agent status` to check expiration. Renew with `hyper agent subscribe`.

### Rate limits
Daily tokens are the source of truth and are pooled across active entitlements:
25M for Solo, 50M for Team, and 100M for Pro. Query `hyper agent current-plan`
for the effective derived TPM/RPM values and current slot inventory.

## Quick Reference

| Command | Description |
|---------|-------------|
| `hyper agent onboard` | **Guided setup (recommended)** |
| `hyper agent onboard --dry-run` | Preview onboarding steps |
| `hyper agent onboard --json` | JSON mode for agent integration |
| `hyper agent plans` | List available plans |
| `hyper agent subscribe solo 39` | Purchase one Solo entitlement |
| `hyper agent status` | Check local entitlement-key status |
| `hyper config openclaw --apply` | Patch OpenClaw config |
| `hyper wallet create` | Create new wallet |
| `hyper wallet address` | Show wallet address |
| `hyper wallet qr -o file.png` | Save QR code |
| `hyper wallet balance` | Check USDC balance |

## API Endpoints

| Service | Endpoint | Purpose |
|---------|----------|---------|
| HyperClaw | `https://api.hypercli.com/v1` | LLM inference (chat completions) |
| HyperCLI | `https://api.hypercli.com` | GPU orchestration & billing |
