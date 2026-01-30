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
