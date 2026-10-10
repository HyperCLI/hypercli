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

### ACP working-directory conveniences

The explicit `AcpClient::new_session(cwd)`, `resume_session(cwd, session_id,
replay)` and `load_session(cwd, session_id)` signatures remain supported.
Paths are sent verbatim; the runtime determines their validity.

For platform defaults, call `new_session_default(&platform, deployment_id)` on
an initialized ACP connection. It lazily reads the existing
`GET /deployments/{id}/runtime-paths` using `HyperCliClient`'s configured async
HTTP transport and credentials, then sends ordinary `session/new`. Connecting,
initializing and explicit-cwd calls do not perform this lookup. The REST reader
is also available as `HyperCliClient::deployment_runtime_cwd`.

`resume_session_stored(session_id, replay)` uses cwd retained by successful typed
new/resume calls, or finds that exact session in the paginated standard ACP
catalog. It never uses the current launch default for an existing session and
never creates a replacement if lookup or resume fails. Raw request users can
continue supplying setup explicitly; raw responses are not inspected for caching.

`new_session_default` returns `AcpSetupError`, preserving either the original
platform HTTP error or ACP error. Existing explicit helpers and
`resume_session_stored` return `AcpError`.

```rust,no_run
# use hypercli_sdk::{AcpClient, HyperCliClient};
# async fn setup(acp: &AcpClient, platform: &HyperCliClient) -> Result<(), Box<dyn std::error::Error>> {
let session_id = acp.new_session_default(platform, "deployment-id").await?;
acp.resume_session_stored(&session_id, false).await?;
# Ok(())
# }
```

### Deployment lifecycle

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
let start = StartDeploymentRequest::new();
client.start_deployment(&created.id, &start)?;
let running = client
    .wait_deployment_running(&created.id, Duration::from_secs(300))
    .await?;
println!("{} {}", running.id, running.state);
# Ok(())
# }
```

Lifecycle mutations remain separate calls:
`start_deployment(id, request)`, `stop_deployment(id, options)`,
`archive_deployment(id, options)`, `restore_deployment(id, options)`, and
`delete_deployment(id, options)`. Archive and restore never launch the
runtime. All four lifecycle options accept `dry_run`; a dry run returns the
current agent state without mutating anything.

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

START uses the launch configuration already stored on the backend. Put launch
configuration on `CreateDeploymentRequest` or replace it while stopped with
`UpdateDeploymentRequest::launch_config`; `StartDeploymentRequest` only carries
start options such as `dry_run`. Omit both sync selectors on create/update or
use `sync_exclude: Some(vec![])` for whole-root sync.
`sync_include: Some(vec![])` is invalid; a present include must contain at least
one path. Root-wide excludes such as `sync_exclude: Some(vec!["*".into()])` are
invalid. CREATE rejects requests that set both selectors.

OpenClaw helpers expose constants and env builders rather than new public struct
fields for `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` and `OPENCLAW_TRUSTED_PROXIES`,
so existing public struct literals remain source-compatible. Both envs are
comma-separated full replacements for the corresponding OpenClaw gateway config
lists.

## ACP and platform sessions

`AcpClient` uses vanilla **ACP v1** end to end.
The Rust transport remains one-shot: callers explicitly connect and initialize,
and own reconnection policy. Requests preserve native responses and refusals;
prompt completion is the correlated terminal result, including its `stopReason`.

`new_session(cwd)` and `resume_session(cwd, id)` take the original
runtime-host path (including Windows paths when appropriate). Paths are never
resolved on the SDK host or replaced with a guessed default. Only the runner or
hosted runtime resolves configured paths, including paths relative to runtime
`~/.hypercli`; pass its concrete absolute result or an explicit valid absolute
override verbatim. For existing sessions, obtain the original cwd from standard
session discovery or stored native setup, not the current launch default.
`new_session_default` uses the platform runtime-path read; `resume_session_stored`
uses retained setup or standard catalog discovery. `load_session` sends an explicit
full native history request, never an attachment fallback or a scrolling request.
`list_sessions` uses the standard ACP catalog.
`close_session` closes remote session resources; `close` releases the transport.
`cancel` only queues a notification, not an acknowledgment that execution stopped.

Platform metadata and retained history use the new **async** `client.sessions()`
API, sharing the parent's agents base URL, credentials and injected async HTTP
client:

```rust,no_run
use hypercli_sdk::{AcpClient, HyperCliClient, SessionMessagesOptions};
use serde_json::json;

