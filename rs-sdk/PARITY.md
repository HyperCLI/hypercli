# Rust SDK session parity sweep

Source-inspected against the current TS/Python public exports, ACP clients and
session readers, Backend `session_routes.py`, `acp/ARCHITECTURE.md`, and the
reference v2 schema definitions (`InitializeResponse`, `SessionCapabilities`,
`ListSessionsRequest`, `ResumeSessionRequest`, `CloseSessionRequest`). The product
profile is experimental alpha.5; the current schema checkout is not itself a
protocol upgrade. This is an implementation inventory, not a test-pass or full
cross-language parity claim.

| Surface | TS / Python baseline | Rust result |
| --- | --- | --- |
| Client v2-only initialize | Experimental v2; runtime version independent | Supported; validates version and required implementation identity |
| New/resume/admission/update/cancel | Standard operations | Supported; typed helpers now require initialized session capability and validate explicit cwd |
| Authoritative cwd lookup | Coordinated runtime-owned resolution seam in progress | Gap: Rust requires explicit absolute runtime cwd; no SDK-local resolution or hosted fallback |
| ACP catalog / close | Standard baseline session methods | Implemented `AcpClient::list_sessions` / `close_session` |
| Admission identity failures | Must never imply safe resubmission | Malformed acceptance now returns `AmbiguousDelivery` |
| Legacy load name | Python compatibility alias, TS unavailable | Preserved Rust alias to standard resume, never `session/load` |
| Platform catalog/detail | Both expose stored metadata; TS typed detail | Implemented async `SessionsClient`, typed records/participants/receipts/import evidence/availability |
| Retained history pages | TS public API; Python completion reads REST history | Implemented typed messages with opaque REST cursors |
| Discovery evidence/request | TS API; platform-owned | Implemented typed status and explicit request |
| Transcript search / around | TS public API | Implemented typed hits and ascending windows |
| Exact prompt completion | TS/Python current REST readers | Implemented paginated exact-evidence lookup and bounded async observer of an acceptance |
| Completion convenience on raw ACP object | TS/Python callback reader | Rust uses explicit acceptance + REST observer; old `prompt` refusal preserved |
| Reconnect/pooling/turn driver | TS has richer orchestration | Deferred; Rust remains caller-owned one-shot transport, no automatic resend |
| Permission handling | TS/Python configurable handlers | Existing Rust default cancellation supported; custom callback surface still missing |
| MCP/session config/model/provider helpers | Richer sibling helpers | Still missing typed Rust convenience APIs; raw standard RPC access exists |
| Custom `start.from/limit` replay | Existing sibling compatibility debt | Deferred; not introduced in Rust |
| v2 idle as completion / automatic uncertain resend | Forbidden by architecture | Not supported |
| Deployments, config, jobs, renders, billing, files, keys, models, instances, user, workspaces, routines, memory | Existing sibling families | Rust already exports these families; no claim of every-method parity |
| Voice/browser-specific clients and other product families | Additional sibling surfaces | Outside this session-focused change; no consumer-driven expansion |

## Compatibility and consumers

- Existing public Rust signatures and result structs are preserved. All session
  REST types are new. `async_http` is only made crate-visible to reuse the existing
  injected transport. No dependency, workspace, lock or release-version changes.
- Typed ACP calls before initialization or without `capabilities.session` now
  fail locally. Relative/NUL cwd values now fail locally. These intentional
  boundary corrections can expose invalid caller assumptions.
- Only the runner/hosted runtime resolves cwd configuration, including paths
  relative to runtime `~/.hypercli`. Rust preserves valid absolute overrides
  verbatim and rejects unresolved relative/tilde values. Resume callers must
  supply the existing session's cwd from discovery/stored native setup. Automatic
  authoritative lookup is deferred until the coordinated platform seam is
  established; SDK process cwd, local home and hosted literals are not fallbacks.
- The public `AcpError` enum gains no variants. Malformed successful prompt
  replies now classify as ambiguous rather than protocol-only errors because
  input may already have been accepted. Errors never authorize automatic resend.
- Completion uses exact identities, user sequence and equal terminal/user
  completion timestamps. A newer incomplete terminal prevents fallback to an
  older attempt. Broken/repeated REST cursors are errors, not end-of-history.
  Cross-page reads are not a transactional snapshot; timestamp mismatch fails
  closed and a subsequent observation may reconcile it.
- The completion waiter observes only, polls at one second, and can be dropped.
  Large histories require multiple requests per observation. It cannot provide
  completion for runtimes whose retained data lacks the required evidence.
- `acp/hyper-runner/src/auth.rs` consumes `discover_client_config_from`; the
  inspection found no runner dependency on the modified ACP/session helpers.

## Ready batches for the orchestrator

1. **Platform sessions:** `src/sessions.rs`, `tests/sessions.rs`, the crate-visible
   transport in `src/client.rs`, and module/exports in `src/lib.rs`.
2. **ACP boundary and lifecycle parity:** `src/acp.rs` (implementation and embedded
   tests), `README.md`, and this inventory. The new ACP rustdoc link depends on
   batch 1, so commit in that order or combine both batches.

No git mutation was performed. Other SDK/backend/runner and test-supervisor
changes remain owned by their respective agents.

## SA execution handoff

Tests were written/updated by inspection; no local test, build, compilation or
typecheck was executed by this implementation agent. SA owns execution and any
cross-package verification. Suggested focused Rust commands from `hypercli/`:

```sh
cargo test -p hypercli-sdk --locked --test sessions
cargo test -p hypercli-sdk --locked acp::tests
```

Then use the existing Rust gates (formatting, clippy, SDK tests/docs/package) and
the runner configuration/contract verification selected by SA. New tests cover
authenticated injected transport, escaped IDs, metadata defaults, REST filters,
cross-page exact completion, foreign/stale/missing evidence, retry evidence,
HTTP status/identity preservation, observation timeout, cursor loops, wire list/resume/close shapes,
invalid paths, missing capability, v1 rejection, and malformed admission identity.
The existing uncertainty, cancellation, silence and framing cases remain in the
ACP suite; fixtures now initialize before typed operations.

Vanilla-ACP schema validation of real captured frames remains an SA acceptance
gate. The helper frame tests assert exact payloads but are not a substitute for
validation against the installed alpha.5 schema.
