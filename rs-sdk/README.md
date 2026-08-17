# HyperCLI Rust SDK

`hypercli-sdk` is the reusable typed Rust client for HyperCLI managed-agent
deployments. Executable integrations belong in their own top-level packages;
the Buzz provider lives in `../buzz-backend-provider/`.

The Rust SDK does not choose runtime images. Generic callers set
`CreateDeploymentRequest.image` themselves, while the Buzz provider owns its
dedicated `hypercli-buzz-*` default catalog. This keeps reusable launch
rendering separate from provider image policy.

The repository root is the Cargo workspace. Run Rust gates from there:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo doc --workspace --all-features --no-deps --locked
cargo package -p hypercli-sdk --allow-dirty --locked
```

The client reads credentials and endpoint configuration from environment
variables and `~/.hypercli/config`. Set `HYPER_HTTP_TRACE_FILE` to append
mode-`0600` JSONL request traces. Trace payloads recursively redact
secret-looking fields, omit authorization headers, and never record response
bodies.

## Launch and lifecycle updates

Create the authoritative REST resource, then wait for lifecycle events to wake
REST confirmation:

```rust,no_run
use std::time::Duration;
use hypercli_sdk::{AgentSize, CreateDeploymentRequest, HyperCliClient, ManagedRuntime, StartDeploymentRequest};

# async fn example(client: &HyperCliClient) -> Result<(), Box<dyn std::error::Error>> {
let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
request.name = Some("docs-demo".into());
request.size = Some(AgentSize::Small);
request.sync_exclude = Some(vec![]); // whole-root sync

let created = client.create_deployment(&request)?;
let created = client
    .wait_deployment_state(&created.id, &["stopped"], &["failed", "deleted"], Duration::from_secs(330))
    .await?;
let start = StartDeploymentRequest::new(request.launch_config.clone());
client.start_deployment(&created.id, &start)?;
let running = client
    .wait_deployment_running(&created.id, Duration::from_secs(300))
    .await?;