# async fn example(client: &HyperCliClient, proxy_url: &str, key: &str, agent_id: &str, runtime_cwd: &str)
# -> Result<(), Box<dyn std::error::Error>> {
let acp = AcpClient::connect(proxy_url, key).await?;
acp.initialize().await?;
// Concrete absolute cwd supplied by the runtime authority or an explicit override.
let session_id = acp.new_session(runtime_cwd).await?;
let result = acp.submit_prompt(
    &session_id, vec![json!({"type": "text", "text": "Summarize the project"})],
).await?;
println!("{:?}", result.stop_reason);
let sessions = client.sessions();
let detail = sessions.get_session(&session_id).await?;
println!("{:?}: {:?}", detail.summary_text, detail.agent_state);
let history = sessions.get_messages(&session_id, &SessionMessagesOptions::default()).await?;
// history.page.next_cursor is opaque REST pagination, not an ACP replay cursor.
acp.close();
# Ok(())
# }
```

Construct/drop `HyperCliClient` outside a Tokio runtime as required by its existing
blocking transport; session methods themselves use async HTTP. Other session
methods are `list_sessions`, `get_discovery_status`, `request_discovery`,
`search_transcript` and `get_messages_around`.
Unsupported discovery remains an explicit status, not an empty-catalog success.

Detail includes source, summaries, participants, import evidence, `last_message_id`,
`message_count`, `head_seq`, receipts, and nullable `agent_state` (wire `agentState`).
Source and availability values are forward-open strings. Missing detail counters
remain `None`, so an old catalog response is not mistaken for an empty session.
Detail reads best-effort advance user read progress; history reads can also advance
read receipts. Search and around reads do not. All work from retained data even
when the runtime is offline. HTTP failures retain their status.

`take_updates()` is the independent native notification stream. REST receipts and
stable message identities describe retained history; they do not settle ACP
prompts. A disconnected attempted prompt remains uncertain and is never resent
automatically. No private platform fields or history windows are added to ACP.

## Plans and agent capacity

Plan IDs remain `String` values so future and historical plans keep parsing;
`HyperAgentPlan::canonical_id()` recognizes current `solo`, `team`, and `pro`
IDs. Hosted plan access is active when either the subscription count or the
direct-entitlement count is positive:

```rust
let summary = client.entitlements_summary()?;
if summary.has_active_plan() {
    println!("{} active slots", summary.agent_slots.len());
}
```

This summary is the agents source of truth, not Orchestra `/api/auth/me`.
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
    &SetDeploymentRoutesRequest { routes, cors: None },
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
buzz.apply_to(&mut request)?;
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
Code receives `CLAUDE.md -> AGENTS.md`. The Buzz plugin supplies no compiled
prompt or context-injection asset.

For a generic `CreateDeploymentRequest`, whole-root sync is represented by
omitting both selectors or by `sync_exclude: Some(vec![])`. An explicit empty
`sync_include` is invalid, while a nonempty include or exclude selects that
policy. Typed coding-agent requests inject the selected runtime's documented
include default when it has one. Reef continuously uploads new and changed allowed
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

Stock Buzz expects ACP NDJSON. It skips non-JSON child stdout and there is no
plaintext fallback; the hosted connector auto-publishes completed assistant
text to the channel. The six-runtime SDK matrix, including native
`buzz-agent`, validates representative
rendered request shapes only.

The rendered nsec and caller environment are raw launch environment values.
The agents backend currently persists them in `Agent.launch_config`, and
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

`runtime_auth_methods` returns the supported native method list without launching
an ACP probe child. Runtime status/login remain owned by the installed native
runtime-auth wrapper; the retired plugin discovery commands are not used.

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
