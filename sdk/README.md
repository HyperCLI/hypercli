# HyperCLI SDK

Python SDK for [HyperCLI](https://hypercli.com) - GPU orchestration API.

## Installation

```bash
pip install hypercli-sdk
```

## Setup

Set your API key:

```bash
export HYPER_API_KEY=your_api_key
```

Or create `~/.hypercli/config`:
```
HYPER_API_KEY=your_api_key
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

## HyperAgent API

Use `client.agent` for discovery and plan metadata, and point the OpenAI SDK at
the HyperClaw inference base URL for chat completions:

```python
from hypercli import HyperCLI
from openai import OpenAI

sdk = HyperCLI(api_key="hyper_api_key", agent_api_key="sk-agent")
plans = sdk.agent.plans()
activation = sdk.agent.redeem_grant_code("PROMO123")
renewal = sdk.agent.redeem_grant_code("PROMO123", extend_existing=True)

client = OpenAI(
    api_key="your_hyperagent_api_key",
    base_url="https://api.hypercli.com/v1"
)

response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

`redeem_grant_code()` applies a promo/activation code to the current HyperClaw account and returns the created entitlement. Codes create new entitlements by default; pass `extend_existing=True` only for renewal/extension behavior.

## OpenClaw Agents

OpenClaw uses the generic deployment launch surface. `registry_url`, `registry_auth`, `sync_root`, and `sync_enabled` are generic deployment options; the OpenClaw helpers only add defaults such as routes, image, and `sync_root=/home/node`.

```python
agent = client.deployments.create_openclaw(
    name="docs-demo",
    start=True,
    registry_url="git.nedos.co",
    registry_auth={"username": "ci", "password": "token"},
)
```

Use `create_openclaw_pro(...)` for the desktop/browser image. It enables noVNC through the protected `desktop-<agent>.hypercli.app` route and sets `OPENCLAW_DESKTOP_ENABLED=1`.

`heartbeat` maps directly to upstream OpenClaw config at `config.agents.defaults.heartbeat`. Omit it to keep upstream defaults, or pass values such as `heartbeat={"every": "1h", "target": "last"}`.

Automatic memory indexing is off by default. Opt in with `memory_index={"on_session_start": True, "on_search": True, "watch": True, "watch_debounce_ms": 30000, "interval_minutes": 0}`.

## Hosted Coding Agents

OpenCode, Codex, Claude Code, Goose, and Kimi Code use canonical Reef images
with Buzz ACP as a private stdio harness. They have no public runtime port:
lifecycle, exec, shell, workspace sync, and authentication all use the existing
authenticated deployment APIs. OpenCode and Goose default to HyperCLI's
Anthropic-native `kimi-k2.6-anthropic` route. Kimi Code keeps Moonshot's
upstream device login and service.

```python
agent = client.deployments.create_opencode(name="opencode")
codex = client.deployments.create_codex(name="codex")
claude = client.deployments.create_claude_code(name="claude")
goose = client.deployments.create_goose(name="goose")
kimi = client.deployments.create_kimi_code(name="kimi")

methods = codex.auth.methods()
status = codex.auth.status()

async with await codex.auth.login("device") as login:
    print(login.verification_url, login.user_code)
    await login.wait()
```

The login helper opens a short-lived, agent-bound shell WebSocket and runs the
runtime's native login command inside the Reef pod. It never puts an API key on
the command line. Runtime credentials and state live under the persistent
`/home/node` sync root.

The images default to a long-lived direct shell/exec container. A Buzz provider
launches one for a Buzz-managed identity with the typed launch contract:

```python
from hypercli import BuzzLaunchConfig

agent = client.deployments.create_opencode(
    name="buzz-opencode",
    env={"HYPER_API_KEY": inference_key},
    buzz=BuzzLaunchConfig(
        private_key_nsec=agent_nsec,
        relay_url=relay_url,
        auth_tag=owner_signed_auth_tag,
        parallelism=1,
    ),
)
```

The SDK selects `/usr/local/bin/buzz-acp`, the runtime-specific child ACP
command and arguments, the hosted Buzz MCP command, lazy pool creation, relay
observation, and persistent `/home/node` settings. Buzz-reserved environment
keys are rendered from the typed object after caller environment values.
`buzz_enabled=True` remains as a deprecated raw-environment compatibility path.

Buzz launches require `size="large"`; ordinary coding-agent helpers preserve a
caller-provided size or the backend default. Stock Buzz provider agents do not
start on app launch and the current provider protocol has no stop callback.
Editing a running agent does not replace its HyperCLI launch environment: stop
the deployment through the authenticated HyperCLI API and deploy it again from
Buzz to apply changes.

Stock Buzz does not automatically publish ordinary ACP assistant text. A
visible reply requires the agent to invoke the Buzz send command/tool. The
five-runtime test coverage validates request rendering, not live launches;
OpenCode is the hosted path exercised so far, including explicit outbound
publishing.

The agent nsec and caller environment become raw deployment environment values.
The HyperClaw backend currently persists them in `Agent.launch_config`, and
authenticated deployment read, environment, or exec surfaces may expose them.
The default `RUST_LOG` filter disables `acp::stream` content logging; overriding
it can expose generated text in container logs.

## OpenClaw Node Egress

The Python SDK includes an experimental reference implementation for user-owned
node egress in `hypercli.openclaw.node_proxy`. It uses the existing OpenClaw
node model:

- a node connects to the gateway with `role="node"`
- the node declares explicit `egress.*` command names during the connect
  handshake
- an operator/client calls `GatewayClient.node_invoke(node_id, command, params)`
- the gateway sends one `node.invoke.request` and waits for one
  `node.invoke.result`

This is not raw sockets over the gateway. It is node RPC with chunked payloads
and gateway policy approval.

Node side:

```python
from hypercli.openclaw import NodeEgressServer

node = NodeEgressServer(
    "wss://my-agent.hypercli.app",
    "home-linux-egress",
    gateway_token="...",
)

await node.connect()
```

Operator side:

```python
from hypercli.openclaw import EGRESS_COMMANDS, NodeEgressClient

egress = NodeEgressClient(gateway, node_id="home-linux-egress")
res = await egress.http_fetch("https://example.com/")
```

Commands:

- `egress.http.fetch`: bounded HTTP(S) fetch, response body returned as base64
  chunks
- `egress.tcp.open/read/write/close`: experimental TCP tunnel primitives used
  by `LoopbackNodeProxy` for HTTP `CONNECT`

Security defaults:

- local proxy binds to `127.0.0.1` by default
- node id is explicit; no automatic node selection
- RFC1918/private, loopback, link-local, multicast, reserved, and metadata IPs
  are blocked by default unless explicitly allowed on the node
- chunks are small and bounded; responses are not returned as one unbounded
  base64 blob

Pairing and policy:

- the node must be device-paired
- the node command surface must be approved
- custom `egress.*` commands may need `gateway.nodes.allowCommands`

Python/Linux is first because it is easiest to test in CI and the Python SDK
already ships `NodeServer`. The portable contract is the command surface and
payload shape, not the Python implementation. macOS Backseat Driver already
proves the native node-host precedent; Android should eventually gain Kotlin
`NodeRuntime` parity; the TS SDK can mirror operator/client types if useful.

`LoopbackNodeProxy` can relay absolute-form HTTP requests and has experimental
`CONNECT` support over polling/chunked `node.invoke`. Treat CONNECT as a
feasibility prototype, not production-grade streaming.

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
