# 📝 Documentation Plan

This plan outlines the documentation updates needed for HyperCLI's developer tools.

## Current State

The docs are currently using Mintlify template content. We need to replace with actual HyperCLI documentation covering:

1. **API Reference** - OpenAPI-generated docs from `openapi.json`
2. **Python SDK** (`hypercli-sdk`) - Installation, usage, API reference
3. **CLI** (`hypercli-cli`) - Installation, commands, TUI features

---

## 1. OpenAPI Integration

### File: `openapi.json`
Already fetched from `https://api.hypercli.com/api/openapi.json`

### Required Changes to `docs.json`

Add OpenAPI auto-generation for API reference:

```json
{
  "openapi": "openapi.json",
  "api": {
    "baseUrl": "https://api.hypercli.com",
    "auth": {
      "method": "bearer",
      "name": "Authorization"
    }
  }
}
```

### API Sections to Document

| Tag | Endpoints | Description |
|-----|-----------|-------------|
| `auth` | `/api/auth/login`, `/api/auth/wallet/*` | Authentication (Turnkey + wallet) |
| `billing` | `/api/balance`, `/api/tx`, `/api/invoices` | Account balance, transactions, invoices |
| `jobs` | `/api/jobs/*` | GPU job management |
| `user` | `/api/user` | User profile |
| `api-keys` | `/api/keys/*` | API key management |
| `x402` | `/api/x402/top_up` | Crypto payments (USDC on Base) |

### API Reference Pages Needed

```
api-reference/
├── introduction.mdx      # Overview, authentication, rate limits
├── authentication.mdx    # JWT vs API key, getting tokens
├── billing/
│   ├── get-balance.mdx
│   ├── list-transactions.mdx
│   └── list-invoices.mdx
├── jobs/
│   ├── create-job.mdx
│   ├── list-jobs.mdx
│   ├── get-job.mdx
│   ├── cancel-job.mdx
│   ├── get-logs.mdx
│   └── get-metrics.mdx
├── user/
│   ├── get-user.mdx
│   └── update-user.mdx
└── keys/
    ├── create-key.mdx
    ├── list-keys.mdx
    └── delete-key.mdx
```

---

## 2. Python SDK Documentation (`hypercli-sdk`)

### Pages Needed

```
sdk/
├── index.mdx             # Overview, installation
├── quickstart.mdx        # 5-minute getting started
├── authentication.mdx    # API key setup, config file
├── billing.mdx           # client.billing.* methods
├── jobs.mdx              # client.jobs.* methods
└── reference.mdx         # Full API reference
```

### Content for Each Page

#### `sdk/index.mdx`
- What is hypercli-sdk
- Installation: `pip install hypercli-sdk`
- Basic example
- Link to quickstart

#### `sdk/quickstart.mdx`
- Set API key (env var, config file, or parameter)
- Check balance
- Create a job
- List jobs
- Get logs

#### `sdk/authentication.mdx`
- Three ways to authenticate:
  1. Environment variable: `HYPERCLI_API_KEY`
  2. Config file: `~/.hypercli/config`
  3. Pass to constructor: `HyperCLI(api_key="xxx")`
- Config file format
- Priority order (env > config > param)

#### `sdk/billing.mdx`
```python
from hypercli import HyperCLI
hyper = HyperCLI()

# Get balance
balance = client.billing.balance()
print(f"Total: ${balance.total}")
print(f"Available: ${balance.available}")

# List transactions
for tx in client.billing.transactions(limit=10):
    print(f"{tx.transaction_type}: ${tx.amount_usd}")

# Get specific transaction
tx = client.billing.get_transaction("tx_id")
```

#### `sdk/jobs.mdx`
```python
from hypercli import HyperCLI
hyper = HyperCLI()

# Create job
job = client.jobs.create(
    image="nvidia/cuda:12.0",
    command="python train.py",
    gpu_type="l40s",
    gpu_count=1,
    region="us-east-1",      # optional
    runtime=3600,            # optional, seconds
    interruptible=True,      # spot instance
    env={"KEY": "value"},    # optional
    ports={"http": 8080},    # optional
)

# List jobs
jobs = client.jobs.list()
jobs = client.jobs.list(state="running")

# Get job
job = client.jobs.get("job_id")

# Get logs
logs = client.jobs.logs("job_id")

# Get GPU metrics
metrics = client.jobs.metrics("job_id")
for gpu in metrics.gpus:
    print(f"GPU {gpu.index}: {gpu.utilization}%")

# Extend runtime
client.jobs.extend("job_id", runtime=7200)

# Cancel
client.jobs.cancel("job_id")
```

#### `sdk/reference.mdx`
Full reference for all classes:
- `C3` - main client
- `Balance` - balance dataclass
- `Transaction` - transaction dataclass
- `Job` - job dataclass
- `JobMetrics`, `GPUMetrics` - metrics dataclasses
- `User` - user dataclass
- `APIError` - exception class

---

## 3. CLI Documentation (`hypercli-cli`)

### Pages Needed

```
cli/
├── index.mdx             # Overview, installation
├── quickstart.mdx        # First commands
├── configuration.mdx     # hyper configure, config file
├── commands/
│   ├── billing.mdx       # hyper billing *
│   ├── jobs.mdx          # hyper jobs *
│   ├── llm.mdx           # hyper llm *
│   └── user.mdx          # hyper user
└── tui.mdx               # Job monitor TUI features
```

### Content for Each Page

#### `cli/index.mdx`
- What is hypercli-cli
- Installation: `pip install hypercli-cli`
- Quick demo GIF/video
- Feature highlights:
  - Fancy TUI for job monitoring
  - GPU metrics visualization
  - Streaming LLM chat

