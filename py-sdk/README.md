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

## Hosted Agents & Inference

Use `client.agent` for discovery and plan metadata, and point the OpenAI SDK at
the hosted inference base URL for chat completions:

```python
from hypercli import HyperCLI
from openai import OpenAI

sdk = HyperCLI(api_key="hyper_api_key", agent_api_key="hyper_api_agent_key")
plans = sdk.agent.plans()
trial = sdk.agent.create_stripe_trial_checkout()
activation = sdk.deployments.redeem_grant_code("PROMO123")
renewal = sdk.deployments.redeem_grant_code("PROMO123", extend_existing=True)

client = OpenAI(
    api_key="your_hyperagent_api_key",
    base_url="https://api.agents.hypercli.com/v1"
)

response = client.chat.completions.create(
    model="kimi-k3",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

`create_stripe_trial_checkout()` creates the account's one-time Team trial checkout session. `claim_trial_entitlement()` (the former bodyless `POST /agents/plans/trial` claim) is deprecated: the route no longer exists in the backends. `deployments.redeem_grant_code()` applies a promo/activation code to the current agents account and returns the created entitlement. Codes create new entitlements by default; pass `extend_existing=True` only for renewal/extension behavior.

Plan IDs are open strings on the wire so future and historical plans continue
to parse. `plan.canonical_id` recognizes the current `solo`, `team`, and `pro`
IDs. Plan access comes from the agents summary, including direct grants:

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
`files_list("")` lists the complete root, including dot-directories.
`build_openclaw_desktop_route()` builds the protected `desktop` route for pro
launches; there is no public `openclaw` gateway route (the pod gateway binds
loopback with auth mode `none` as an ACP hop only). The canonical images are
`ghcr.io/hypercli/hypercli-openclaw:prod` for regular OpenClaw and
`ghcr.io/hypercli/hypercli-openclaw:pro-prod` for desktop/pro OpenClaw — pass
the image, `sync_root`, and exclusion choices explicitly in the launch config.
`create_agent` instead injects the runtime-specific include defaults documented in
[`coding-runtimes.mdx`](../docs/agents/coding-runtimes.mdx); pass an explicit
nullable policy at create time to select the whole root.
Workspaces boot sync defaults on through `build_openclaw_workspaces_sync_env()`
— applied automatically by `create_agent` — with
`HYPER_WORKSPACES_DIR` defaulting to `/home/node/shared` unless the launch
`env` supplies one.
`build_openclaw_trusted_proxies_env([...])` builds the comma-separated
`OPENCLAW_TRUSTED_PROXIES` env, a full replacement for OpenClaw
`gateway.trustedProxies`.

```python
launch_config = build_agent_config(
    image="ghcr.io/example/agent:latest",
    registry_url="registry.example.com",
    registry_auth={"username": "ci", "password": "token"},
)
agent = client.deployments.create(
    name="docs-demo",
    image=launch_config["image"],
    registry_url=launch_config["registry_url"],
    registry_auth=launch_config["registry_auth"],
)
agent = client.deployments.wait_for_state(agent.id, {"stopped"}, timeout=330)
client.deployments.update(agent.id, launch_config=launch_config)
agent = client.deployments.start(agent.id)
agent = client.deployments.wait_running(agent.id, timeout=300)

capacity = client.deployments.list_with_capacity()
print(capacity.max_agents_per_account, capacity.running_agents)
for slot in capacity.agent_slots:
    print(slot.size, slot.plan_id, slot.agent_id)
```

`start()` starts the Backend-stored launch config and does not accept launch
mutation options. Change launch settings through
`update(..., launch_config=...)` before starting.

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

Persist the desktop/browser launch through `create(...)` or `update(..., launch_config=...)` (build the payload with `build_agent_config`). The pro launch config selects `ghcr.io/hypercli/hypercli-openclaw:pro-prod`, enables noVNC through a protected `desktop` route (the `desktop-<agent>.hypercli.app` host, port 3000, `auth=True`), and sets `HYPER_DESKTOP_ENABLED=1`.

Automatic memory indexing is off by default. Opt in by merging `build_openclaw_memory_index_env({"on_session_start": True, "on_search": True, "watch": True, "watch_debounce_ms": 30000, "interval_minutes": 0})` into the launch `env`.

## Hosted Coding Agents

Native Buzz Agent, OpenCode, Codex, Claude Code, Goose, and Kimi Code use
canonical managed-runtime images.
They have no public runtime port: lifecycle, exec, shell, workspace sync, and
authentication all use the existing authenticated deployment APIs. OpenCode
and Goose default to HyperCLI's Anthropic-native `default-anthropic` route (currently `kimi-k3-anthropic`).
Kimi Code keeps Moonshot's upstream device login and service.
Claude Code, Codex, and Kimi Code are native-login-first. For Buzz-managed
launches, `HYPERCLI_RUNTIME_INFERENCE=hypercli` is an explicit compatibility
switch for Claude and Kimi. The gateway now exposes `/v1/responses`, and Buzz
compatibility mode renders Codex with `wire_api="responses"`; a successful
HyperCLI-model Codex Responses E2E remains unvalidated, so that path is not yet
advertised as supported. See the
[runtime and persistence matrix](../docs/agents/coding-runtimes.mdx).

All coding runtimes share one launch contract, `create_agent(runtime, ...)`;
`runtime` selects the default image, sync includes, and harness env, and the
launch env always carries `HYPER_ACP_PERMISSIONS` (built from
`permission_mode`). The accepted runtimes are `buzz-agent`, `opencode`,
`codex`, `claude-code`, `goose`, `kimi-code`, and `pi`.
`create_coding_agent` survives only as a deprecated alias that warns and
forwards to `create_agent`.

```python
buzz_agent = client.deployments.create_agent("buzz-agent", name="buzz-agent")
agent = client.deployments.create_agent("opencode", name="opencode")
codex = client.deployments.create_agent("codex", name="codex")
claude = client.deployments.create_agent("claude-code", name="claude")
goose = client.deployments.create_agent("goose", name="goose")
kimi = client.deployments.create_agent("kimi-code", name="kimi")

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

