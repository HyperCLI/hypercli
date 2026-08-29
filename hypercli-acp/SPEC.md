# HyperCLI ACP Runtime Host Spec

Status: draft, implementation in progress

## Decision

`hypercli-acp` is a HyperCLI-owned, pluggable runtime host. Its runtime protocol
baseline is canonical Agent Client Protocol (ACP). HyperCLI may own transports,
connectors, queues, trace storage, and operational policy around ACP, but it must
not change canonical ACP request/response semantics unless we make an explicit
future fork decision.

This is an implementation fork/host, not a protocol fork. HyperCLI-specific
behavior belongs in host plugins, connector plugins, MCP tools, SQLite trace, or
small `_meta` correlation hints. Canonical ACP remains the source of truth for
runtime messages.

The default process is:

```text
hypercli-acp
hypercli-acp host
```

Buzz compatibility is explicit:

```text
hypercli-acp buzz
```

Buzz environment variables must not silently switch the default process out of
host mode.

## Canonical ACP Baseline

The canonical ACP repository/schema is the protocol baseline:

```text
https://github.com/agentclientprotocol/agent-client-protocol
local audit repo: /home/ubuntu/dev/agent-client-protocol-git
current audited commit: 9c211e286c29c563cf55a7ec577915bf816926a5
```

HyperCLI adapters must be validated against that schema/docs and should consume
upstream crates, generated schema artifacts, or release-pinned fixtures where
possible. The real adapter must record its upstream ACP pin in code, lockfiles,
or generated fixtures so CI can audit drift mechanically.

HyperCLI may use ACP extension points only in the ways ACP intends:

- `_meta` fields for compact, optional metadata.
- `_`-prefixed custom methods only for optional host-specific operations.
- MCP servers/tools for context retrieval, memory, search, and connector tools.
- Custom transports only when the ACP message semantics remain canonical.

HyperCLI must not add custom root fields to canonical ACP messages, redefine
canonical methods, or make non-ACP `/ws` frames masquerade as ACP.

A protocol fork requires a written decision that names the incompatible change,
why ACP extension points are insufficient, migration impact, and conformance
fallout.

## Scope

The host owns:

- Process startup and runtime plugin selection.
- Platform `/ws` control plane, inbound for local/dev and outbound callback for
  hosted or remote hosts.
- Normalized turn admission and per-conversation queuing.
- Session mapping from platform conversation keys to runtime session IDs.
- Replayable activity events for all turns, not only Buzz-originated turns.
- Bounded SQLite trace at `.hypercli-acp/trace.sqlite3`.
- Connector plugins for Slack relay, Buzz compatibility, web, and future
  surfaces.
- MCP tool injection, including platform semantic search backed by
  `qwen3-embedding:4b`.

The runtime plugin owns:

- Translating normalized turns into canonical ACP runtime calls.
- Runtime subprocess lifecycle, cancellation, liveness, and shutdown.
- Extracting reply text and usage where the runtime exposes it.
- Reporting runtime capabilities honestly.

The connector plugin owns:

- Native ingress normalization into `NormalizedTurn` or `NormalizedCommand`.
- Native reply delivery.
- Native history crawl, dedupe, receipts, retry, and command parsing where
  applicable.

## Current Implementation Status

Current code has host scaffolding and some working platform primitives, but not a
real canonical ACP runtime adapter yet.

Implemented today:

- `hypercli-acp` and `hypercli-acp host` start the HyperCLI host.
- `hypercli-acp buzz` delegates explicitly to the existing Buzz ACP runtime.
- `--callback-url` / `HYPERCLI_ACP_CALLBACK_URL` selects outbound `/ws`.
- `HYPER_AGENTS_API_KEY` is sent as a bearer token for outbound `/ws`.
- Inbound `/ws` accepts normalized turn/control/session messages.
- Activity frames cover runtime, session, turn, reply, ACP, MCP, and connector
  events.
- SQLite trace records bounded sessions, turns, terminal state, and activity.
- Runtime plugin metadata exists.
- Connector trait and Slack/Buzz scaffolds exist.