#### `cli/quickstart.mdx`
```bash
# Install
pip install hypercli-cli

# Configure
hyper configure

# Check balance
hyper billing balance

# Create a job
hyper jobs create nvidia/cuda:12.0 -g l40s -c "python train.py"

# Chat with LLM
hyper llm chat deepseek-v3.1 "Hello!"
```

#### `cli/configuration.mdx`
- `hyper configure` interactive setup
- Config file location: `~/.hypercli/config`
- Environment variables: `HYPERCLI_API_KEY`, `HYPERCLI_API_URL`
- Priority: env > config

#### `cli/commands/billing.mdx`
```bash
# Get balance
hyper billing balance
hyper billing balance -o json

# List transactions
hyper billing transactions
hyper billing transactions -n 50
hyper billing transactions -o json
```

#### `cli/commands/jobs.mdx`
```bash
# List jobs
hyper jobs list
hyper jobs list -s running
hyper jobs list -o json

# Create job
hyper jobs create <image> [options]
  -g, --gpu         GPU type (l40s, h100, etc)
  -n, --count       Number of GPUs
  -c, --command     Command to run
  -r, --region      Region code
  -t, --runtime     Runtime in seconds
  --spot/--on-demand
  -e, --env         Environment variables (KEY=VALUE)
  -p, --port        Ports (name:port)
  -f, --follow      Follow logs after creation (launches TUI)
  -o, --output      Output format (table, json)

# Examples
hyper jobs create nvidia/cuda:12.0 -g l40s -c "python train.py"
hyper jobs create nvidia/cuda:12.0 -g h100 -n 8 -c "torchrun train.py" -f
hyper jobs create myimage -e HF_TOKEN=xxx -p http:8080

# Get job details
hyper jobs get <job_id>
hyper jobs get <job_id> -o json

# Get logs
hyper jobs logs <job_id>
hyper jobs logs <job_id> -f    # Follow with TUI

# Get GPU metrics
hyper jobs metrics <job_id>
hyper jobs metrics <job_id> -w  # Watch live

# Cancel job
hyper jobs cancel <job_id>

# Extend runtime
hyper jobs extend <job_id> <seconds>
```

#### `cli/commands/llm.mdx`
```bash
# List models
hyper llm models
hyper llm models -o json

# Chat (one-shot)
hyper llm chat <model> "<prompt>"
hyper llm chat deepseek-v3.1 "Explain quantum computing"

# Chat with system prompt
hyper llm chat <model> "<prompt>" -s "<system>"
hyper llm chat deepseek-v3.1 "Write a haiku" -s "You are a poet"

# Interactive chat
hyper llm chat <model>
hyper llm chat deepseek-v3.1

# Options
  -s, --system        System prompt
  -m, --max-tokens    Max tokens (default: 4096)
  -t, --temperature   Temperature (default: 0.7)
  --no-stream         Disable streaming
  -o, --output        Output format (text, json)
```

#### `cli/commands/user.mdx`
```bash
# Get user info
hyper user
hyper user -o json
```

#### `cli/tui.mdx`
Document the Textual TUI features:
- Job monitor (launched with `hyper jobs create -f` or `hyper jobs logs -f`)
  - Split pane: job info + GPU metrics + logs
  - Real-time GPU utilization bars
  - Color-coded status
  - Keyboard shortcuts: `q` quit, `c` cancel job
- Metrics watch (launched with `hyper jobs metrics -w`)
  - Live updating GPU stats
  - Utilization, VRAM, temperature, power

---

## 4. Update `docs.json` Navigation

```json
{
  "navigation": {
    "tabs": [
      {
        "tab": "Guides",
        "groups": [
          {
            "group": "Getting Started",
            "pages": ["index", "quickstart"]
          }
        ]
      },
      {
        "tab": "SDK",
        "groups": [
          {
            "group": "Python SDK",
            "pages": [
              "sdk/index",
              "sdk/quickstart",
              "sdk/authentication",
              "sdk/billing",
              "sdk/jobs",
              "sdk/reference"
            ]
          }
        ]
      },
      {
        "tab": "CLI",
        "groups": [
          {
            "group": "CLI",
            "pages": [
              "cli/index",
              "cli/quickstart",
              "cli/configuration"
            ]
          },
          {
            "group": "Commands",
            "pages": [
              "cli/commands/billing",
              "cli/commands/jobs",
              "cli/commands/llm",
              "cli/commands/user"
            ]
          },
          {
            "group": "Features",
            "pages": ["cli/tui"]
          }
        ]
      },
      {
        "tab": "API Reference",
        "groups": [
          {
            "group": "Overview",
            "pages": ["api-reference/introduction", "api-reference/authentication"]
          },
          {
            "group": "Billing",
            "pages": ["api-reference/billing/get-balance", "..."]
          },
          {
            "group": "Jobs",
            "pages": ["api-reference/jobs/create-job", "..."]
          }
        ]
      }
    ]
  }
}
```

---

## 5. Assets Needed

- [ ] Logo files (`/logo/light.svg`, `/logo/dark.svg`)
- [ ] Favicon (`/favicon.svg`)
- [ ] Screenshots/GIFs:
  - [ ] CLI balance output
  - [ ] Job monitor TUI
  - [ ] GPU metrics display
  - [ ] LLM chat session

---

## 6. Update Global Config

Update `docs.json`:
- Change name from "hypercliai" to "HyperCLI"
- Update navbar links (Dashboard → hypercli.com/dashboard)
- Update footer socials (Twitter/X, GitHub)
- Update support email

---

## Priority Order

1. **High**: API Reference with OpenAPI integration
2. **High**: SDK quickstart + core pages
3. **High**: CLI quickstart + commands
4. **Medium**: Full SDK reference
5. **Medium**: TUI documentation with screenshots
6. **Low**: Assets (logos, screenshots)
