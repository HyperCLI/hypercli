# HyperCLI SDK

Python SDK for [HyperCLI](https://hypercli.com) - GPU orchestration API.

## Installation

```bash
pip install hypercli-sdk
```

## Setup

Set your API key:

```bash
export HYPERCLI_API_KEY=your_api_key
```

Or create `~/.hypercli/config`:
```
HYPERCLI_API_KEY=your_api_key
```

Or pass directly:
```python
client = HyperCLI(api_key="your_api_key")
```

## Usage

```python
from hypercli import HyperCLI

client = HyperCLI()

# Check balance
balance = client.billing.balance()
print(f"Balance: ${balance.total:.2f}")
print(f"Rewards: ${balance.rewards:.2f}")

# List transactions
for tx in client.billing.transactions(limit=10):
    print(f"{tx.transaction_type}: ${tx.amount_usd:.4f}")

# Create a job
job = client.jobs.create(
    image="nvidia/cuda:12.0",
    command="python train.py",
    gpu_type="l40s",
    gpu_count=1,
)
print(f"Job ID: {job.job_id}")
print(f"State: {job.state}")

# List jobs
for job in client.jobs.list():
    print(f"{job.job_id}: {job.state}")

# Get job details
job = client.jobs.get("job_id")

# Get job logs
logs = client.jobs.logs("job_id")

# Get GPU metrics
metrics = client.jobs.metrics("job_id")
for gpu in metrics.gpus:
    print(f"GPU {gpu.index}: {gpu.utilization}% util, {gpu.temperature}°C")

# Cancel a job
client.jobs.cancel("job_id")

# Extend runtime
client.jobs.extend("job_id", runtime=7200)

# Get user info
user = client.user.get()
print(f"User: {user.email}")
```

## LLM API

For LLM access, use the OpenAI SDK with C3's base URL:

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

## Error Handling

```python
from hypercli import HyperCLI, APIError

client = HyperCLI()

try:
    job = client.jobs.get("invalid_id")
except APIError as e:
    print(f"Error {e.status_code}: {e.detail}")
```

## License

MIT