Known gaps:

- `canonical_acp` currently wraps `StubRuntime`; it is not a real ACP subprocess
  adapter.
- OpenCode ACP launch, initialize, `session/new`, `session/prompt`,
  cancellation, and output draining are not wired.
- The managed launch contract for outbound `/ws` is not fully represented across
  all images/backends.
- Slack durable-before-ack is not complete until ingress admission is persisted
  before relay acknowledgement.
- Slack delivery/history behavior is scaffolding, not production relay parity.
- Buzz in-host connector normalization is not the same as standalone
  `hypercli-acp buzz`.
- Queue policy is currently narrower than the final target: idempotency,
  per-conversation FIFO, completion, cancel, and basic control are present;
  retry/dead-letter/steer policy needs more work.
- Any old `hyper-acp` naming should be treated as legacy Buzz observer naming
  and not confused with the platform `/ws` control plane.

## Plugin Model

Plugins are scoped by responsibility. They should be independently testable and
predictable.

Runtime protocol plugins:

- `canonical_acp`: canonical ACP runtime adapter. First target runtime is
  OpenCode ACP.
- `buzz_compat`: explicit compatibility mode for existing Buzz ACP behavior.
- Future runtime adapters may be added, but they must expose their protocol and
  conformance status.

Control-plane plugins:

- `platform_ws`: HyperCLI platform control plane. It is default for hosted
  operation but optional for standalone plugins.

Connector plugins:

- `slack_relay`: HyperCLI Slack relay connector, aligned to our relay shape and
  `HYPER_AGENTS_API_KEY`, not a raw Slack bot-token integration.
- `web`: platform web-thread connector.
- `buzz`: Buzz channel compatibility connector or standalone Buzz mode.

Context/tool plugins:

- `semantic_search`: MCP tools for skill, memory, and workspace retrieval using
  the platform embedding model `qwen3-embedding:4b`.
- Future MCP tools may expose connector-specific lookup or reply helpers.

Plugins must communicate through stable host shapes: normalized turns,
normalized commands, activity frames, connector replies, delivery receipts, MCP
tool contracts, and trace records. Runtime plugins must not learn Slack, Buzz,
or web event formats.

## Startup Modes

Default host:

```text
hypercli-acp [--bind 127.0.0.1:8787] [--trace-db .hypercli-acp/trace.sqlite3]
hypercli-acp host [--bind 127.0.0.1:8787] [--trace-db .hypercli-acp/trace.sqlite3]
```

Outbound callback host:

```text
hypercli-acp --callback-url wss://backend.example/ws
hypercli-acp host --callback-url wss://backend.example/ws
HYPERCLI_ACP_CALLBACK_URL=wss://backend.example/ws hypercli-acp
```

Standalone Buzz compatibility:

```text
hypercli-acp buzz ...
```

Legacy helper commands may pass through while migration is in progress:

```text
hypercli-acp models
hypercli-acp auth-methods
hypercli-acp authenticate
hypercli-acp auth-tag
```

Those helpers are transitional. They must not imply Buzz is the default runtime
host.

## Platform `/ws` Control Plane

`/ws` is a HyperCLI platform protocol, not ACP. It submits normalized turns,
sends control commands, requests traces, and streams activity. It is the common
integration point for backend automation, web UI, Slack relay, and remote hosts.

Two connection shapes are supported:

- Inbound listener: platform/backend connects to the agent process. Useful for
  local development.
- Outbound callback: agent process dials the platform. This is the preferred
  shape for hosted agents and remote hosts behind firewalls.

Outbound `/ws` authentication uses:

```text
Authorization: Bearer $HYPER_AGENTS_API_KEY
```

Current client messages:

```json
{"type":"hello","protocol_version":1,"client":{"kind":"backend","name":"hyperclaw"}}
{"type":"turn.submit","idempotency_key":"slack:T:C:123.45","connector":"slack","conversation_key":"slack:T:C:thread","sender":{"id":"U1","kind":"human"},"message":{"text":"status?"},"reply_target":{"kind":"slack_thread","team_id":"T","channel_id":"C","thread_ts":"123.45"}}
{"type":"turn.cancel","request_id":"r1","conversation_key":"slack:T:C:thread","turn_id":"turn_123"}
{"type":"turn.steer","request_id":"r2","conversation_key":"slack:T:C:thread","message":{"text":"answer shorter"}}
{"type":"session.rotate","request_id":"r3","conversation_key":"slack:T:C:thread"}
{"type":"session.list","request_id":"r4","conversation_key":"slack:T:C:thread"}
{"type":"session.trace","request_id":"r5","conversation_key":"slack:T:C:thread","limit":100}
{"type":"runtime.shutdown","request_id":"r6"}
```

Current server messages:

```json
{"type":"hello.ok","protocol_version":1,"server":{"name":"hypercli-acp"}}
{"type":"activity.replay_end","next_seq":42}
{"type":"turn.accepted","turn_id":"turn_123","conversation_key":"slack:T:C:thread","status":"accepted","queued_at":"2026-08-29T00:00:00Z"}
{"type":"turn.started","turn_id":"turn_123","conversation_key":"slack:T:C:thread","session_id":"session_1","queued_at":"2026-08-29T00:00:00Z","started_at":"2026-08-29T00:00:01Z"}
{"type":"turn.activity","seq":43,"timestamp":"2026-08-29T00:00:01Z","kind":"turn.liveness","conversation_key":"slack:T:C:thread","turn_id":"turn_123"}
{"type":"turn.reply","connector":"slack","turn_id":"turn_123","conversation_key":"slack:T:C:thread","target":{"kind":"slack_thread","team_id":"T","channel_id":"C","thread_ts":"123.45"},"text":"..."}
{"type":"turn.completed","turn_id":"turn_123","conversation_key":"slack:T:C:thread","queued_at":"2026-08-29T00:00:00Z","started_at":"2026-08-29T00:00:01Z","completed_at":"2026-08-29T00:00:03Z","reply_status":"delivered"}
{"type":"control.result","request_id":"r1","command":"turn.cancel","status":"accepted"}
{"type":"session.list","request_id":"r4","sessions":[]}
{"type":"session.trace","request_id":"r5","sessions":[],"turns":[],"activity":[]}
{"type":"error","request_id":"r7","error":{"code":"bad_request","message":"...","retryable":false}}
```

Reply delivery status is currently represented as activity frames with
`kind: "turn.reply_delivered"` or `kind: "turn.reply_failed"`, not as separate
top-level server message variants.

## Normalized Turn Shape

All connectors submit the same host shape:

- `turn_id`: optional connector/platform turn ID; generated if absent.
- `request_id`: optional caller correlation ID.
- `idempotency_key`: stable dedupe key, usually native-event based.
- `connector`: `web`, `slack`, `buzz`, automation source, or future connector.
- `conversation_key`: queue/session affinity key.
- `sender`: normalized actor.
- `message`: text plus bounded attachments.
- `reply_target`: typed delivery target.
- `context`: compact source/history/metadata.
- `require_reply`: whether host should treat absence of reply as terminal
  failure or no-reply.

Runtime adapters receive normalized turns and sessions. They do not receive raw
Slack events, Buzz events, or web transport payloads.

## Activity

Activity must cover all turns, regardless of connector. Buzz-only activity is a
legacy shape.

Activity frames are append-only and replayable:

- `runtime.started`, `runtime.ready`, `runtime.stopping`, `runtime.stopped`,
  `runtime.error`
- `agent.spawned`, `agent.exited`, `agent.restarted`
- `session.created`, `session.rotated`
- `turn.queued`, `turn.started`, `turn.liveness`, `turn.steer_attempted`,
  `turn.cancelled`, `turn.reply_attempted`, `turn.reply_delivered`,
  `turn.reply_failed`, `turn.completed`, `turn.failed`
- `acp.read`, `acp.write`
- `mcp.tool_call`, `mcp.tool_result`
- `connector.event`

Turn start and stop times must be emitted and persisted. Token usage should be
captured when the runtime exposes it. Usage may be absent or marked unreliable;
that is better than inventing numbers.