The images default to a long-lived direct shell/exec container. The managed
platform (runner/Lagoon) injects consistent defaults for `HYPER_API_BASE`
(product/inference), `HYPER_AGENTS_API_BASE` (direct Agent control), the
appropriate ACP URL, and agent-scoped `HYPER_AGENTS_API_KEY`.
Customers may override either base and supply canonical `HYPER_API_KEY`
through launch `env` or `secrets`, including for managing other agents. Clients
prefer an explicit canonical credential, environment `HYPER_API_KEY`, then the
configured canonical key before the platform runtime fallback. The launch
owner's auth key is never automatically forwarded.
The Agents base never selects inference. External inference URLs/keys must not
implicitly redirect platform callbacks or reconnects. Explicit `HYPER_ACP_WS_URL`
wins; otherwise derive from the Agents base, using the product base only when
no Agents base is supplied. ACP authentication uses the separate runtime key.

The typed Buzz launch contract (`BuzzLaunchConfig`) is TS-SDK-only:
`create_agent` accepts no `buzz=` option, and passing a `buzz` keyword raises
`TypeError`. Use the TS SDK's `createAgent(runtime, { buzz: ... })` for a
Buzz-managed identity launch, or render the raw contract yourself over the
generic launch surface: put `BUZZ_PRIVATE_KEY` (and optionally
`NOSTR_PRIVATE_KEY`) in `env` — `create_agent` promotes both to launch
secrets — and pass the remaining `BUZZ_*` keys as launch environment for the
managed image to parse at boot.

Caller environment becomes raw deployment environment values.
The agents backend currently persists them in `Agent.launch_config`, and
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

## Platform session metadata

```python
from hypercli import HyperCLI, SessionRecord

client = HyperCLI()
# Platform ID from /ws/acp session/new or deployments.list_sessions(), not a leg ID.
session: SessionRecord = client.deployments.get_session(platform_session_id)
print(session.source, session.summary_text, session.participants)
```

`get_session()` calls `GET /agents/sessions/{id}` using the existing caller
credentials and the same `SessionRecord` decoder as `list_sessions()`. Nullable
source values are forward-compatible strings; the title is `summary_text`.
Timestamps and participant dictionaries retain the existing catalog shape.
Reads work offline without runtime connections or receipt advancement. HTTP
errors propagate as `APIError`: 404 unknown session, 403 outside participation
scope, 422 invalid UUID. No service impersonation or runtime-ID resolution occurs.

## ACP v2 conversation client

`hypercli.acp.ACPClient` connects to the backend `/ws/acp` authority using the
pinned upstream experimental v2 SDK (alpha.5 schema, Git commit
`9d07d7871ef4b220b8507e15fc4b1560f0950a64`). Install with a Git-enabled pip
environment; pip provisions the upstream declared `pdm-backend` build prerequisite
in build isolation. The frontend is v2; runtime leg negotiation belongs to Backend.

```python
from hypercli.acp import ACPClient, AmbiguousDeliveryError, RetryableACPError

async with await ACPClient.connect(proxy_url, token=api_key, on_update=handle_update) as acp:
    session_id = await acp.new_session(cwd="/home/node")
    accepted = await acp.submit_prompt(session_id, "Summarize overnight mail")
    print(accepted.message_id)  # conversation insertion, not execution
```

Use `resume_session(id, cwd=..., replay=True)` to restore and replay via standard
ACP, without a private URL attachment prerequisite. `load_session` is a local
compatibility helper name for that v2 operation; it does not send `session/load`.
`cancel(id)` sends the standard notification, never a replacement prompt.

`prompt(id, blocks, timeout=...)` requires a `get_prompt_completion(session_id,
message_id)` async callback at connect time. The callback must read authoritative
completion evidence for that exact insertion. `Deployments.get_prompt_completion`
does this using the existing paged session-history endpoint, matching the accepted
ID, user row sequence, target agent and terminal record. Wrap this synchronous
getter with `asyncio.to_thread` for the async callback.

Idle only triggers verification. If this input has no receipt (for example older
queued work stopped first, or a v2 runtime provided only acceptance), the helper
fails rather than guessing success. Without a reader it refuses before sending.
`submit_prompt` remains standard admission-only and needs no REST reader.

Known pre-write failures raise `RetryableACPError`; uncertain post-write/foreground
outcomes raise `AmbiguousDeliveryError`. Neither is automatically retried. Protocol
errors preserve code, message and data through `ACPRequestError`. Metadata and read
receipts stay on the existing platform REST APIs, not ACP fields or `_meta`.

The TypeScript SDK exposes the same separation as `submitPrompt` versus `prompt`.
Python is one-shot: it does not reconnect or replay submissions automatically.

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
