# SDK Feature Parity Gap

This file compares the current public surfaces of:

- `ts-sdk` (`@hypercli.com/sdk`)
- `sdk` (`hypercli-sdk`)
- `rs-sdk` (Rust, deliberately narrow — see notes below)

Scope:

- public exports
- major client namespaces
- notable helper methods that affect user-facing capability

Non-goals:

- private helpers
- purely idiomatic naming differences like `snake_case` vs `camelCase`
- implementation quality differences unless they change what a user can do

## Summary

The two main SDKs are converging. Both now support x402, job tags, a
constructor-level HTTP timeout, a public deployment config builder, and a
`list[Agent]`-shaped `deployments.list()`. The remaining gaps:

- `ts-sdk` has whole modules with no Python counterpart: `skills.ts`, `channels.ts`, `connectors.ts`, `browser.ts`
- Python has higher-level deployment streaming helpers (`chat_stream`, SSE `logs_stream`) that TS only partially matches (`logsConnect` returns a raw WebSocket)
- Python has async helper classes, shell session helpers, HyperAgent chat/OpenAI conveniences, and advanced ComfyUI execution helpers
- `ts-sdk` has gateway trusted pairing/browser-oriented features

## Present In `ts-sdk` But Not In `sdk`

### TS-only modules

Entire modules exported from `ts-sdk/src/index.ts` with no Python equivalent:

- `skills.ts` — agent skills provider types (summaries, install/recover flows)
- `channels.ts` — agent channel provider types plus hosted Slack relay helpers
- `connectors.ts` — agent connector setup/authorization provider types
- `browser.ts` — `BrowserHyperCLI` browser-oriented client

These are Python gaps if script/backend users need the same capabilities.

### Public `HTTPClient` export

Available in `ts-sdk`:

- `HTTPClient`

Python exports `AsyncHTTPClient`, but not the sync `HTTPClient` class.

### Gateway trusted pairing and browser/client identity surface

Available in `ts-sdk`, not present in Python's public gateway client:

- `GatewayPairingState`
- `onPairing`
- `autoApprovePairing`
- `deploymentId`
- `apiKey`
- `apiBase`
- browser/client identity fields such as `clientDisplayName`, `platform`, `instanceId`, `caps`
- persistent pairing storage behavior for pending approvals

This is a meaningful TS-only capability, especially for browser-facing or control-panel integrations.

### Gateway session convenience methods

Available in `ts-sdk`, not currently present in Python's `GatewayClient`:

- `sessionsPreview(sessionKey, limit)`
- `sessionsReset(sessionKey)`
- `sendChat(...)` as a direct RPC-style helper

Python has `chat_send(...)` and `sessions_list(...)`, but not these exact convenience methods.

### Typed deployment and gateway export surface

Available as public TS types, not mirrored as public Python equivalents:

- `AgentRouteConfig`
- `RegistryAuth`
- `BuildAgentConfigOptions`
- `CreateAgentOptions`
- `StartAgentOptions`
- `AgentExecOptions`
- `GatewayOptions`
- `GatewayEvent`
- `GatewayEventHandler`
- `ChatAttachment`

Python has runtime objects and dicts here, but not exported typed schema objects.

## Present In `sdk` But Not In `ts-sdk`

### Async file upload client

Python-only:

- `AsyncFiles`
- `AsyncHTTPClient`

The TS SDK supports async by default via promises, but it does not expose a parallel async-only helper surface or async HTTP client abstraction comparable to Python's public exports.

### Shell session helper abstraction

Python-only:

- `ShellSession`
- `shell_connect`

TypeScript users can open raw WebSockets for job and deployment shells, but there is no higher-level shell session wrapper.

### HyperAgent convenience helpers

Python-only on `client.agent`:

- `openai()`
- `chat(...)`

The TS SDK exposes plan/key/model discovery only. It does not provide a first-party OpenAI client wrapper or chat convenience method.

### Advanced ComfyUI helper surface

Python-only capabilities on `ComfyUIJob` and related exports:

- `load_template` export
- `expand_subgraphs` export
- `ComfyUIJob.get_instance(...)`
- `ComfyUIJob.get_or_create_for_template(...)`
- `ComfyUIJob.get_available_node_types()`
- `ComfyUIJob.get_workflow_node_types(...)`
- `ComfyUIJob.get_missing_node_types(...)`
- `ComfyUIJob.get_node_mappings()`
- `ComfyUIJob.lookup_packages_for_nodes(...)`
- `ComfyUIJob.get_custom_node_list()`
- `ComfyUIJob.install_packages_by_url(...)`
- `ComfyUIJob.auto_install_workflow_nodes(...)`
- `ComfyUIJob.get_installed_nodes()`
- `ComfyUIJob.install_node(...)`
- `ComfyUIJob.install_nodes(...)`
- `ComfyUIJob.reboot(...)`
- `ComfyUIJob.ensure_nodes_installed(...)`
- `ComfyUIJob.queue_prompt(...)`
- `ComfyUIJob.get_history(...)`
- `ComfyUIJob.wait_for_completion(...)`
- `ComfyUIJob.download_output(...)`
- `ComfyUIJob.run(...)`
- `ComfyUIJob.run_template(...)`
- `ComfyUIJob.get_output_images(...)`

`ts-sdk` currently covers only the lighter workflow-conversion side plus image/audio upload and object-info access.

### Functional Gradio client integration

Python `GradioJob.connect()` returns a working client.

TypeScript `GradioJob.connect()` is intentionally unimplemented and throws.

### Deployment streaming and chat helpers (still open)

Python-only on `Deployments`:

- `chat_stream(...)`
- `logs_stream(...)` (SSE convenience wrapper)
- `logs_stream_ws(...)`

TypeScript exposes:

- `logsConnect(...)` returning a raw WebSocket
- no `chat_stream(...)` executor helper
- no SSE log stream convenience wrapper

### Gateway event iteration and extra RPC helpers

Python-only on `GatewayClient`:

- `config_apply(...)`
- `agent_get(...)`
- `cron_run(...)`
- `next_event(...)`
- `events(...)`

TS has overlapping functionality in other forms, but these exact user-facing helpers are missing.

## Shared Areas With Shape Or Behavior Differences

These are not strictly "missing" on one side, but they are not yet parity-equivalent.

### Gateway surface emphasis

`ts-sdk` is more control-plane/browser oriented:

- pairing state
- typed events
- client identity metadata

`sdk` is more operations/script oriented:

- async iterator event loops
- `cron_run`
- direct `agent_get`

### Shell ergonomics

Both SDKs can reach job and deployment shells.

Python gives users:

- a shell session abstraction
- more obvious async shell helpers

TypeScript gives users:

- raw WebSocket access
- less built-in ergonomics above the wire format

### Workflow helper maturity

Both SDKs have:

- `BaseJob`
- `ComfyUIJob`
- `GradioJob`
- graph parameter helpers

Python goes much further into:

- full execution lifecycle
- template loading
- custom node inspection/install
- output download helpers

TS is currently better suited to:

- graph transformation
- standing up the service
- making raw HTTP calls to the job once ready

## Rust SDK (`rs-sdk`)

A third SDK exists at `rs-sdk/`. It is deliberately deployments-scoped: it
covers the agents/deployments surface needed by the buzz backend provider
(config resolution, deployments CRUD/exec, redacted HTTP tracing) and does not
aim for parity with the Python or TS SDKs. Do not file its missing namespaces
as gaps.

Housekeeping: `rs-sdk/crates/*` contained empty leftover directories from an
abandoned workspace layout (`crates/hypercli-sdk`, `crates/buzz-backend-hypercli`);
they held no files and have been deleted.

## Suggested Parity Work Order

If the goal is practical parity rather than identical APIs, the highest-value backlog is:

1. Add HyperAgent `chat()` and `openai()`-style convenience helpers to `ts-sdk`
2. Add higher-level deployment log/chat helpers to `ts-sdk` (`chat_stream`, SSE log streaming)
3. Bring core ComfyUI execution helpers to `ts-sdk`
4. Decide whether Python needs counterparts to the TS-only modules (`skills`, `channels`, `connectors`, `browser`)
5. Export a sync `HTTPClient` from the Python package if users need it

## Notes

- This document compares what is publicly available today, not what may already exist privately in module internals.
- It also does not attempt to force naming parity between Python and TypeScript idioms.