## SQLite Trace

The host writes bounded trace data to:

```text
.hypercli-acp/trace.sqlite3
```

Trace storage is for operational traceback and future session-memory material,
not raw terminal capture. It should include:

- Sessions by `conversation_key` and runtime `session_id`.
- Normalized turns after size limits.
- Start/completion timestamps.
- Terminal status and reply status.
- Bounded activity frames.
- Optional usage data when available.

Trace storage must not include:

- Internal reasoning.
- Unbounded stdout/stderr.
- Large command outputs.
- Full 1 GB files pasted through tools or terminal output.
- Secrets.

Large fields must be truncated with metadata indicating truncation. The host
should prefer small summaries, hashes, byte counts, and external references over
storing huge blobs in SQLite.

Plain PVC/file persistence and semantic/vector memory are different things:

- SQLite trace and workspace/PVC files preserve operational state over process
  restarts.
- MCP semantic search/memory provides retrieval over selected durable content.

## Semantic Search And Memory

Semantic search should be implemented through MCP tools, not by stuffing vector
results into `_meta`.

The platform embedding model is:

```text
qwen3-embedding:4b
```

Initial MCP tool families:

- `skills.search`: retrieve relevant platform skills and instructions.
- `memory.search`: retrieve durable session/user/project memory.
- `memory.write`: record selected session memory after host policy approval.
- `workspace.search`: retrieve indexed workspace/project context.

Minimum MCP contract:

- Auth uses the platform runtime credential, normally `HYPER_AGENTS_API_KEY`.
- Each result includes `source`, `title`, optional `uri`, `score`, `snippet`, and
  stable reference metadata.
- Results are bounded by caller limit, host policy, byte budget, and per-result
  snippet budget.
- Index ownership is explicit: platform indexes skills and managed memory;
  workspace indexes are per workspace/project; connector history indexes remain
  connector-owned unless promoted to memory.
- Tool responses must identify truncation and never return secrets or unbounded
  raw files.
- Writes require policy approval and record provenance.

The runtime may choose whether and when to call the tools. Scheduled turns can
include compact hints, but the heavy context path should be MCP retrieval.

## `_meta` Policy

Use `_meta` only for compact correlation and routing hints:

- `hypercli.turn_id`
- `hypercli.request_id`
- `hypercli.connector`
- `hypercli.conversation_key`
- `hypercli.reply_target_ref`
- `hypercli.trace_ref`
- `hypercli.capabilities`

Do not use `_meta` for:

- Slack history dumps.
- Vector search results.
- Large prompt context.
- Connector-specific event bodies.
- Secret material.
- Required semantics that the runtime must understand to be correct.

If a value is required for correctness, make it part of the host contract,
connector contract, MCP tool response, or canonical ACP message where allowed.

## Slack Relay Connector

Slack lives in HyperCLI ACP as a connector plugin aligned to our Slack relay
shape, not as a general Slack bot integration.

Key constraints:

- Use `HYPER_AGENTS_API_KEY` with the HyperCLI relay/proxy, not a direct Slack
  bot token.
- Normalize relay events into `NormalizedTurn` and commands.
- Deliver replies through relay-backed Slack thread/DM targets.
- Crawl or request bounded thread history through the relay when needed.
- Preserve native IDs for idempotency, dedupe, replay, and receipt tracking.
- Support relay-level startup/shutdown/reconnect behavior.
- Durable-before-ack means persisted admission before the relay is told the
  event is accepted.

Slack command handling should mirror the useful parts of Buzz:

- Native `!shutdown` or equivalent maps to `runtime.shutdown` only when policy
  permits it.
- Cancel/steer/session commands become normalized commands.
- Connector command parsing stays inside the Slack plugin; runtime adapters see
  only normalized commands and turns.

Slack should not require custom runtime glue. The flow is:

```text
Slack relay event -> slack_relay plugin -> NormalizedTurn -> queue/session ->
canonical_acp runtime plugin -> ConnectorReply -> slack_relay delivery
```

## Buzz Compatibility