println!("{} {}", running.id, running.state);
# Ok(())
# }
```

Lifecycle mutations remain separate calls:
`start_deployment(id, request)`, `stop_deployment(id)`,
`archive_deployment(id)`, and `restore_deployment(id)`. Archive and restore use
bodyless POST requests and never launch the runtime.

For a newly issued hostname, consumers can use
`wait_deployment_running_settled(&created.id, timeout, None)`.  It waits for
the API state and then applies the bounded
`DEFAULT_HOSTNAME_SETTLE_DELAY` (15 seconds) locally before the first health
request; it does not perform a DNS probe or keep a backend transaction open.

`subscribe_deployments()` provides flat, best-effort transition hints. Keep its
synchronous callback small—for example, send the event into an application
channel—and let the consumer call `get_deployment()` or
`list_deployments_with_capacity()`. The SDK connects and authenticates the user
socket and waits for `ready` before delivering transitions. The state waiters
open that socket before their authoritative REST snapshot. There is no client
ACK or durable client outbox.
Transition events carry `agent_id` for local filtering plus `state`, `reason`, `error`, and
`message` and `launch_epoch`, but remain invalidations rather than authoritative snapshots.

Metrics and exec use short-lived token-scoped one-shot WebSockets. File writes
mint `/files/token` access and PUT directly to the HTTPS Reef endpoint with
sync-root-relative paths; redirects are rejected. Per-file writes are limited
to 100 MiB (`AGENT_FILE_WRITE_MAX_BYTES`, the Cloudflare edge request-body cap
on the agent hostname); split larger data across files or sync it via the
agent's own tooling.

`Deployment.state` remains an open string so future server states continue to
parse. Placement, runtime, and optional finalize epochs are
opaque correlation hints; REST is the snapshot.

Canonical deployment lifecycle snapshots currently use `CREATING`, `STARTING`,
`RESTORING`, `RUNNING`, `STOPPING`, `STOPPED`, `ARCHIVING`, `ARCHIVED`,
`FAILED`, and `DELETED`. `CREATING` is fresh admission, `STARTING` resumes a
warm retained agent, and `RESTORING` hydrates a cold agent from its exact
archive checkpoint. `STOPPED` is warm and
`ARCHIVING` is transitional. `ARCHIVED` is the Backend-persisted,
cold-restorable terminal projection after Lagoon drops its agent task,
namespace, PVC, and local S3 copy. `DELETED` is Backend-only, terminal, and
normally hidden from user reads. Consumers should display and wait on these
values, not reproduce the server lifecycle machine. `reason` is an open string with a
stable transition cause such as `start`, `api_stop`,
`runtime_exit`, `timeout`, or `delete`; `error` is a failure code when present,
and `message` is human-readable context.

START is a complete replacement contract. Keep the original
`CompleteDeploymentLaunchConfig` (including secrets and registry auth) under
caller ownership and pass a clone to `StartDeploymentRequest::new`; the
redacted `Deployment.launch_config` inspection projection cannot be used as a
restart payload. Set exactly one sync policy: use `sync_exclude: Some(vec![])`
for whole-root sync, `sync_include: Some(vec![])` to select nothing, or provide
one non-empty include/exclude list. CREATE and START reject requests that set
neither selector or both selectors.

## Plans and agent capacity

Plan IDs remain `String` values so future and historical plans keep parsing;
`HyperAgentPlan::canonical_id()` recognizes current `solo`, `team`, and `pro`
IDs. HyperClaw plan access is active when either the subscription count or the
direct-entitlement count is positive:

```rust
let summary = client.entitlements_summary()?;
if summary.has_active_plan() {
    println!("{} active slots", summary.agent_slots.len());
}
```

`client.claim_trial_entitlement()` sends an authenticated, bodyless `POST` to
`/agents/plans/trial` and returns the backend-created introductory entitlement.
The backend is the sole authority for trial eligibility.

This summary is the HyperClaw source of truth, not Orchestra `/api/auth/me`.
A `401` or `403` is an unknown plan state for that scoped key; callers must not
turn the error into a false no-plan result.

Compatibility list methods still return `Vec<Deployment>`. Use
`list_deployments_with_capacity()` (or the handle-filtered variant) to preserve
the full deployment envelope: saved/running account limits, pooled TPD,
aggregate slot inventory, and entitlement-backed `AgentSlot` records.

## Dynamic routes

The Rust client uses the same typed `RouteConfig` map for launch-time and live
route configuration. Full-map updates are declarative; named updates are
atomic and preserve every other route:

```rust
use std::collections::BTreeMap;
use hypercli_sdk::{RouteConfig, SetDeploymentRoutesRequest};

let mut routes = BTreeMap::new();
routes.insert("web".into(), RouteConfig::new(3000));
let updated = client.set_deployment_routes(
    "self",
    &SetDeploymentRoutesRequest { routes },
)?;
```

`routes` contains only reusable desired configuration. Resolved URLs and live
DNS state are returned separately in `route_statuses`. The reserved `self`
selector is valid for get/status, start, stop, and route operations through an
active runtime-key binding; the generic runtime scope remains `agents:none`.

## Buzz coding-agent launch

`BuzzLaunchConfig` renders the private Buzz identity and behavior onto a typed
`CreateDeploymentRequest` while deriving the executable command, arguments,
and MCP bridge from the selected coding runtime:

```rust
use hypercli_sdk::{BuzzLaunchConfig, CreateDeploymentRequest, ManagedRuntime};

