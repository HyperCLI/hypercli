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

sdk = HyperCLI(api_key="hyper_api_key", agent_api_key="hyper_api_agent_key")
plans = sdk.agent.plans()
trial = sdk.agent.claim_trial_entitlement()
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

`claim_trial_entitlement()` sends an authenticated, bodyless claim to `/agents/plans/trial` and returns the backend-created introductory entitlement. Trial eligibility is decided exclusively by the backend. `redeem_grant_code()` applies a promo/activation code to the current HyperClaw account and returns the created entitlement. Codes create new entitlements by default; pass `extend_existing=True` only for renewal/extension behavior.

Plan IDs are open strings on the wire so future and historical plans continue
to parse. `plan.canonical_id` recognizes the current `solo`, `team`, and `pro`
IDs. Plan access comes from the HyperClaw summary, including direct grants:

```python
summary = sdk.agent.subscription_summary()
if summary.has_active_plan:  # active subscription OR direct entitlement
    print(summary.agent_slots)
```

Do not substitute the Orchestra `/api/auth/me` subscription flag. If the
summary request returns `401` or `403`, the selected key cannot establish plan
state; treat it as unknown rather than as no plan.

## OpenClaw Agents

OpenClaw uses the generic deployment launch surface. `registry_url`,
`registry_auth`, and `sync_root` are generic deployment options. A nonblank
`sync_root` enables Reef persistence; no separate `sync_enabled` field is
serialized. On generic create, no include/exclude policy means the complete
root; `sync_exclude=[]` also excludes nothing. `sync_include=[]` and
root-wide excludes such as `sync_exclude=["*"]` are invalid.
Steady Reef synchronization
is PVC-to-object-storage upload/overwrite, not a two-way mirror: ordinary
filesystem deletes are not propagated, and remote-to-PVC copying occurs only
during explicit cold restore. Each SDK file operation obtains a fresh
files-scoped credential from Backend, then lists, reads, writes, or deletes
directly against the retained Reef server; Backend never carries file bytes.
Per-file writes are limited to 100 MiB (`AGENT_FILE_WRITE_MAX_BYTES`, the
Cloudflare edge request-body cap on the agent hostname); split larger data
across files or sync it via the agent's own tooling.
File paths are relative to `sync_root`, and
`files_list("")` lists the complete root, including dot-directories. The
OpenClaw helpers always ensure the canonical `openclaw` gateway route
(`prefix=""`, `port=18789`, `auth=False`) and add concrete image,
`sync_root=/home/node`, and cache/Workspace exclusions by default. Regular
OpenClaw defaults to `ghcr.io/hypercli/hypercli-openclaw:prod`; desktop/pro
OpenClaw defaults to `ghcr.io/hypercli/hypercli-openclaw:pro-prod`. Coding
helpers instead inject the runtime-specific include defaults documented in
[`coding-runtimes.mdx`](../docs/agents/coding-runtimes.mdx); pass an explicit
nullable policy at create time to select the whole root.
Both helper families default `HYPER_WORKSPACES_DIR` to `/home/node/shared` and
preserve an explicit value supplied in the launch `env`.

```python
launch_config = build_agent_config(
    image="ghcr.io/example/agent:latest",
    registry_url="git.nedos.co",
    registry_auth={"username": "ci", "password": "token"},
)
agent = client.deployments.create(
    name="docs-demo",
    image=launch_config["image"],
    registry_url=launch_config["registry_url"],
    registry_auth=launch_config["registry_auth"],
)
agent = client.deployments.wait_for_state(agent.id, {"stopped"}, timeout=330)
agent = client.deployments.start(agent.id, launch_config)
agent = client.deployments.wait_running(agent.id, timeout=300)

capacity = client.deployments.list_with_capacity()
print(capacity.max_agents_per_account, capacity.running_agents)
for slot in capacity.agent_slots:
    print(slot.size, slot.plan_id, slot.agent_id)
```

`start()` and `start_openclaw()` require a complete `launch_config`. The SDK
sends it as one replacement object and never merges omitted fields with the
stored Agent. `start_openclaw()` still ensures the canonical gateway route
before submitting. Retain caller-owned application secrets needed for a later
typed start; hydrated Agents never recover secret values.

`archive()` returns the accepted `ARCHIVING` Agent projection. `delete()` uses
HTTP 200 to accept a durable soft delete; cluster-local cleanup continues in
the background, so that response is not cleanup completion.

