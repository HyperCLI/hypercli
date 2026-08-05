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
terminal-state observer then cleans the namespace, marks the deployment
`stopped`, and releases its slot. Desktop receives no provider
acknowledgement. Raw non-Buzz `CreateDeploymentRequest` sizing remains
caller-selected. The config does not implement `Debug` or `Serialize` because
it owns the agent nsec.

`Deployment::is_buzz_managed()` recognizes both the stable tag and legacy
deployments that only carry `buzz_agent=<public-key>`. The SDK exposes list,
start, stop, and delete lifecycle calls; callers must keep delete limited to
the backend's `stopped` state.

`/home/node` remains the persistence and Files API root, and
`/home/node/workspaces` remains reserved for Workspace projections. The
Buzz-specialized images reconcile their nest after mount and run the harness
from `/home/node/.buzz`. OpenCode and Codex consume its `AGENTS.md`; Claude
Code receives `CLAUDE.md -> AGENTS.md`. `base_prompt.md` remains compiled into
`buzz-acp`.

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
