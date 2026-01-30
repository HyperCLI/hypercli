# HyperCLI CLI

Command-line interface for [HyperCLI](https://hypercli.com) - GPU orchestration and LLM API.

## Installation

```bash
pip install hypercli-cli
```

This also installs the `hypercli-sdk` as a dependency.

## Setup

Configure your API key:

```bash
hyper configure
```

Or set via environment:

```bash
export HYPERCLI_API_KEY=your_key
```

Or create `~/.hypercli/config`:

```
HYPERCLI_API_KEY=your_key
```

Get your API key at [hypercli.com/dashboard](https://hypercli.com/dashboard)

## Usage

### Billing

```bash
hyper billing balance
hyper billing transactions
hyper billing balance -o json
```

### LLM

```bash
# List models
hyper llm models

# Quick chat
hyper llm chat deepseek-v3.1 "Explain quantum computing"

# Interactive chat
hyper llm chat deepseek-v3.1

# With system prompt
hyper llm chat deepseek-v3.1 "Write a haiku" -s "You are a poet"
```

### Jobs

```bash
# List jobs
hyper jobs list
hyper jobs list -s running

# Create a job
hyper jobs create nvidia/cuda:12.0 -g l40s -c "python train.py"

# Create and follow logs with TUI
hyper jobs create nvidia/cuda:12.0 -g h100 -n 8 -c "torchrun train.py" -f

# Get job details
hyper jobs get <job_id>

# Stream logs
hyper jobs logs <job_id> -f

# Watch GPU metrics
hyper jobs metrics <job_id> -w

# Cancel
hyper jobs cancel <job_id>

# Extend runtime
hyper jobs extend <job_id> 7200
```

### User

```bash
hyper user
```

## Output Formats

```bash
hyper jobs list -o json
hyper billing balance -o table
```

## License

MIT