`list()` remains the compatibility list of agents. `list_with_capacity()`
preserves the full deployment envelope: saved/running account limits, pooled
TPD, aggregate slot inventory, and individual entitlement-backed agent slots.

For a long-lived UI, subscribe to thin invalidations and refresh REST in the
handler:

```python
import asyncio

async def changed(_event):
    agents = await asyncio.to_thread(client.deployments.list)
    render(agents)

async def snapshot():
    agents = await asyncio.to_thread(client.deployments.list)
    render(agents)

stop = asyncio.Event()
await client.deployments.subscribe(changed, stop_event=stop, on_ready=snapshot)
```

The `on_ready` callback runs after user-stream authentication and before event
frames are read; it repeats after reconnect so no transition can slip
between snapshot and subscription. Transition events carry `agent_id` for
local filtering plus `state`, `reason`, `error`, and `message`, but are not
resource snapshots and may be duplicated or coalesced; refresh REST for
authority.

Managed-agent lifecycle snapshots currently use `CREATING`, `STARTING`,
`RESTORING`, `RUNNING`, `STOPPING`, `STOPPED`, `ARCHIVING`, `ARCHIVED`,
`FAILED`, and `DELETED`. `CREATING` is fresh admission, `STARTING` resumes a
warm retained agent, and `RESTORING` hydrates a cold agent from its exact
archive checkpoint. `STOPPED` retains warm local storage. `ARCHIVING` is the
public transition to verified cold storage.
`ARCHIVED` is the Backend-persisted cold-restorable terminal projection after
Lagoon drops its agent task, namespace, PVC, and local S3 copy. `DELETED` is a
Backend-only terminal state and normally hidden from user lists. State values
remain open strings; use REST as authority instead of
recreating the server lifecycle machine in the client. Each snapshot may also
carry open-string diagnostics: `reason` is the stable cause such as `start`,
`api_stop`, `runtime_exit`, `timeout`, or `delete`, `error` is a failure code
when the transition failed, and `message` is human-readable context.

Use `create_openclaw_pro(...)` or `start_openclaw_pro(...)` for the desktop/browser image. It selects `ghcr.io/hypercli/hypercli-openclaw:pro-prod`, enables noVNC through the protected `desktop-<agent>.hypercli.app` route, and sets `OPENCLAW_DESKTOP_ENABLED=1`.

`heartbeat` maps directly to upstream OpenClaw config at `config.agents.defaults.heartbeat`. Omit it to keep upstream defaults, or pass values such as `heartbeat={"every": "1h", "target": "last"}`.

Automatic memory indexing is off by default. Opt in with `memory_index={"on_session_start": True, "on_search": True, "watch": True, "watch_debounce_ms": 30000, "interval_minutes": 0}`.

## Hosted Coding Agents

Native Buzz Agent, OpenCode, Codex, Claude Code, Goose, and Kimi Code use
canonical managed-runtime images.
They have no public runtime port: lifecycle, exec, shell, workspace sync, and
authentication all use the existing authenticated deployment APIs. OpenCode
and Goose default to HyperCLI's Anthropic-native `kimi-k2.6-anthropic` route.
Kimi Code keeps Moonshot's upstream device login and service.
Claude Code, Codex, and Kimi Code are native-login-first. For Buzz-managed
launches, `HYPERCLI_RUNTIME_INFERENCE=hypercli` is an explicit compatibility
switch for Claude and Kimi. The gateway now exposes `/v1/responses`, and Buzz
compatibility mode renders Codex with `wire_api="responses"`; a successful
HyperCLI-model Codex Responses E2E remains unvalidated, so that path is not yet
advertised as supported. See the
[runtime and persistence matrix](../docs/agents/coding-runtimes.mdx).

```python
buzz_agent = client.deployments.create_buzz_agent(name="buzz-agent")
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
runtime's native login command inside the managed runtime. It never puts an API key on
the command line. Runtime credentials and state live under the persistent
`/home/node` sync root.

Authentication is runtime-specific rather than one universal login protocol.
Native Buzz Agent has no separate login step and uses its injected model and
provider configuration. OpenCode combines adapter discovery with its
interactive provider login; Codex
adds native device login; Claude Code exposes Claude.ai, Console, and SSO;
Goose uses its injected deployment credential; and Kimi Code uses the
upstream adapter's methods. Goose and Kimi Code do not expose a noninteractive
logout command through this SDK surface.

The images default to a long-lived direct shell/exec container. A Buzz provider
launches one for a Buzz-managed identity with the typed launch contract:

```python
from hypercli import BuzzLaunchConfig

