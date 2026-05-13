# HyperCLI

**GPU orchestration and LLM API platform**

HyperCLI provides on-demand GPU infrastructure for running containerized workloads and accessing frontier LLMs through a unified API.

---

## Features

- **GPU Instances** - Launch containerized workloads on H100, L40S, and other high-performance GPUs
- **LLM API** - OpenAI-compatible API for models like DeepSeek, Claude, GPT-4, and more
- **Render API** - ComfyUI-based image generation and video processing
- **Python SDK** - Type-safe client library for all platform features
- **CLI** - Powerful command-line interface with interactive TUI
- **MCP Server** - Model Context Protocol integration for AI agents

## Quick Start

### Installation

```bash
pip install hypercli-sdk hypercli-cli
```

### Configure

```bash
hyper configure
```

Or set your API key directly:

```bash
export HYPERCLI_API_KEY=your_key
```

Get your API key at [console.hypercli.com](https://console.hypercli.com)

### Usage

**Python SDK:**

```python
from hypercli import HyperCLI

client = HyperCLI()

# Launch a GPU job
job = client.jobs.create(
    image="nvidia/cuda:12.0",
    gpu_type="l40s",
    command="python train.py"
)

# Check balance
balance = client.billing.balance()
print(f"Balance: ${balance.total}")
```

**CLI:**

```bash
# Launch GPU job with live monitoring
hyper jobs create nvidia/cuda:12.0 -g l40s -c "python train.py" -f

# Chat with LLM
hyper llm chat deepseek-v3.1 "Explain quantum computing"

# Check account balance
hyper billing balance
```

**LLM API (OpenAI Compatible):**

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_hypercli_api_key",
    base_url="https://api.hypercli.com/v1"
)

response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Repository Structure

This monorepo contains:

- **`sdk/`** - Python SDK ([PyPI](https://pypi.org/project/hypercli-sdk/))
- **`cli/`** - Command-line interface ([PyPI](https://pypi.org/project/hypercli-cli/))
- **`docs/`** - Documentation source files
- **`site/`** - Marketing and console web applications

## Documentation

- **Website:** [hypercli.com](https://hypercli.com)
- **Documentation:** [docs.hypercli.com](https://docs.hypercli.com)
- **API Reference:** [docs.hypercli.com/api-reference](https://docs.hypercli.com/api-reference)
- **API Endpoint:** [api.hypercli.com](https://api.hypercli.com)

## Development

### SDK Development

```bash
cd sdk
pip install -e ".[dev]"
pytest
```

### Agents E2E Debugging

For Claw agent launch and gateway failures, run the full checkout path and keep
the failed container around for inspection. This test must verify Stripe
redirects back to `/plans`, granted slots increase, and the purchased slot can
launch/connect an agent. Cleanup is best-effort.

```bash
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

If it fails, rerun the same spec inside the live container:

```bash
docker exec -it hypercli-e2e-agents-debug bash
cd /workspace/site
npx playwright test \
  --config tests/claw/playwright.config.ts \
  tests/claw/agents-subscription.spec.ts
```

`E2E_KEEP_ALIVE_ON_FAILURE=1` leaves the container and Next servers running.
`TEST_CLAW_ADMIN_LOGIN_SHORTCUT=1` uses admin auth instead of OTP when the admin
keys are available. Keep secrets in `.env.agents`. The E2E image contains a
copied workspace, so rebuild after source edits or bind-mount the specific test
file you are iterating on.

CI failure notifications attach the Playwright video first. The E2E scripts
convert `video.webm` to MP4 and only fall back to screenshots when no video
artifact exists.

### Frontend SDK Dependency

The frontend in [`site/`](/home/ubuntu/dev/hypercli/site) is built and deployed
by CI as a workspace. Site builds should use the sibling `ts-sdk/` checkout so
frontend changes are tested with the current SDK source.

For normal frontend work:

```bash
cd site
npm install
npm run dev
```

For local TypeScript SDK development against the frontend:

```bash
cd ~/dev/hypercli/ts-sdk
npm install
npm run build

cd ~/dev/hypercli/site
npm run sdk:use-checkout
npm run dev
```

### Claw Files UI

The live Claw file-browser implementation is
`apps/claw/src/components/dashboard/files`, with agent workspace composition in
`AgentFilesPanel`. Do not restore the removed `dashboard/files-panel` tree; it
was stale duplicate UI.

That checkout override should remain local to the build/dev environment. CI
uses the same sibling checkout during site build/publish; Netlify should only
publish artifacts produced by CI, not build the repo itself.

To remove the override and go back to the published package:

```bash
cd ~/dev/hypercli/site
npm run sdk:use-published
```

That reset script removes any local override from `node_modules` first, then reinstalls the pinned published package from the lockfile.

This keeps local development flexible without making CI or Netlify depend on the parent repo layout.

### CLI Development

```bash
cd cli
pip install -e ".[dev]"
```

### Building Packages

```bash
python -m build sdk/
python -m build cli/
```

## Links

- **Dashboard:** [console.hypercli.com](https://console.hypercli.com)
- **GitHub:** [github.com/HyperCLI/hypercli](https://github.com/HyperCLI/hypercli)
- **Support:** support@hypercli.com
- **Twitter/X:** [@hypercliai](https://x.com/hypercliai)

## License

MIT License - Copyright (c) 2025 HyperCLI, Inc.

See [LICENSE](LICENSE) for details.