Buzz is preserved explicitly, not implicitly.

Standalone:

```text
hypercli-acp buzz
```

This mode delegates to the existing Buzz ACP implementation and can run without
the platform `/ws` control plane.

In-host Buzz plugin work is separate and should reuse only the useful boundary
ideas:

- channel/user/event normalization,
- command parsing such as shutdown/cancel/steer,
- reply delivery shape,
- liveness/activity capture,
- session affinity and per-conversation behavior.

Current in-host Buzz connector scaffolding is not a full Buzz runtime
replacement.

## Canonical ACP Runtime Plugin

The first production runtime target is OpenCode through canonical ACP.

Required adapter behavior:

- Spawn the configured runtime subprocess.
- Perform canonical ACP initialization and capability negotiation.
- Create or reuse sessions per `conversation_key`.
- Convert `NormalizedTurn` into canonical `session/prompt` content.
- Inject MCP servers/tools, including semantic search/memory.
- Capture assistant replies, terminal status, errors, and usage when available.
- Handle cancellation and runtime shutdown.
- Drain stdout/stderr safely without storing unbounded output.
- Emit `acp.read` and `acp.write` activity around ACP traffic.

The adapter must be conformance-tested against the canonical ACP schema/docs.
Until this exists, `canonical_acp` must be treated as scaffolding only.

## Remote Hosts

Remote hosts behind firewalls should use outbound `/ws`:

```text
HYPERCLI_ACP_CALLBACK_URL=wss://platform.example/agents/{agent_id}/ws
HYPER_AGENTS_API_KEY=...
hypercli-acp
```

The platform owns identity, authorization, and routing. The host owns runtime
execution and connector delivery for connectors running locally. This supports
Lagoon/orchestration-style hosts without requiring inbound ports.

## Images

There is no verified upstream ACP Docker base image today. HyperCLI owns the
`hypercli-acp-base` image lane and consumes upstream ACP crates/schemas/release
artifacts inside it.

Image expectations:

- Base image contains `hypercli-acp` as the standard startup binary.
- Buzz images invoke `hypercli-acp buzz` explicitly when they need Buzz
  compatibility.
- New canonical host images invoke `hypercli-acp` or `hypercli-acp host`.
- CI should reject accidental use of a `buzz-acp` binary in standard host images.

Named enforcement points:

- `hyperclaw-backend/hypercli-agent-images/buzz/base/Dockerfile`: builds and
  installs `/usr/local/bin/hypercli-acp`.
- `hyperclaw-backend/hypercli-agent-images/buzz/base/test.py`: asserts
  `hypercli-acp` exists and `buzz-acp` is absent.
- `hyperclaw-backend/.github/workflows/build.yml`: builds/publishes
  `hypercli-acp-base` and downstream Buzz runtime images.
- `hyperclaw-backend/.github/scripts/buzz_owner_shutdown_check.sh`: runs Buzz
  shutdown checks through `hypercli-acp buzz`.
- `hypercli/tests/fixtures/buzz-launch-contract.json`: shared SDK/provider
  launch golden for Buzz compatibility command shape.
- `hypercli/sdk/hypercli/agents.py`, `hypercli/ts-sdk/src/agents.ts`,
  `hypercli/rs-sdk/src/types.rs`, and
  `hypercli/buzz-backend-provider/src/lib.rs`: managed launch contract sources.

Do not mutate the Buzz base into a canonical host without a distinct image lane;
that hides migration risk and makes CI failures ambiguous.

## CI And Test Coverage

Required coverage for this slice:

- Rust unit tests for message serialization, plugin metadata, callback request
  auth, trace bounds, queue idempotency, and connector capabilities.
- `/ws` E2E tests for inbound local mode and outbound callback mode.
- Canonical ACP conformance tests once the real adapter replaces `StubRuntime`.
- OpenCode ACP E2E: initialize, session creation, prompt, reply, cancellation,
  shutdown, and MCP injection.
- Slack relay E2E with injected relay events, idempotent admission, bounded
  history, threaded reply, durable-before-ack, retry, and receipt failure.