agent = client.deployments.create_opencode(
    name="buzz-opencode",
    buzz=BuzzLaunchConfig(
        private_key_nsec=agent_nsec,
        relay_url=relay_url,
        auth_tag=owner_signed_auth_tag,
        parallelism=1,
    ),
)
```

The managed platform injects an agent-scoped `HYPER_AGENTS_API_KEY` into the
runtime. Do not copy an account API key into the launch environment.

The SDK selects `/usr/local/bin/buzz-acp`, the runtime-specific child ACP
command and arguments, the hosted Buzz MCP command, lazy pool creation, relay
observation, and persistent `/home/node` settings. `/home/node/shared`
remains reserved for Workspace projections; the specialized image reconciles
the Buzz nest after the home mount and runs the harness from
`/home/node/.buzz`. OpenCode and Codex read its canonical `AGENTS.md`, while
Claude Code receives `CLAUDE.md -> AGENTS.md`. `base_prompt.md` stays compiled
into `buzz-acp`. Buzz-reserved environment keys are rendered from the typed
object after caller environment values.
`buzz_enabled=True` remains as a deprecated raw-environment compatibility path.
Typed and compatibility Buzz launches select the matching `hypercli-buzz`
image family (`buzz-agent`, `opencode`, `codex`, `claude`, `goose`, or
`kimi-code`) by
default. Ordinary coding-agent helpers without Buzz keep the generic
`ghcr.io/hypercli/hypercli-<runtime>:latest` default, except native Buzz Agent,
whose runtime image is already `hypercli-buzz-agent`. An explicit `image=`
continues to override either default.

Direct `BuzzLaunchConfig` renders timeout and response-policy values but does
not duplicate the stock Desktop provider's validation; invalid combinations
are rejected later by `buzz-acp`. The Desktop provider also maps structured
Goose model/provider fields to `GOOSE_MODEL`/`GOOSE_PROVIDER`; direct Python
SDK callers must set any Goose-specific environment themselves.

Buzz launches leave size unset for live backend/provider slot selection;
ordinary coding-agent helpers preserve a caller-provided size or the backend
default. Stock Buzz provider agents do not
start on app launch and the current provider protocol has no stop callback.
Editing a running agent does not replace its HyperCLI launch environment: stop
the deployment through the authenticated HyperCLI API and deploy it again from
Buzz to apply changes. A successfully delivered and accepted `!shutdown` can
exit a new `restart=False` launch; the hosted terminal-state observer then
reports `stopping`, completes runtime cleanup, marks the deployment `stopped`,
and releases its slot. Desktop receives no provider acknowledgement and keeps
its local deployed record.

Stock Buzz expects ACP NDJSON. It skips non-JSON child stdout, and
`agent_message_chunk` is activity telemetry rather than a channel reply. There
is no plaintext fallback; a visible reply requires the agent to invoke the Buzz
send command/tool. The six-runtime SDK coverage validates request rendering,
not live launches.

The agent nsec and caller environment become raw deployment environment values.
The HyperClaw backend currently persists them in `Agent.launch_config`, and
authenticated deployment read, environment, or exec surfaces may expose them.
The default `RUST_LOG` filter disables `acp::stream` content logging; overriding
it can expose generated text in container logs.

Persisted launch environment values can be changed one key at a time while an
agent is stopped:

```python
agent.set_env("LOG_LEVEL", "debug")
agent.delete_env("LOG_LEVEL")
agent.set_secret("SERVICE_TOKEN", token)
agent.delete_secret("SERVICE_TOKEN")
```

These methods return `AgentLaunchValueMutation` metadata. Secret writes never
echo the secret value in their response.

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

The placeholder is the canonical shared `OPENCLAW_GATEWAY_TOKEN`; load it from
a trusted secret source and keep it in memory. Device identity and scoped
device tokens are separate from that shared credential. A managed Agent can
auto-approve a cold not-paired response through trusted exec, while a warm
connection reuses the device credential for the same deployment and role.

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