let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
let mut buzz = BuzzLaunchConfig::new(agent_nsec, relay_url);
buzz.auth_tag = Some(owner_signed_auth_tag);
buzz.parallelism = 1;
buzz.apply_to(&mut request, Some("Fizz"))?;
```

`BuzzLaunchConfig::apply_to` leaves size unset for live backend selection,
adds the stable `app=buzz` deployment tag, and enforces `/home/node`
persistence with UID/GID 1000, no public routes, lazy pool creation, relay
observation, `restart: false`, and canonical runtime launch values. The
restart policy lets an accepted Buzz `!shutdown` leave the coding process
stopped instead of having the runtime automatically restart it. The hosted
terminal-state observer then completes runtime cleanup, marks the deployment
`stopped`, and releases its slot. Desktop receives no provider
acknowledgement. Raw non-Buzz `CreateDeploymentRequest` sizing remains
caller-selected. The config does not implement `Debug` or `Serialize` because
it owns the agent nsec.

`Deployment::is_buzz_managed()` recognizes both the stable tag and legacy
deployments that only carry `buzz_agent=<public-key>`. The SDK exposes list,
start, stop, and delete lifecycle calls; callers must keep delete limited to
the backend's `stopped` state.

`/home/node` remains the persistence and Files API root, and
`/home/node/shared` remains reserved for Workspace projections. The
Buzz-specialized images reconcile their nest after mount and run the harness
from `/home/node/.buzz`. OpenCode and Codex consume its `AGENTS.md`; Claude
Code receives `CLAUDE.md -> AGENTS.md`. `base_prompt.md` remains compiled into
`buzz-acp`.

For a generic `CreateDeploymentRequest`, whole-root sync is represented by
`sync_exclude: Some(vec![])`; a nonblank `sync_root` does not make a missing
selector valid. An explicit empty `sync_include` selects nothing, while a
nonempty include or exclude selects that policy. Typed Buzz requests inject
the selected runtime's documented include default. Reef continuously uploads new and changed allowed
files from the PVC to object storage, but it is not a two-way mirror and does
not propagate ordinary filesystem deletions. Files API deletes are targeted
remote deletes. Object storage is copied back to the PVC only during explicit
cold restore; ordinary start reuses the retained PVC.

The renderer writes timeout and response-policy values but does not perform the
Desktop provider's cross-field validation. It has no structured Buzz provider
field, so direct Goose callers must supply `GOOSE_PROVIDER` when needed.

Stock Buzz Desktop v0.5.2 invokes backend providers only for `info` and
`deploy`; there is no provider stop or undeploy request. Desktop's best-effort
`!shutdown` chat control can trigger the hosted one-shot terminal cleanup
described above, but Desktop neither acknowledges nor reconciles that remote
transition. Use authenticated HyperCLI lifecycle APIs when reliable
infrastructure stop/delete is required.

Stock Buzz expects ACP NDJSON. It skips non-JSON child stdout, and
`agent_message_chunk` is activity telemetry rather than a channel reply. There
is no plaintext fallback; a visible response requires the agent to invoke the
Buzz send command/tool. The six-runtime SDK matrix, including native
`buzz-agent`, validates representative
rendered request shapes only.

The rendered nsec and caller environment are raw launch environment values.
The HyperClaw backend currently persists them in `Agent.launch_config`, and
authenticated deployment read, environment, or exec surfaces may expose them.
Use this integration for sensitive credentials only with that limitation
understood. The default
`RUST_LOG=buzz_acp=info,pool::prompt=info,acp::stream=off` disables ACP stream
content logging; explicitly overriding it can expose generated text in
container logs.

## Native coding-runtime login

Claude Code, Codex, and Kimi Code images expose one normalized wrapper at
`/usr/local/bin/hypercli-runtime-auth`. The SDK fixes both the status and login
commands; Desktop does not have to expose arbitrary remote exec just to render
an authentication button:

```rust,no_run
use std::time::Duration;
use hypercli_sdk::NativeRuntime;

# async fn example(client: &hypercli_sdk::HyperCliClient) -> Result<(), hypercli_sdk::RuntimeAuthError> {
let status = client.runtime_auth_status("deployment-id")?;
if !status.authenticated {
    let mut login = client
        .start_runtime_login(
            "deployment-id",
            NativeRuntime::Codex,
            Duration::from_secs(45),
        )
        .await?;
    let challenge = login.challenge();
    // Open challenge.verification_url and display challenge.user_code.
    login.wait(Duration::from_secs(600)).await?;
}
# Ok(())
# }
```

Claude can request pasted terminal input; call `send_input` and then `wait`.
Codex and Kimi normally return a verification URL plus device code. The shell
token JWT is an opaque, short-lived value: `RuntimeShellToken` is deliberately
non-`Debug` and non-serializable, the HTTP trace omits response bodies, and
WebSocket failures never include the authenticated URL. Only the sanitized
`RuntimeLoginChallenge` should cross a Tauri IPC boundary.