- Buzz standalone E2E proving `hypercli-acp buzz` still works without `/ws`.
- SDK golden contract tests in Python, TypeScript, and Rust for managed launch
  commands and environment.
- Backend/image CI asserting standard startup is `hypercli-acp`, not `buzz-acp`.
- Smoke collection in backend with environment-gated live tests.

Current local verification commands:

```text
cargo fmt -p hypercli-acp -p hypercli-buzz-acp --check
cargo test -p hypercli-acp -p hypercli-buzz-acp
cargo test -p hypercli-sdk -p buzz-backend-hypercli
python3 -m pytest sdk/tests/test_coding_agents.py sdk/tests/test_agents.py -q
npm test -- --run tests/coding-agents.test.ts tests/agents.test.ts
python3 -m pytest tests/unit/test_smoke_suite_runner.py -q
HYPER_API_BASE=http://127.0.0.1:9 python3 -m pytest tests/smoke/test_buzz_provider_live_smoke.py tests/smoke/test_buzz_provider_hypercli_e2e.py tests/smoke/test_coding_agent_image_e2e.py --collect-only -q
```

Current status after this spec update:

- Rust HyperCLI ACP/Buzz ACP tests pass.
- Rust SDK/provider tests pass.
- Python SDK contract tests pass.
- TypeScript SDK contract suite passes.
- Backend smoke-suite unit tests pass.
- Backend smoke collection passes with explicit dummy `HYPER_API_BASE`; direct
  live smoke execution still requires real platform environment.

CI should distinguish:

- canonical host failures,
- Buzz compatibility failures,
- Slack relay failures,
- SDK contract drift,
- image startup drift.

## Operational Risks

Process-local schedulers are not enough for platform scheduling. The platform
must submit scheduled turns through `/ws` or connector ingress so it has
visibility into queueing, liveness, completion, delivery, and retry.

Concurrency risks:

- Per-conversation FIFO is required for chat coherence.
- Different conversations may run concurrently only if the runtime/session model
  supports it.
- Cancellation and shutdown must avoid leaving a wedged runtime subprocess.
- Idempotency keys must be stable across relay retries and backend resubmits.

Memory risks:

- SQLite trace is not semantic memory.
- MCP vector search quality depends on indexing policy, chunking, source
  attribution, and bounded result injection.
- `_meta` must not become an unbounded context escape hatch.

Connector risks:

- Slack ack before durable admission can lose user turns.
- Reply delivery must be observable and retryable.
- Relay auth must use platform `HYPER_AGENTS_API_KEY`.
- Slack history crawl must be bounded and policy controlled.

## Migration Plan

1. Keep `hypercli-acp buzz` working as explicit compatibility.
2. Make `hypercli-acp` the standard startup in base images and managed launch
   contracts.
3. Replace `canonical_acp` stub with a real OpenCode ACP adapter.
4. Add conformance tests against pinned canonical ACP schemas.
5. Wire outbound `/ws` into managed host launch contracts.
6. Complete SQLite durable admission before connector acknowledgement.
7. Ship Slack relay connector against the existing HyperCLI relay shape.
8. Add MCP semantic search/memory tools using `qwen3-embedding:4b`.
9. Retire direct `buzz-acp` binary usage from containers and CI.

## File Map

Current implementation entry points:

- `src/main.rs`: CLI modes and startup.
- `src/ws.rs`: platform `/ws` inbound/outbound transport.
- `src/types.rs`: normalized turn, control, activity, and trace messages.
- `src/core.rs`: turn admission, session/queue/runtime orchestration.
- `src/queue.rs`: per-conversation queue behavior.
- `src/trace.rs`: SQLite trace.
- `src/runtime.rs`: runtime adapter trait and current stub.
- `src/runtime_plugins/canonical_acp.rs`: canonical ACP plugin scaffold.
- `src/control_planes/platform_ws.rs`: `/ws` control-plane plugin scaffold.
- `src/connectors/mod.rs`: connector trait and host boundary.
- `src/connectors/slack`: Slack relay scaffold.
- `src/connectors/buzz`: Buzz connector scaffold.
