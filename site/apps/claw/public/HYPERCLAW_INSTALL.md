# HyperClaw Installation Guide

Set up HyperClaw LLM API access for OpenClaw agents.

> **⚠️ Important: HyperCLI vs HyperClaw API Keys**
> 
> These are **two different things**:
> - **HyperCLI API Key** — Used for GPU orchestration, job management, and billing at `api.hypercli.com`
> - **HyperClaw API Key** — Used for LLM inference (chat completions) at `api.hyperclaw.app`
> 
> This guide sets up a **HyperClaw** API key for LLM access. HyperClaw keys start with `sk-hyper-`.

## Prerequisites

- Python 3.10+
- OpenClaw installed and configured
- USDC on Base network (for payment)

## Steps

### 1. Install Python

Ensure Python 3.10+ is installed:

```bash
python3 --version
# If not installed:
# Ubuntu/Debian: sudo apt install python3 python3-pip python3-venv
# macOS: brew install python@3.12
```

### 2. Install HyperCLI

Install the CLI with all optional dependencies (wallet + x402 payments):

```bash
pip install "hypercli-cli[all]"
```

Verify installation:

```bash
hyper --version
```

### 3. Create Wallet

Ask the user:
> "Do you want to protect your wallet with a passphrase? Enter a passphrase, or say 'none' for no passphrase."

**If user says "none":**
```bash
# Create wallet without passphrase (press Enter when prompted)
hyper wallet create
# Just press Enter twice when prompted for passphrase
```

**If user provides a passphrase:**
```bash
hyper wallet create
# Enter the passphrase when prompted
```

The wallet is stored at `~/.hypercli/keystore.json`.

### 4. Get Wallet Address and QR Code

Display the wallet address:

```bash
hyper wallet address
```

Save QR code to workspace and send to user:

```bash
hyper wallet qr -o ~/workspace/wallet_qr.png
```

Send `~/workspace/wallet_qr.png` to the user as an attachment. Tell them:
> "Send USDC on **Base network** to this address. You'll need $25 USDC for a 32-day 1AIU subscription (or less for shorter periods)."

### 5. Wait for Funding

Poll the wallet balance until funded:

```bash
hyper wallet balance
```

This requires the wallet passphrase if one was set. Wait until balance shows sufficient USDC (minimum $25 for full 1AIU plan).

### 6. Check Available Plans

Fetch current plans:

```bash
curl -s https://api.hyperclaw.app/api/plans | jq .
```

The 1AIU plan costs $25 for 32 days. Payment scales linearly:
- $25 → 32 days
- $12.50 → 16 days  
- $1 → ~1.3 days

### 7. Purchase Subscription

Subscribe to the 1AIU plan with your USDC balance:

```bash
hyper claw subscribe 1aiu <usdc_amount>
```

Examples:
```bash
hyper claw subscribe 1aiu 25    # Pay $25 for 32 days
hyper claw subscribe 1aiu 50    # Pay $50 for 64 days  
hyper claw subscribe 5aiu 100   # Pay $100 for 5aiu plan
```

Enter wallet passphrase when prompted. On success, you'll receive:
- API Key (sk-hyper-xxx...)
- Expiration date
- Rate limits (TPM/RPM)

The key is saved to `~/.hypercli/claw-key.json`.

### 8. Save Credentials

Save the API key to OpenClaw credentials:

```bash
# Read the key
KEY=$(jq -r '.key' ~/.hypercli/claw-key.json)

# Add to OpenClaw credentials.yaml
cat >> ~/.openclaw/credentials.yaml << EOF
hyperclaw:
  apiKey: $KEY
EOF
```

### 9. Test the Key

Verify the key works:

```bash
curl -s https://api.hyperclaw.app/v1/models \
  -H "Authorization: Bearer $(jq -r '.key' ~/.hypercli/claw-key.json)"
```

Expected response includes available models like `kimi-k2.5`.

### 10. Configure OpenClaw

Add HyperClaw as a model provider in OpenClaw config (`~/.openclaw/config.yaml`):

```yaml
providers:
  hyperclaw:
    label: HyperClaw
    baseURL: https://api.hyperclaw.app/v1
    apiKey: ${HYPERCLAW_API_KEY}  # Or reference credentials.yaml
    models:
      kimi-k2.5: kimi-k2.5
      kimi-for-coding: kimi-for-coding
```

**Important:** Add HyperClaw models to the allowlist so agents can use them:

```yaml
allowlist:
  - hyperclaw/*        # Allow all HyperClaw models
  # Or be specific:
  # - hyperclaw/kimi-k2.5
  # - hyperclaw/kimi-for-coding
```

Set as default model (optional):

```yaml
model: hyperclaw/kimi-k2.5
```

Or in agent config:

```yaml
agents:
  main:
    model: hyperclaw/kimi-k2.5
```

### 11. Set Renewal Reminder

Create a cron job to remind the user 29 days from now:

```bash
# Calculate reminder date (29 days from now)
REMIND_DATE=$(date -d "+29 days" +"%Y-%m-%d" 2>/dev/null || date -v+29d +"%Y-%m-%d")
```

Use OpenClaw's cron tool to schedule a reminder:

```json
{
  "name": "HyperClaw renewal reminder",
  "schedule": {
    "kind": "at",
    "atMs": <unix_ms_29_days_from_now>
  },
  "payload": {
    "kind": "systemEvent",
    "text": "⏰ Reminder: Your HyperClaw 1AIU subscription expires tomorrow! Run `hyper claw subscribe 1aiu` to renew."
  },
  "sessionTarget": "main"
}
```

Or tell the user to run:

```bash
hyper claw status
```

To check expiration at any time.

## Troubleshooting

### Wallet passphrase issues
If you forget your passphrase, you'll need to create a new wallet and transfer funds.

### Insufficient balance
Check balance on Base network. USDC must be on Base (not Ethereum mainnet).

### Key not working
Run `hyper claw status` to check expiration. Renew if expired.

### Rate limits
1AIU = 50K TPM / 1K RPM. Upgrade to higher AIU plans for more capacity.

## Quick Reference

| Command | Description |
|---------|-------------|
| `hyper wallet create` | Create new wallet |
| `hyper wallet address` | Show wallet address |
| `hyper wallet qr -o file.png` | Save QR code |
| `hyper wallet balance` | Check USDC balance |
| `hyper claw plans` | List available plans |
| `hyper claw subscribe 1aiu 25` | Purchase 1AIU (32 days) |
| `hyper claw status` | Check subscription status |
| `hyper claw openclaw-setup` | Show OpenClaw config instructions |

## API Endpoints

| Service | Endpoint | Purpose |
|---------|----------|---------|
| HyperClaw | `https://api.hyperclaw.app/v1` | LLM inference (chat completions) |
| HyperCLI | `https://api.hypercli.com` | GPU orchestration & billing |
